import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { NetbirdClient } from "./netbird/client.js";
import { listUsers } from "./netbird/users.js";
import { isGroupsPropagationEnabled } from "./netbird/accounts.js";
import { JwtVerifier } from "./auth/jwt.js";
import { IdentityResolver } from "./auth/identity.js";
import { buildServer } from "./server.js";
import { logger } from "./lib/logger.js";
import { createPolicyRepo } from "./db/repositories/policyRepo.js";
import { createGrantRepo } from "./db/repositories/grantRepo.js";
import { createAuditRepo } from "./db/repositories/auditRepo.js";
import { createPolicyService } from "./domain/policyService.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const nb = new NetbirdClient({
    apiBase: config.netbirdApiBase,
    serviceToken: config.serviceToken,
  });

  // Startup capability probe: a usable, admin-scoped service token can list users.
  try {
    const users = await listUsers(nb);
    logger.info({ users: users.length }, "NetBird service token validated");
  } catch (e) {
    logger.fatal(
      { err: (e as Error).message },
      "NetBird service-token probe failed — refusing to start",
    );
    process.exit(1);
  }

  // Propagation precondition: warn loudly (the whole mechanism no-ops without it).
  try {
    if (!(await isGroupsPropagationEnabled(nb))) {
      logger.warn(
        "Account setting groups_propagation_enabled is OFF — JIT grants will NOT reach peers until it is enabled",
      );
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "Could not read account settings for propagation check");
  }

  const jwt = new JwtVerifier({ authority: config.authAuthority, audience: config.authAudience });
  const identity = new IdentityResolver(nb);

  const policyRepo = createPolicyRepo(db);
  const grantRepo = createGrantRepo(db);
  const auditRepo = createAuditRepo(db);
  const policyService = createPolicyService({
    repo: policyRepo,
    audit: auditRepo,
    nb,
    marker: config.groupMarker,
    defaultPendingTtlMinutes: config.pendingTtlMinutes,
    // revokeActiveGrantsForPolicy is wired to grantService in Phase 4.
  });
  void grantRepo; // used by grantService in Phase 4

  const app = buildServer({ config, db, nb, jwt, identity, policyService });
  // NOTE: the expiry/reconcile scheduler is started here in Phase 4.

  await app.listen({ port: config.listenPort, host: config.listenHost });
  logger.info({ port: config.listenPort, host: config.listenHost }, "jit-service listening");
}

main().catch((e) => {
  logger.fatal({ err: (e as Error).message }, "fatal startup error");
  process.exit(1);
});
