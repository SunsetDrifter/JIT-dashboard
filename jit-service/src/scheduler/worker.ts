import type { GrantRepo } from "../db/repositories/grantRepo.js";
import type { GrantService } from "../domain/grantService.js";
import { logger } from "../lib/logger.js";

export interface SchedulerDeps {
  grantRepo: GrantRepo;
  grantService: GrantService;
  reconcile: () => Promise<unknown>;
  intervalSec: number;
  reconcileEnabled: boolean;
  now?: () => Date;
}

/**
 * Periodic sweep: auto-deny stale pending requests, expire elapsed grants,
 * retry failed applies, then reconcile. Crash-safe — all state is in SQLite,
 * so a restart resumes from wall-clock comparisons. A re-entrancy guard skips a
 * tick if the previous one is still running (slow NetBird can't stack ticks).
 */
export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? (() => new Date());
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const iso = now().toISOString();

      for (const grant of deps.grantRepo.listPendingExpiredBefore(iso)) {
        try {
          deps.grantService.autoDenyPending(grant);
        } catch (e) {
          logger.warn({ err: (e as Error).message, grantId: grant.id }, "auto-deny failed");
        }
      }

      for (const grant of deps.grantRepo.listActiveExpiredBefore(iso)) {
        try {
          await deps.grantService.expire(grant);
        } catch (e) {
          // Keep the grant active and retry next tick — never silently fail open.
          logger.warn({ err: (e as Error).message, grantId: grant.id }, "expire failed; will retry");
        }
      }

      for (const grant of deps.grantRepo.listByStatus("failed")) {
        try {
          await deps.grantService.retryFailed(grant);
        } catch (e) {
          logger.warn({ err: (e as Error).message, grantId: grant.id }, "retry of failed grant failed");
        }
      }

      if (deps.reconcileEnabled) {
        try {
          await deps.reconcile();
        } catch (e) {
          logger.warn({ err: (e as Error).message }, "reconcile pass failed");
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(): void {
      if (timer) return;
      timer = setInterval(() => void tick(), deps.intervalSec * 1000);
      timer.unref?.();
      logger.info({ intervalSec: deps.intervalSec, reconcile: deps.reconcileEnabled }, "scheduler started");
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
