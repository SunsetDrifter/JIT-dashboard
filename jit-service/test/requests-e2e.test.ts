import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { openDb, type DB } from "../src/db/index.js";
import { createPolicyRepo } from "../src/db/repositories/policyRepo.js";
import { createGrantRepo } from "../src/db/repositories/grantRepo.js";
import { createAuditRepo } from "../src/db/repositories/auditRepo.js";
import { createMembership } from "../src/domain/membership.js";
import { createGrantService } from "../src/domain/grantService.js";
import { createGrantLifecycle } from "../src/domain/grantLifecycle.js";
import { KeyedMutex } from "../src/lib/mutex.js";
import type { Config } from "../src/config.js";
import type { JwtVerifier } from "../src/auth/jwt.js";
import type { Caller, IdentityResolver } from "../src/auth/identity.js";
import type { NetbirdClient } from "../src/netbird/client.js";
import type { PolicyService } from "../src/domain/policyService.js";

const requester: Caller = { userId: "u1", email: "u1@x.com", role: "user", isAdmin: false, autoGroups: [] };
const admin: Caller = { userId: "adm", email: "a@x.com", role: "admin", isAdmin: true, autoGroups: [] };

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

function build() {
  const policyRepo = createPolicyRepo(db);
  const grantRepo = createGrantRepo(db);
  const auditRepo = createAuditRepo(db);
  const policy = policyRepo.create({
    name: "Prod",
    targetResourceIds: ["r1"],
    traffic: { protocol: "all" },
    maxDurationMinutes: 120,
    requestableBy: { mode: "all" },
    approverCriteria: { mode: "any_admin" },
    pendingTtlMinutes: 1440,
    backingGroupId: "g1",
    netbirdPolicyId: "p1",
    createdByUserId: "adm",
  });

  const nb = {
    get: async (path: string) => {
      if (path.startsWith("/groups/")) return { id: path.split("/")[2], issued: "api" };
      if (path === "/users") return [{ id: "u1", email: "u1@x.com", role: "user", auto_groups: [] }];
      return [];
    },
    put: async () => ({}),
  } as unknown as NetbirdClient;

  const membership = createMembership({ nb, mutex: new KeyedMutex(), grantRepo, policyRepo });
  const grantService = createGrantService({
    grantRepo,
    policyRepo,
    audit: auditRepo,
    lifecycle: createGrantLifecycle({ grantRepo, audit: auditRepo }),
    membership,
    isPropagationEnabled: async () => true,
  });

  const jwt = { verify: async (token: string) => ({ sub: token, email: `${token}@x.com`, raw: {} }) } as unknown as JwtVerifier;
  const identity = {
    resolve: async (claims: { sub: string }) => (claims.sub === "admin" ? admin : requester),
  } as unknown as IdentityResolver;

  // Policy routes aren't exercised here (request → approve flow only), so stub the
  // service the server now always requires.
  const policyService = {} as unknown as PolicyService;
  const app = buildServer({
    config: {} as Config,
    db,
    nb,
    jwt,
    identity,
    policyService,
    grantService,
    auditRepo,
  });
  return { app, policy };
}

describe("request → approve (HTTP)", () => {
  it("a user requests and an admin approves into an active grant", async () => {
    const { app, policy } = build();

    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/requests",
      headers: { authorization: "Bearer user" },
      payload: { policyId: policy.id, durationMinutes: 60 },
    });
    expect(reqRes.statusCode).toBe(201);
    const grantId = reqRes.json().data.id as string;
    expect(reqRes.json().data.status).toBe("pending");

    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/admin/requests/${grantId}/approve`,
      headers: { authorization: "Bearer admin" },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().data.status).toBe("active");

    const activeRes = await app.inject({
      method: "GET",
      url: "/v1/admin/grants/active",
      headers: { authorization: "Bearer admin" },
    });
    expect(activeRes.json().data).toHaveLength(1);
  });

  it("rejects a self-approval", async () => {
    const { app, policy } = build();
    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/requests",
      headers: { authorization: "Bearer user" },
      payload: { policyId: policy.id, durationMinutes: 60 },
    });
    const grantId = reqRes.json().data.id as string;
    // "user" token resolves to the requester; approving own request is forbidden.
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/requests/${grantId}/approve`,
      headers: { authorization: "Bearer user" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("tolerates an empty JSON body on bodyless POSTs", async () => {
    const { app } = build();
    // Content-Type: application/json with no body must reach the handler (404 for a
    // missing grant), not fail with a 400 "Body cannot be empty" parse error.
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/requests/does-not-exist/approve",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(404);
  });
});
