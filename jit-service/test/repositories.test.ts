import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { createPolicyRepo, type CreatePolicyInput } from "../src/db/repositories/policyRepo.js";
import { createGrantRepo } from "../src/db/repositories/grantRepo.js";
import { createAuditRepo } from "../src/db/repositories/auditRepo.js";
import { isAppError } from "../src/lib/errors.js";

const policyInput = (over: Partial<CreatePolicyInput> = {}): CreatePolicyInput => ({
  name: "Prod DB access",
  description: "Temporary access to the prod database",
  targetResourceIds: ["res-1", "res-2"],
  traffic: { protocol: "all" },
  maxDurationMinutes: 240,
  requestableBy: { mode: "groups", groupIds: ["grp-eng"] },
  approverCriteria: { mode: "any_admin" },
  pendingTtlMinutes: 1440,
  createdByUserId: "admin-1",
  createdByEmail: "admin@example.com",
  ...over,
});

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("policyRepo", () => {
  it("creates, reads, and applies defaults + JSON round-trip", () => {
    const repo = createPolicyRepo(db);
    const created = repo.create(policyInput());
    expect(created.id).toBeTruthy();
    expect(created.enabled).toBe(true);
    expect(created.backingGroupId).toBeNull();

    const got = repo.getById(created.id);
    expect(got).not.toBeNull();
    expect(got!.targetResourceIds).toEqual(["res-1", "res-2"]);
    expect(got!.requestableBy).toEqual({ mode: "groups", groupIds: ["grp-eng"] });
    expect(got!.traffic).toEqual({ protocol: "all" });
    expect(repo.list()).toHaveLength(1);
  });

  it("updates fields (incl. provisioning ids) and bumps updatedAt", () => {
    let t = 0;
    const repo = createPolicyRepo(db, () => `2026-06-26T00:00:0${t++}.000Z`);
    const created = repo.create(policyInput());
    const updated = repo.update(created.id, {
      backingGroupId: "grp-jit-1",
      netbirdPolicyId: "pol-jit-1",
      enabled: false,
    });
    expect(updated.backingGroupId).toBe("grp-jit-1");
    expect(updated.netbirdPolicyId).toBe("pol-jit-1");
    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(repo.listEnabled()).toHaveLength(0);
  });

  it("throws NOT_FOUND updating a missing policy", () => {
    const repo = createPolicyRepo(db);
    try {
      repo.update("nope", { name: "x" });
      expect.unreachable();
    } catch (e) {
      expect(isAppError(e)).toBe(true);
    }
  });
});

describe("grantRepo", () => {
  it("creates pending grants and enforces in-flight counting", () => {
    const policies = createPolicyRepo(db);
    const grants = createGrantRepo(db);
    const p = policies.create(policyInput());

    const g = grants.create({
      policyId: p.id,
      requesterUserId: "user-1",
      requesterEmail: "u1@example.com",
      requestedDurationMinutes: 60,
      pendingExpiresAt: "2026-06-27T00:00:00.000Z",
    });
    expect(g.status).toBe("pending");
    expect(grants.countInFlight("user-1", p.id)).toBe(1);
    expect(grants.countInFlight("user-2", p.id)).toBe(0);
    expect(grants.listByRequester("user-1")).toHaveLength(1);
  });

  it("queries active + expired grants by boundary", () => {
    const policies = createPolicyRepo(db);
    const grants = createGrantRepo(db);
    const p = policies.create(policyInput());

    const g = grants.create({ policyId: p.id, requesterUserId: "user-1", requestedDurationMinutes: 60 });
    grants.update(g.id, {
      status: "active",
      activatedAt: "2026-06-26T10:00:00.000Z",
      expiresAt: "2026-06-26T11:00:00.000Z",
    });

    expect(grants.listActive()).toHaveLength(1);
    expect(grants.activeUserIdsForPolicy(p.id)).toEqual(["user-1"]);
    // Not yet expired at 10:30
    expect(grants.listActiveExpiredBefore("2026-06-26T10:30:00.000Z")).toHaveLength(0);
    // Expired at/after 11:00
    expect(grants.listActiveExpiredBefore("2026-06-26T11:00:00.000Z")).toHaveLength(1);
  });

  it("finds pending grants past their TTL", () => {
    const policies = createPolicyRepo(db);
    const grants = createGrantRepo(db);
    const p = policies.create(policyInput());
    grants.create({
      policyId: p.id,
      requesterUserId: "user-1",
      requestedDurationMinutes: 60,
      pendingExpiresAt: "2026-06-26T01:00:00.000Z",
    });
    expect(grants.listPendingExpiredBefore("2026-06-26T00:59:00.000Z")).toHaveLength(0);
    expect(grants.listPendingExpiredBefore("2026-06-26T01:00:00.000Z")).toHaveLength(1);
  });

  it("cleans up terminal grants older than a cutoff", () => {
    const grants = createGrantRepo(db, () => "2026-01-01T00:00:00.000Z");
    const policies = createPolicyRepo(db);
    const p = policies.create(policyInput());
    const g = grants.create({ policyId: p.id, requesterUserId: "u", requestedDurationMinutes: 10 });
    grants.update(g.id, { status: "revoked", revokedAt: "2026-01-02T00:00:00.000Z" });
    expect(grants.deleteTerminalOlderThan("2026-01-01T00:00:00.000Z")).toBe(0);
    expect(grants.deleteTerminalOlderThan("2026-06-01T00:00:00.000Z")).toBe(1);
    expect(grants.listByStatus("revoked")).toHaveLength(0);
  });
});

describe("auditRepo", () => {
  it("appends and lists entries with JSON detail", () => {
    const audit = createAuditRepo(db);
    audit.append({ action: "grant.activate", grantId: "g1", detail: { groupId: "grp-1" } });
    audit.append({ action: "grant.expire", grantId: "g1" });
    audit.append({ action: "policy.create", policyId: "p1" });

    expect(audit.list()).toHaveLength(3);
    const forGrant = audit.listForGrant("g1");
    expect(forGrant).toHaveLength(2);
    const activate = forGrant.find((e) => e.action === "grant.activate");
    expect(activate?.detail).toEqual({ groupId: "grp-1" });
  });
});
