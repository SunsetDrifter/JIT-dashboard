import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { createPolicyRepo } from "../src/db/repositories/policyRepo.js";
import { createGrantRepo } from "../src/db/repositories/grantRepo.js";
import { createAuditRepo } from "../src/db/repositories/auditRepo.js";
import { createGrantService } from "../src/domain/grantService.js";
import { createGrantLifecycle } from "../src/domain/grantLifecycle.js";
import { createScheduler } from "../src/scheduler/worker.js";
import { reconcileOnce } from "../src/scheduler/reconcile.js";
import type { Membership } from "../src/domain/membership.js";
import type { NetbirdClient } from "../src/netbird/client.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");

function fakeMembership() {
  const calls: Array<{ op: "add" | "remove"; userId: string; groupId: string }> = [];
  const m: Membership = {
    add: async (userId, groupId) => void calls.push({ op: "add", userId, groupId }),
    remove: async (userId, groupId) => void calls.push({ op: "remove", userId, groupId }),
  };
  return { calls, m };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("scheduler worker", () => {
  it("auto-denies stale pending and expires elapsed active grants", async () => {
    const policyRepo = createPolicyRepo(db);
    const grantRepo = createGrantRepo(db);
    const membership = fakeMembership();
    const audit = createAuditRepo(db);
    const svc = createGrantService({
      grantRepo,
      policyRepo,
      audit,
      lifecycle: createGrantLifecycle({ grantRepo, audit }),
      membership: membership.m,
      isPropagationEnabled: async () => true,
      now: () => NOW,
    });
    const policy = policyRepo.create({
      name: "P",
      targetResourceIds: ["r1"],
      traffic: { protocol: "all" },
      maxDurationMinutes: 120,
      requestableBy: { mode: "all" },
      approverCriteria: { mode: "any_admin" },
      pendingTtlMinutes: 60,
      backingGroupId: "g1",
      createdByUserId: "adm",
    });

    const stalePending = grantRepo.create({
      policyId: policy.id,
      requesterUserId: "u-pending",
      requestedDurationMinutes: 30,
      pendingExpiresAt: "2026-06-26T11:00:00.000Z",
    });
    const elapsedActive = grantRepo.create({ policyId: policy.id, requesterUserId: "u-active", requestedDurationMinutes: 30 });
    grantRepo.transitionFrom(elapsedActive.id, "pending", {
      status: "active",
      activatedAt: "2026-06-26T11:00:00.000Z",
      expiresAt: "2026-06-26T11:30:00.000Z",
    });

    const scheduler = createScheduler({
      grantRepo,
      grantService: svc,
      reconcile: async () => undefined,
      intervalSec: 30,
      reconcileEnabled: false,
      now: () => NOW,
    });
    await scheduler.tick();

    expect(grantRepo.getById(stalePending.id)!.status).toBe("denied");
    expect(grantRepo.getById(elapsedActive.id)!.status).toBe("expired");
    expect(membership.calls).toContainEqual({ op: "remove", userId: "u-active", groupId: "g1" });
  });
});

describe("reconcileOnce", () => {
  function nbWithUsers(users: Array<{ id: string; auto_groups: string[] }>): NetbirdClient {
    return { get: async () => users } as unknown as NetbirdClient;
  }

  function fixture() {
    const policyRepo = createPolicyRepo(db);
    const grantRepo = createGrantRepo(db);
    const policy = policyRepo.create({
      name: "P",
      targetResourceIds: ["r1"],
      traffic: { protocol: "all" },
      maxDurationMinutes: 120,
      requestableBy: { mode: "all" },
      approverCriteria: { mode: "any_admin" },
      pendingTtlMinutes: 60,
      backingGroupId: "g1",
      createdByUserId: "adm",
    });
    const g = grantRepo.create({ policyId: policy.id, requesterUserId: "u1", requestedDurationMinutes: 30 });
    grantRepo.transitionFrom(g.id, "pending", { status: "active", activatedAt: NOW.toISOString(), expiresAt: "2026-06-26T13:00:00.000Z" });
    return { policyRepo, grantRepo };
  }

  it("adds missing members and removes drift", async () => {
    const { policyRepo, grantRepo } = fixture();
    const membership = fakeMembership();
    // u1 should be in g1 (active grant) but isn't; u2 is in g1 but shouldn't be.
    const nb = nbWithUsers([
      { id: "u1", auto_groups: [] },
      { id: "u2", auto_groups: ["g1"] },
    ]);
    const res = await reconcileOnce({ nb, grantRepo, policyRepo, membership: membership.m });
    expect(res).toMatchObject({ added: 1, removed: 1 });
    expect(membership.calls).toContainEqual({ op: "add", userId: "u1", groupId: "g1" });
    expect(membership.calls).toContainEqual({ op: "remove", userId: "u2", groupId: "g1" });
  });

  it("circuit-breaks mass removals", async () => {
    const { policyRepo, grantRepo } = fixture();
    const membership = fakeMembership();
    const nb = nbWithUsers([
      { id: "u1", auto_groups: ["g1"] },
      { id: "u2", auto_groups: ["g1"] },
      { id: "u3", auto_groups: ["g1"] },
    ]);
    const res = await reconcileOnce({ nb, grantRepo, policyRepo, membership: membership.m, maxRemovalsPerPass: 0 });
    expect(res.removed).toBe(0);
    expect(res.skippedRemovals).toBeGreaterThan(0);
    expect(membership.calls.some((c) => c.op === "remove")).toBe(false);
  });
});
