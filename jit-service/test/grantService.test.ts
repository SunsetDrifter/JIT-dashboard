import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { createPolicyRepo } from "../src/db/repositories/policyRepo.js";
import { createGrantRepo } from "../src/db/repositories/grantRepo.js";
import { createAuditRepo } from "../src/db/repositories/auditRepo.js";
import { createGrantService } from "../src/domain/grantService.js";
import { AppError, ErrorCodes } from "../src/lib/errors.js";
import type { Membership } from "../src/domain/membership.js";
import type { Caller } from "../src/auth/identity.js";
import type { JitPolicy } from "../src/domain/types.js";

const FIXED = new Date("2026-06-26T12:00:00.000Z");

const requester: Caller = { userId: "u1", email: "u1@x.com", role: "user", isAdmin: false, autoGroups: ["eng"] };
const admin: Caller = { userId: "adm", email: "a@x.com", role: "admin", isAdmin: true, autoGroups: [] };

function fakeMembership(opts: { failAdd?: boolean } = {}) {
  const calls: Array<{ op: "add" | "remove"; userId: string; groupId: string }> = [];
  const m: Membership = {
    add: async (userId, groupId) => {
      calls.push({ op: "add", userId, groupId });
      if (opts.failAdd) throw new AppError(ErrorCodes.NETBIRD_UNAVAILABLE, "boom", 502);
    },
    remove: async (userId, groupId) => {
      calls.push({ op: "remove", userId, groupId });
    },
  };
  return { calls, m };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

function setup(opts: { propagation?: boolean; failAdd?: boolean } = {}) {
  const policyRepo = createPolicyRepo(db);
  const grantRepo = createGrantRepo(db);
  const audit = createAuditRepo(db);
  const membership = fakeMembership({ failAdd: opts.failAdd });
  const svc = createGrantService({
    grantRepo,
    policyRepo,
    audit,
    membership: membership.m,
    isPropagationEnabled: async () => opts.propagation ?? true,
    now: () => FIXED,
  });
  const policy: JitPolicy = policyRepo.create({
    name: "Prod",
    targetResourceIds: ["r1"],
    traffic: { protocol: "all" },
    maxDurationMinutes: 120,
    requestableBy: { mode: "groups", groupIds: ["eng"] },
    approverCriteria: { mode: "any_admin" },
    pendingTtlMinutes: 1440,
    backingGroupId: "g1",
    netbirdPolicyId: "p1",
    createdByUserId: "adm",
  });
  return { policyRepo, grantRepo, audit, membership, svc, policy };
}

describe("grantService", () => {
  it("requests access, blocks duplicates and ineligible/over-max requests", () => {
    const { svc, policy } = setup();
    const g = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    expect(g.status).toBe("pending");

    expect(() => svc.requestAccess(policy.id, requester, { durationMinutes: 60 })).toThrow(); // in-flight
    const other: Caller = { ...requester, userId: "u9", autoGroups: ["other"] };
    expect(() => svc.requestAccess(policy.id, other, { durationMinutes: 60 })).toThrow(); // not eligible
    expect(() => svc.requestAccess(policy.id, { ...requester, userId: "u8" }, { durationMinutes: 999 })).toThrow(); // > max
  });

  it("approves: adds the group, activates, sets expiry = activation + duration", async () => {
    const { svc, membership, policy } = setup();
    const g = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    const active = await svc.approve(g.id, admin);
    expect(active.status).toBe("active");
    expect(active.activatedAt).toBe(FIXED.toISOString());
    expect(active.expiresAt).toBe("2026-06-26T13:00:00.000Z");
    expect(membership.calls).toEqual([{ op: "add", userId: "u1", groupId: "g1" }]);
  });

  it("blocks self-approval", async () => {
    const { svc, policy } = setup();
    const g = svc.requestAccess(policy.id, { ...admin, autoGroups: ["eng"] }, { durationMinutes: 60 });
    await expect(svc.approve(g.id, { ...admin, autoGroups: ["eng"] })).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
    });
  });

  it("refuses to approve when propagation is disabled and does not touch membership", async () => {
    const { svc, membership, policy } = setup({ propagation: false });
    const g = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    await expect(svc.approve(g.id, admin)).rejects.toMatchObject({ code: ErrorCodes.PROPAGATION_DISABLED });
    expect(membership.calls).toHaveLength(0);
  });

  it("marks the grant failed (and rethrows) if applying membership fails", async () => {
    const { svc, grantRepo, policy } = setup({ failAdd: true });
    const g = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    await expect(svc.approve(g.id, admin)).rejects.toMatchObject({ code: "netbird_unavailable" });
    expect(grantRepo.getById(g.id)!.status).toBe("failed");
  });

  it("expires and revokes by removing the group", async () => {
    const { svc, membership, grantRepo, policy } = setup();
    const g = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    await svc.approve(g.id, admin);
    membership.calls.length = 0;
    await svc.expire(grantRepo.getById(g.id)!);
    expect(grantRepo.getById(g.id)!.status).toBe("expired");
    expect(membership.calls).toEqual([{ op: "remove", userId: "u1", groupId: "g1" }]);
  });

  it("lets the requester cancel pending and end active early; admin revokes", async () => {
    const s1 = setup();
    const g1 = s1.svc.requestAccess(s1.policy.id, requester, { durationMinutes: 60 });
    expect(s1.svc.cancel(g1.id, requester).status).toBe("cancelled");

    const s2 = setup();
    const g2 = s2.svc.requestAccess(s2.policy.id, requester, { durationMinutes: 60 });
    await s2.svc.approve(g2.id, admin);
    expect((await s2.svc.endEarly(g2.id, requester)).status).toBe("revoked");

    const s3 = setup();
    const g3 = s3.svc.requestAccess(s3.policy.id, requester, { durationMinutes: 60 });
    await s3.svc.approve(g3.id, admin);
    expect((await s3.svc.revoke(g3.id, admin, "manual")).status).toBe("revoked");
  });

  it("blocks a second undecided request but allows an extension request while active", async () => {
    const { svc, policy } = setup();
    const g1 = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    // second request while g1 is still pending → blocked
    expect(() => svc.requestAccess(policy.id, requester, { durationMinutes: 60 })).toThrow();

    await svc.approve(g1.id, admin); // g1 now active
    const ext = svc.requestAccess(policy.id, requester, { durationMinutes: 90 });
    expect(ext.status).toBe("pending");
    expect(ext.supersedesGrantId).toBe(g1.id);

    // a third (double extension) is blocked again — ext is undecided
    expect(() => svc.requestAccess(policy.id, requester, { durationMinutes: 30 })).toThrow();
  });

  it("voids active and pending grants when a policy is deleted", async () => {
    const { svc, grantRepo, policy } = setup();
    const active = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    await svc.approve(active.id, admin);
    // A second eligible requester leaves a *pending* grant on the same policy.
    const pending = svc.requestAccess(policy.id, { ...requester, userId: "u2" }, { durationMinutes: 60 });
    expect(pending.status).toBe("pending");

    await svc.terminateAllForPolicy(policy.id, "policy_deleted");

    // Active membership is revoked; the pending zombie is cancelled (not left to 409 on approve).
    expect(grantRepo.getById(active.id)!.status).toBe("revoked");
    expect(grantRepo.getById(pending.id)!.status).toBe("cancelled");
  });
});
