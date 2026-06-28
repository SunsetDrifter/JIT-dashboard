import { buildServer } from "../../src/server.js";
import { openDb, type DB } from "../../src/db/index.js";
import { createPolicyRepo } from "../../src/db/repositories/policyRepo.js";
import { createGrantRepo } from "../../src/db/repositories/grantRepo.js";
import { createAuditRepo } from "../../src/db/repositories/auditRepo.js";
import { createMembership } from "../../src/domain/membership.js";
import { createGrantService } from "../../src/domain/grantService.js";
import { createGrantLifecycle } from "../../src/domain/grantLifecycle.js";
import { createPolicyService } from "../../src/domain/policyService.js";
import { KeyedMutex } from "../../src/lib/mutex.js";
import type { Config } from "../../src/config.js";
import type { JwtVerifier } from "../../src/auth/jwt.js";
import type { Caller, IdentityResolver } from "../../src/auth/identity.js";
import type { NetbirdClient } from "../../src/netbird/client.js";

/**
 * In-process HTTP harness for the JIT API: a real Fastify server + real repos,
 * services, and grant-lifecycle, with NetBird and the JWT/identity layer mocked.
 * Drive it with `app.inject`. No running stack required — pure vitest.
 *
 * Auth: send `Authorization: Bearer <key>` where <key> is one of CALLERS. The
 * mock verifier maps the bearer straight to that caller (admin / user / etc.).
 */
export const CALLERS: Record<string, Caller> = {
  admin: { userId: "admin", email: "admin@x.com", role: "admin", isAdmin: true, autoGroups: [] },
  user: { userId: "u1", email: "u1@x.com", role: "user", isAdmin: false, autoGroups: ["eng"] },
  user2: { userId: "u2", email: "u2@x.com", role: "user", isAdmin: false, autoGroups: ["eng"] },
};

export const auth = (key: keyof typeof CALLERS | string) => ({ authorization: `Bearer ${key}` });

function fakeNb() {
  const calls: { method: string; path: string }[] = [];
  let groupSeq = 0;
  let policySeq = 0;
  const users = [
    { id: "u1", email: "u1@x.com", role: "user", auto_groups: [] as string[] },
    { id: "u2", email: "u2@x.com", role: "user", auto_groups: [] as string[] },
    { id: "admin", email: "admin@x.com", role: "admin", auto_groups: [] as string[] },
  ];
  const nb = {
    get: async (path: string) => {
      calls.push({ method: "GET", path });
      if (path === "/users") return users;
      if (path.startsWith("/groups/")) return { id: path.split("/")[2], issued: "api", peers: [] };
      return [];
    },
    post: async (path: string, body: unknown) => {
      calls.push({ method: "POST", path });
      if (path === "/groups") return { id: `g${++groupSeq}`, name: (body as { name: string }).name, issued: "api" };
      if (path === "/policies") return { id: `p${++policySeq}` };
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

export function buildApi(opts: { allowSelfApproval?: boolean } = {}) {
  const db: DB = openDb(":memory:");
  const { nb, calls } = fakeNb();
  const policyRepo = createPolicyRepo(db);
  const grantRepo = createGrantRepo(db);
  const auditRepo = createAuditRepo(db);
  const membership = createMembership({ nb, mutex: new KeyedMutex(), grantRepo, policyRepo });
  const lifecycle = createGrantLifecycle({ grantRepo, audit: auditRepo });
  const grantService = createGrantService({
    grantRepo,
    policyRepo,
    audit: auditRepo,
    lifecycle,
    membership,
    isPropagationEnabled: async () => true,
    allowSelfApproval: opts.allowSelfApproval ?? false,
  });
  const policyService = createPolicyService({
    repo: policyRepo,
    audit: auditRepo,
    nb,
    marker: "jit:",
    defaultPendingTtlMinutes: 1440,
    terminateGrantsForPolicy: (id, reason) => grantService.terminateAllForPolicy(id, reason),
  });
  const jwt = {
    verify: async (token: string) => ({ sub: token, email: `${token}@x.com`, raw: {} }),
  } as unknown as JwtVerifier;
  const identity = {
    resolve: async (claims: { sub: string }) =>
      CALLERS[claims.sub] ?? {
        userId: claims.sub,
        email: `${claims.sub}@x.com`,
        role: "user",
        isAdmin: false,
        autoGroups: [],
      },
  } as unknown as IdentityResolver;

  const app = buildServer({ config: {} as Config, db, nb, jwt, identity, policyService, grantService, auditRepo });
  return { app, db, nb, calls, policyRepo, grantRepo, auditRepo, policyService, grantService };
}

/** A valid JIT policy (provisioned via the real service) for grant-flow tests. */
export async function seedPolicy(h: ReturnType<typeof buildApi>, over: Record<string, unknown> = {}) {
  const input = {
    name: "Prod",
    targetResourceIds: ["r1"],
    maxDurationMinutes: 120,
    requestableBy: { mode: "all" as const },
    approverCriteria: { mode: "any_admin" as const },
    ...over,
  } as Parameters<typeof h.policyService.create>[0];
  return h.policyService.create(input, CALLERS.admin!);
}
