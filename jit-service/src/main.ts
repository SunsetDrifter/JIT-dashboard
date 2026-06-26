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
import { createGrantService } from "./domain/grantService.js";
import { createMembership } from "./domain/membership.js";
import { KeyedMutex } from "./lib/mutex.js";
import { createScheduler } from "./scheduler/worker.js";
import { findOrphanMarkerGroups, reconcileOnce } from "./scheduler/reconcile.js";

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

  const mutex = new KeyedMutex();
  const membership = createMembership({ nb, mutex, grantRepo, policyRepo });

  // Short-TTL cache so each approve doesn't hit GET /accounts.
  const propCache = { value: false, at: 0 };
  const isPropagationEnabledCached = async (): Promise<boolean> => {
    if (Date.now() - propCache.at < 15_000) return propCache.value;
    try {
      propCache.value = await isGroupsPropagationEnabled(nb);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "propagation check failed; using last value");
    }
    propCache.at = Date.now();
    return propCache.value;
  };

  const grantService = createGrantService({
    grantRepo,
    policyRepo,
    audit: auditRepo,
    membership,
    isPropagationEnabled: isPropagationEnabledCached,
    allowSelfApproval: false,
  });

  const policyService = createPolicyService({
    repo: policyRepo,
    audit: auditRepo,
    nb,
    marker: config.groupMarker,
    defaultPendingTtlMinutes: config.pendingTtlMinutes,
    revokeActiveGrantsForPolicy: (id, reason) => grantService.revokeAllForPolicy(id, reason),
  });

  // Empty-DB guard: alert (don't auto-purge) if the DB looks freshly empty but
  // JIT-marked groups still have members — a sign of a lost/unmounted volume.
  if (grantRepo.countAll() === 0 && policyRepo.list().length === 0) {
    try {
      const orphans = await findOrphanMarkerGroups(nb, config.groupMarker, new Set());
      if (orphans.length > 0) {
        logger.error(
          { orphanGroups: orphans.length },
          "DB is empty but JIT-marked groups still have members — possible data loss. Reconcile will not remove them. Restore the DB if unexpected.",
        );
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "startup orphan check failed");
    }
  }

  const scheduler = createScheduler({
    grantRepo,
    grantService,
    reconcile: () => reconcileOnce({ nb, grantRepo, policyRepo, membership }),
    intervalSec: config.sweepIntervalSec,
    reconcileEnabled: config.reconcileEnabled,
    retentionDays: config.grantRetentionDays,
  });

  const app = buildServer({ config, db, nb, jwt, identity, policyService, grantService, auditRepo });
  scheduler.start();

  await app.listen({ port: config.listenPort, host: config.listenHost });
  logger.info({ port: config.listenPort, host: config.listenHost }, "jit-service listening");
}

main().catch((e) => {
  logger.fatal({ err: (e as Error).message }, "fatal startup error");
  process.exit(1);
});
