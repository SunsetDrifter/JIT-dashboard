import type { GrantRepo } from "../db/repositories/grantRepo.js";
import type { PolicyRepo } from "../db/repositories/policyRepo.js";
import type { Membership } from "../domain/membership.js";
import { logger } from "../lib/logger.js";
import type { NetbirdClient } from "../netbird/client.js";
import { listGroups } from "../netbird/groups.js";
import { listUsers } from "../netbird/users.js";

export interface ReconcileDeps {
  nb: NetbirdClient;
  grantRepo: GrantRepo;
  policyRepo: PolicyRepo;
  membership: Membership;
  /** Circuit breaker: if a pass would remove more members than this, skip removals + alert. */
  maxRemovalsPerPass?: number;
}

export interface ReconcileResult {
  added: number;
  removed: number;
  skippedRemovals: number;
}

/**
 * Make each enabled JIT policy's backing-group membership equal {users with an
 * active grant}: add missing members, remove drift. A mass-removal circuit
 * breaker guards against catastrophic state (e.g. a lost DB) wiping access.
 */
export async function reconcileOnce(deps: ReconcileDeps): Promise<ReconcileResult> {
  const policies = deps.policyRepo.listEnabled().filter((p) => p.backingGroupId);
  if (policies.length === 0) return { added: 0, removed: 0, skippedRemovals: 0 };

  const users = await listUsers(deps.nb);
  const planAdd: Array<{ userId: string; groupId: string }> = [];
  const planRemove: Array<{ userId: string; groupId: string }> = [];

  for (const policy of policies) {
    const gid = policy.backingGroupId!;
    const desired = new Set(deps.grantRepo.activeUserIdsForPolicy(policy.id));
    const current = new Set(
      users.filter((u) => u.auto_groups?.includes(gid)).map((u) => u.id),
    );
    for (const uid of desired) if (!current.has(uid)) planAdd.push({ userId: uid, groupId: gid });
    for (const uid of current) if (!desired.has(uid)) planRemove.push({ userId: uid, groupId: gid });
  }

  const max = deps.maxRemovalsPerPass ?? 100;
  let removals = planRemove;
  let skippedRemovals = 0;
  if (planRemove.length > max) {
    logger.error(
      { planned: planRemove.length, max },
      "reconcile removal count exceeds safety limit — skipping removals this pass (possible data loss?)",
    );
    skippedRemovals = planRemove.length;
    removals = [];
  }

  let added = 0;
  let removed = 0;
  for (const a of planAdd) {
    try {
      await deps.membership.add(a.userId, a.groupId);
      added++;
    } catch (e) {
      logger.warn({ err: (e as Error).message, ...a }, "reconcile add failed");
    }
  }
  for (const r of removals) {
    try {
      await deps.membership.remove(r.userId, r.groupId);
      removed++;
    } catch (e) {
      logger.warn({ err: (e as Error).message, ...r }, "reconcile remove failed");
    }
  }
  if (added || removed || skippedRemovals) {
    logger.info({ added, removed, skippedRemovals }, "reconcile pass complete");
  }
  return { added, removed, skippedRemovals };
}

/**
 * Marker-named groups that have members but no current backing policy record —
 * a sign of partial/total DB loss. Returned for alerting; not auto-purged.
 */
export async function findOrphanMarkerGroups(
  nb: NetbirdClient,
  marker: string,
  knownGroupIds: Set<string>,
): Promise<string[]> {
  const [groups, users] = await Promise.all([listGroups(nb), listUsers(nb)]);
  const membered = new Set<string>();
  for (const u of users) for (const g of u.auto_groups ?? []) membered.add(g);
  return groups
    .filter((g) => g.name.startsWith(marker) && !knownGroupIds.has(g.id) && membered.has(g.id))
    .map((g) => g.id);
}
