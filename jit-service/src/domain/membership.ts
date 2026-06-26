import type { GrantRepo } from "../db/repositories/grantRepo.js";
import type { PolicyRepo } from "../db/repositories/policyRepo.js";
import { AppError, ErrorCodes } from "../lib/errors.js";
import type { KeyedMutex } from "../lib/mutex.js";
import type { NetbirdClient } from "../netbird/client.js";
import { findUserById, putUserAutoGroups } from "../netbird/users.js";
import { assertApiGroup } from "./provisioning.js";

export interface MembershipDeps {
  nb: NetbirdClient;
  mutex: KeyedMutex;
  grantRepo: GrantRepo;
  policyRepo: PolicyRepo;
}

/**
 * The single place that mutates a user's auto_groups. Always read-merge-write
 * against a fresh user object, guarded to API-issued groups, serialized per
 * user, and idempotent. Removal skips the group if another active grant for the
 * same user still needs it (defence-in-depth; invariants make this rare).
 */
export function createMembership(deps: MembershipDeps) {
  const { nb, mutex, grantRepo, policyRepo } = deps;

  return {
    add(userId: string, groupId: string): Promise<void> {
      return mutex.run(userId, async () => {
        await assertApiGroup(nb, groupId);
        const user = await findUserById(nb, userId);
        if (!user) {
          throw new AppError(ErrorCodes.NOT_FOUND, `NetBird user ${userId} not found`, 404);
        }
        if (!user.auto_groups.includes(groupId)) {
          await putUserAutoGroups(nb, user, Array.from(new Set([...user.auto_groups, groupId])));
        }
      });
    },

    remove(userId: string, groupId: string, excludeGrantId?: string): Promise<void> {
      return mutex.run(userId, async () => {
        const stillNeeded = grantRepo
          .listByRequester(userId, "active")
          .filter((g) => g.id !== excludeGrantId)
          .some((g) => policyRepo.getById(g.policyId)?.backingGroupId === groupId);
        if (stillNeeded) return;

        await assertApiGroup(nb, groupId);
        const user = await findUserById(nb, userId);
        if (!user) return; // already gone — desired end state holds
        if (user.auto_groups.includes(groupId)) {
          await putUserAutoGroups(
            nb,
            user,
            user.auto_groups.filter((g) => g !== groupId),
          );
        }
      });
    },
  };
}

export type Membership = ReturnType<typeof createMembership>;
