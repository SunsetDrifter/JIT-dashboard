import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { createPolicyRepo } from "../src/db/repositories/policyRepo.js";
import { createAuditRepo } from "../src/db/repositories/auditRepo.js";
import { createPolicyService } from "../src/domain/policyService.js";
import { AppError, ErrorCodes } from "../src/lib/errors.js";
import type { Caller } from "../src/auth/identity.js";
import type { NetbirdClient } from "../src/netbird/client.js";
import type { CreateJitPolicyRequest } from "../src/schemas/policy.js";

const admin: Caller = {
  userId: "admin-1",
  email: "admin@x.com",
  role: "admin",
  isAdmin: true,
  autoGroups: [],
};

const createInput = (): CreateJitPolicyRequest => ({
  name: "Prod DB",
  targetResourceIds: ["r1"],
  maxDurationMinutes: 120,
  requestableBy: { mode: "groups", groupIds: ["eng"] },
  approverCriteria: { mode: "any_admin" },
});

function fakeNb(opts: { failPolicyCreate?: boolean } = {}) {
  const calls: { method: string; path: string }[] = [];
  const nb = {
    get: async () => [],
    post: async (path: string, body: unknown) => {
      calls.push({ method: "POST", path });
      if (path === "/groups") return { id: "g1", name: (body as { name: string }).name, issued: "api" };
      if (path === "/policies") {
        if (opts.failPolicyCreate) throw new AppError(ErrorCodes.NETBIRD_UNAVAILABLE, "boom", 502);
        return { id: "p1" };
      }
      return {};
    },
    put: async (path: string) => {
      calls.push({ method: "PUT", path });
      return {};
    },
    del: async (path: string) => {
      calls.push({ method: "DELETE", path });
      return undefined;
    },
  } as unknown as NetbirdClient;
  return { nb, calls };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

const service = (nb: NetbirdClient, revoke?: (id: string, reason: string) => Promise<void>) =>
  createPolicyService({
    repo: createPolicyRepo(db),
    audit: createAuditRepo(db),
    nb,
    marker: "jit:",
    defaultPendingTtlMinutes: 1440,
    revokeActiveGrantsForPolicy: revoke,
  });

describe("policyService", () => {
  it("creates a policy, provisions backing objects, stores their ids", async () => {
    const svc = service(fakeNb().nb);
    const p = await svc.create(createInput(), admin);
    expect(p.backingGroupId).toBe("g1");
    expect(p.netbirdPolicyId).toBe("p1");
    expect(p.pendingTtlMinutes).toBe(1440); // default applied
    expect(svc.list()).toHaveLength(1);
    expect(createAuditRepo(db).list().some((a) => a.action === "policy.create")).toBe(true);
  });

  it("rolls back the DB row if provisioning fails", async () => {
    const svc = service(fakeNb({ failPolicyCreate: true }).nb);
    await expect(svc.create(createInput(), admin)).rejects.toMatchObject({
      code: "netbird_unavailable",
    });
    expect(svc.list()).toHaveLength(0);
  });

  it("re-syncs the NetBird policy when resources change", async () => {
    const { nb, calls } = fakeNb();
    const svc = service(nb);
    const p = await svc.create(createInput(), admin);
    await svc.update(p.id, { targetResourceIds: ["r1", "r2"] }, admin);
    expect(calls.some((c) => c.method === "PUT" && c.path === "/policies/p1")).toBe(true);
  });

  it("cascades revoke + deprovision on delete", async () => {
    const { nb, calls } = fakeNb();
    const revoked: Array<{ id: string; reason: string }> = [];
    const svc = service(nb, async (id, reason) => {
      revoked.push({ id, reason });
    });
    const p = await svc.create(createInput(), admin);
    await svc.remove(p.id, admin);
    expect(revoked).toEqual([{ id: p.id, reason: "policy_deleted" }]);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/policies/p1",
      "/groups/g1",
    ]);
    expect(svc.list()).toHaveLength(0);
  });
});
