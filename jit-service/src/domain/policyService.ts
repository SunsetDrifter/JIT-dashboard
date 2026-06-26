import type { Caller } from "../auth/identity.js";
import { logger } from "../lib/logger.js";
import type { NetbirdClient } from "../netbird/client.js";
import type { AuditRepo } from "../db/repositories/auditRepo.js";
import type { PolicyRepo } from "../db/repositories/policyRepo.js";
import { deprovisionBacking, provisionBacking, updateBackingPolicy } from "./provisioning.js";
import type { CreateJitPolicyRequest, UpdateJitPolicyRequest } from "../schemas/policy.js";
import type { JitPolicy, Traffic } from "./types.js";

export interface PolicyServiceDeps {
  repo: PolicyRepo;
  audit: AuditRepo;
  nb: NetbirdClient;
  marker: string;
  defaultPendingTtlMinutes: number;
  /** Injected by Phase 4 wiring so deleting a JIT policy cascades to active grants. */
  revokeActiveGrantsForPolicy?: (policyId: string, reason: string) => Promise<void>;
}

const DEFAULT_TRAFFIC: Traffic = { protocol: "all" };

export function createPolicyService(deps: PolicyServiceDeps) {
  const { repo, audit, nb, marker } = deps;

  return {
    list: (): JitPolicy[] => repo.list(),
    get: (id: string): JitPolicy | null => repo.getById(id),

    async create(input: CreateJitPolicyRequest, caller: Caller): Promise<JitPolicy> {
      // 1. Persist first (no backing ids yet) so we have a stable id.
      const draft = repo.create({
        name: input.name,
        description: input.description,
        targetResourceIds: input.targetResourceIds,
        traffic: input.traffic ?? DEFAULT_TRAFFIC,
        maxDurationMinutes: input.maxDurationMinutes,
        requestableBy: input.requestableBy,
        approverCriteria: input.approverCriteria,
        pendingTtlMinutes: input.pendingTtlMinutes ?? deps.defaultPendingTtlMinutes,
        createdByUserId: caller.userId,
        createdByEmail: caller.email,
      });

      // 2. Provision the backing group + NetBird policy; roll back the row on failure.
      try {
        const { backingGroupId, netbirdPolicyId } = await provisionBacking(nb, marker, {
          name: draft.name,
          targetResourceIds: draft.targetResourceIds,
          traffic: draft.traffic,
        });
        const provisioned = repo.update(draft.id, { backingGroupId, netbirdPolicyId });
        audit.append({
          action: "policy.create",
          actorUserId: caller.userId,
          actorEmail: caller.email,
          policyId: provisioned.id,
          detail: { name: provisioned.name, backingGroupId, netbirdPolicyId },
        });
        return provisioned;
      } catch (e) {
        repo.remove(draft.id);
        logger.error({ err: (e as Error).message }, "JIT policy provisioning failed; rolled back");
        throw e;
      }
    },

    async update(id: string, patch: UpdateJitPolicyRequest, caller: Caller): Promise<JitPolicy> {
      const before = repo.getById(id);
      const updated = repo.update(id, patch);
      // Re-sync the NetBird policy if anything affecting it changed.
      const touchesPolicy =
        patch.targetResourceIds !== undefined ||
        patch.traffic !== undefined ||
        (patch.name !== undefined && patch.name !== before?.name);
      if (touchesPolicy) {
        await updateBackingPolicy(nb, marker, updated);
      }
      audit.append({
        action: "policy.update",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: id,
        detail: { fields: Object.keys(patch) },
      });
      return updated;
    },

    async remove(id: string, caller: Caller): Promise<void> {
      const policy = repo.getById(id);
      if (!policy) return; // idempotent
      // Cascade: revoke active grants before tearing down the backing objects.
      if (deps.revokeActiveGrantsForPolicy) {
        await deps.revokeActiveGrantsForPolicy(id, "policy_deleted");
      }
      await deprovisionBacking(nb, policy);
      repo.remove(id);
      audit.append({
        action: "policy.delete",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: id,
        detail: { name: policy.name },
      });
    },
  };
}

export type PolicyService = ReturnType<typeof createPolicyService>;
