import { beforeEach, describe, expect, it } from "vitest";
import { buildServer, type ServerDeps } from "../src/server.js";
import { openDb } from "../src/db/index.js";
import type { Config } from "../src/config.js";
import type { JwtVerifier } from "../src/auth/jwt.js";
import type { Caller, IdentityResolver } from "../src/auth/identity.js";
import type { NetbirdClient } from "../src/netbird/client.js";
import type { PolicyService } from "../src/domain/policyService.js";
import type { GrantService } from "../src/domain/grantService.js";
import type { AuditRepo } from "../src/db/repositories/auditRepo.js";

function makeDeps(): ServerDeps {
  const db = openDb(":memory:");
  const caller: Caller = {
    userId: "u1",
    email: "a@b.com",
    role: "admin",
    isAdmin: true,
    autoGroups: [],
  };
  const jwt = {
    verify: async () => ({ sub: "s", email: "a@b.com", raw: {} }),
  } as unknown as JwtVerifier;
  const identity = { resolve: async () => caller } as unknown as IdentityResolver;
  const nb = {
    get: async (path: string) =>
      path === "/accounts" ? [{ id: "acc", settings: { groups_propagation_enabled: true } }] : [],
  } as unknown as NetbirdClient;
  // These routes aren't exercised here (only /healthz and /v1/me), so stub the
  // services the server now always requires.
  const policyService = {} as unknown as PolicyService;
  const grantService = {} as unknown as GrantService;
  const auditRepo = {} as unknown as AuditRepo;
  return { config: {} as Config, db, nb, jwt, identity, policyService, grantService, auditRepo };
}

describe("server", () => {
  let app: ReturnType<typeof buildServer>;
  beforeEach(() => {
    app = buildServer(makeDeps());
  });

  it("GET /healthz is public and reports ok", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, data: { status: "ok" } });
  });

  it("GET /v1/me without a bearer token is 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ success: false, error: { code: "unauthenticated" } });
  });

  it("GET /v1/me returns the resolved caller and propagation flag", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer good" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: { userId: "u1", isAdmin: true, propagationEnabled: true },
    });
  });
});
