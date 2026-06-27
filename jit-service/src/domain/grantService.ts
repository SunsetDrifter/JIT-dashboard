import type { Caller } from "../auth/identity.js";
import { assertCanApprove, assertSelf, isEligible } from "../auth/guards.js";
import type { AuditRepo } from "../db/repositories/auditRepo.js";
import type { GrantRepo } from "../db/repositories/grantRepo.js";
import type { PolicyRepo } from "../db/repositories/policyRepo.js";
import { AppError, ErrorCodes } from "../lib/errors.js";
import type { Membership } from "./membership.js";
import type { GrantStatus, JitGrant, JitPolicy } from "./types.js";

export interface GrantServiceDeps {
  grantRepo: GrantRepo;
  policyRepo: PolicyRepo;
  audit: AuditRepo;
  membership: Membership;
  isPropagationEnabled: () => Promise<boolean>;
  allowSelfApproval?: boolean;
  now?: () => Date;
}

const minutesFrom = (d: Date, minutes: number): string =>
  new Date(d.getTime() + minutes * 60_000).toISOString();

export function createGrantService(deps: GrantServiceDeps) {
  const { grantRepo, policyRepo, audit, membership } = deps;
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();
  /** Attach the (current) policy name so list views can show it without a second lookup. */
  const withPolicy = (g: JitGrant): JitGrant => ({ ...g, policyName: policyRepo.getById(g.policyId)?.name });

  const mustGrant = (id: string): JitGrant => {
    const g = grantRepo.getById(id);
    if (!g) throw new AppError(ErrorCodes.NOT_FOUND, `Request ${id} not found`, 404);
    return g;
  };
  const policyFor = (g: JitGrant): JitPolicy => {
    const p = policyRepo.getById(g.policyId);
    if (!p) throw new AppError(ErrorCodes.CONFLICT, "JIT policy no longer exists", 409);
    return p;
  };

  /** Add the backing group; transition to active (or failed). Shared by approve + retry. */
  async function activate(grantId: string, policy: JitPolicy, actor?: Caller): Promise<JitGrant> {
    if (!policy.backingGroupId) {
      throw new AppError(ErrorCodes.CONFLICT, "JIT policy is not provisioned", 409);
    }
    const grant = mustGrant(grantId);
    try {
      await membership.add(grant.requesterUserId, policy.backingGroupId);
      const startedAt = now();
      const active = grantRepo.update(grantId, {
        status: "active",
        activatedAt: startedAt.toISOString(),
        expiresAt: minutesFrom(startedAt, grant.requestedDurationMinutes),
        lastError: undefined,
      });
      audit.append({
        action: "grant.activate",
        actorUserId: actor?.userId,
        actorEmail: actor?.email,
        policyId: policy.id,
        grantId,
        detail: { expiresAt: active.expiresAt },
      });
      // If this grant renews an existing one, retire the prior grant — but never
      // remove the backing group (this grant now holds it). Only supersede if the
      // target is still active; if it already expired/ended, leave its status intact.
      if (active.supersedesGrantId) {
        const prior = grantRepo.getById(active.supersedesGrantId);
        if (prior && prior.status === "active") {
          grantRepo.update(prior.id, {
            status: "superseded",
            revokedAt: iso(),
            revokeReason: "superseded_by_renewal",
          });
          audit.append({
            action: "grant.supersede",
            actorUserId: actor?.userId,
            actorEmail: actor?.email,
            policyId: policy.id,
            grantId: prior.id,
            detail: { supersededBy: grantId },
          });
        }
      }
      return active;
    } catch (e) {
      grantRepo.update(grantId, { status: "failed", lastError: (e as Error).message });
      audit.append({ action: "grant.fail", policyId: policy.id, grantId, detail: { error: (e as Error).message } });
      throw e;
    }
  }

  /** Remove the backing group; transition to a terminal status. Shared by expire/revoke/end. */
  async function deactivate(
    grant: JitGrant,
    terminal: Extract<GrantStatus, "expired" | "revoked">,
    reason: string,
    actor?: Caller,
  ): Promise<JitGrant> {
    const policy = policyRepo.getById(grant.policyId);
    if (policy?.backingGroupId) {
      await membership.remove(grant.requesterUserId, policy.backingGroupId, grant.id);
    }
    const updated = grantRepo.update(grant.id, {
      status: terminal,
      revokedAt: iso(),
      revokeReason: reason,
    });
    audit.append({
      action: terminal === "expired" ? "grant.expire" : "grant.revoke",
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      policyId: grant.policyId,
      grantId: grant.id,
      detail: { reason },
    });
    return updated;
  }

  return {
    requestAccess(
      policyId: string,
      caller: Caller,
      input: { durationMinutes: number; justification?: string },
    ): JitGrant {
      const policy = policyRepo.getById(policyId);
      if (!policy || !policy.enabled) {
        throw new AppError(ErrorCodes.NOT_FOUND, "JIT policy not available", 404);
      }
      if (!isEligible(caller, policy.requestableBy)) {
        throw new AppError(ErrorCodes.FORBIDDEN, "You are not eligible to request this access", 403);
      }
      if (input.durationMinutes > policy.maxDurationMinutes) {
        throw new AppError(
          ErrorCodes.VALIDATION,
          `Requested duration exceeds the maximum of ${policy.maxDurationMinutes} minutes`,
          400,
        );
      }
      if (grantRepo.countUndecided(caller.userId, policyId) > 0) {
        throw new AppError(
          ErrorCodes.CONFLICT,
          "You already have a request awaiting a decision for this policy",
          409,
        );
      }
      // An active grant means this is an extension/renewal: it supersedes that grant on approval.
      const active = grantRepo.getActiveFor(caller.userId, policyId);
      const grant = grantRepo.create({
        policyId,
        requesterUserId: caller.userId,
        requesterEmail: caller.email,
        requestedDurationMinutes: input.durationMinutes,
        justification: input.justification,
        pendingExpiresAt: minutesFrom(now(), policy.pendingTtlMinutes),
        supersedesGrantId: active?.id,
      });
      audit.append({
        action: "request.create",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId,
        grantId: grant.id,
        detail: { durationMinutes: input.durationMinutes, extension: Boolean(active) },
      });
      return grant;
    },

    listMine: (caller: Caller, status?: GrantStatus): JitGrant[] =>
      grantRepo.listByRequester(caller.userId, status).map(withPolicy),

    listAll: (status?: GrantStatus): JitGrant[] =>
      (status ? grantRepo.listByStatus(status) : grantRepo.listActive()).map(withPolicy),

    listActive: (): JitGrant[] => grantRepo.listActive().map(withPolicy),

    async approve(grantId: string, caller: Caller): Promise<JitGrant> {
      const grant = mustGrant(grantId);
      if (grant.status !== "pending") {
        throw new AppError(ErrorCodes.CONFLICT, `Request is ${grant.status}, not pending`, 409);
      }
      const policy = policyFor(grant);
      assertCanApprove(caller, policy.approverCriteria);
      if (!deps.allowSelfApproval && grant.requesterUserId === caller.userId) {
        throw new AppError(ErrorCodes.FORBIDDEN, "You cannot approve your own request", 403);
      }
      if (!(await deps.isPropagationEnabled())) {
        throw new AppError(
          ErrorCodes.PROPAGATION_DISABLED,
          "Account setting groups_propagation_enabled is off; grants would not reach peers",
          409,
        );
      }
      grantRepo.update(grantId, {
        status: "approved",
        approverUserId: caller.userId,
        approverEmail: caller.email,
        decidedAt: iso(),
      });
      audit.append({
        action: "grant.approve",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: policy.id,
        grantId,
      });
      return activate(grantId, policy, caller);
    },

    deny(grantId: string, caller: Caller, reason?: string): JitGrant {
      const grant = mustGrant(grantId);
      if (grant.status !== "pending") {
        throw new AppError(ErrorCodes.CONFLICT, `Request is ${grant.status}, not pending`, 409);
      }
      assertCanApprove(caller, policyFor(grant).approverCriteria);
      const updated = grantRepo.update(grantId, {
        status: "denied",
        approverUserId: caller.userId,
        approverEmail: caller.email,
        decidedAt: iso(),
        denialReason: reason,
      });
      audit.append({
        action: "grant.deny",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: grant.policyId,
        grantId,
        detail: { reason },
      });
      return updated;
    },

    cancel(grantId: string, caller: Caller): JitGrant {
      const grant = mustGrant(grantId);
      assertSelf(caller, grant.requesterUserId);
      if (grant.status !== "pending") {
        throw new AppError(ErrorCodes.CONFLICT, "Only pending requests can be cancelled", 409);
      }
      const updated = grantRepo.update(grantId, {
        status: "cancelled",
        decidedAt: iso(),
        denialReason: "cancelled_by_requester",
      });
      audit.append({
        action: "grant.cancel",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: grant.policyId,
        grantId,
      });
      return updated;
    },

    async endEarly(grantId: string, caller: Caller): Promise<JitGrant> {
      const grant = mustGrant(grantId);
      assertSelf(caller, grant.requesterUserId);
      if (grant.status !== "active") {
        throw new AppError(ErrorCodes.CONFLICT, "Only active grants can be ended", 409);
      }
      return deactivate(grant, "revoked", "ended_by_user", caller);
    },

    async revoke(grantId: string, caller: Caller, reason = "manual"): Promise<JitGrant> {
      const grant = mustGrant(grantId);
      if (!caller.isAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Administrator role required", 403);
      if (grant.status !== "active" && grant.status !== "failed") {
        throw new AppError(ErrorCodes.CONFLICT, `Cannot revoke a ${grant.status} grant`, 409);
      }
      return deactivate(grant, "revoked", reason, caller);
    },

    /**
     * Admin/approver renews an active grant directly (no pending step): create a
     * pre-approved superseding grant and activate it. Renews the clock to
     * now + duration; membership is unchanged (the target already holds the group).
     */
    async extendByAdmin(activeGrantId: string, caller: Caller, durationMinutes: number): Promise<JitGrant> {
      const target = mustGrant(activeGrantId);
      if (target.status !== "active") {
        throw new AppError(ErrorCodes.CONFLICT, "Only active grants can be extended", 409);
      }
      const policy = policyFor(target);
      assertCanApprove(caller, policy.approverCriteria);
      if (durationMinutes > policy.maxDurationMinutes) {
        throw new AppError(
          ErrorCodes.VALIDATION,
          `Requested duration exceeds the maximum of ${policy.maxDurationMinutes} minutes`,
          400,
        );
      }
      const renewal = grantRepo.create({
        policyId: target.policyId,
        requesterUserId: target.requesterUserId,
        requesterEmail: target.requesterEmail,
        requestedDurationMinutes: durationMinutes,
        supersedesGrantId: target.id,
      });
      grantRepo.update(renewal.id, {
        status: "approved",
        approverUserId: caller.userId,
        approverEmail: caller.email,
        decidedAt: iso(),
      });
      audit.append({
        action: "grant.approve",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: policy.id,
        grantId: renewal.id,
        detail: { adminExtend: true },
      });
      // activate() re-reads the renewal by id, so the discarded update return is fine.
      return activate(renewal.id, policy, caller);
    },

    /**
     * Cascade for JIT-policy deletion (system actor): void every non-terminal
     * grant so nothing dangles once the backing group/policy are torn down.
     * Active/failed grants are deactivated (membership removed); pending/approved
     * requests are cancelled (no membership to remove). Without this, pending
     * requests for a deleted policy become un-actionable zombies — approve then
     * 409s on the missing policy and they linger until the pending TTL.
     */
    async terminateAllForPolicy(policyId: string, reason: string): Promise<void> {
      for (const grant of grantRepo.listByPolicy(policyId)) {
        if (grant.status === "active" || grant.status === "failed") {
          await deactivate(grant, "revoked", reason);
        } else if (grant.status === "pending" || grant.status === "approved") {
          grantRepo.update(grant.id, {
            status: "cancelled",
            decidedAt: iso(),
            denialReason: reason,
          });
          audit.append({ action: "grant.cancel", policyId, grantId: grant.id, detail: { reason } });
        }
      }
    },

    // ---- scheduler hooks ----
    expire: (grant: JitGrant): Promise<JitGrant> => deactivate(grant, "expired", "expired"),

    autoDenyPending(grant: JitGrant): JitGrant {
      const updated = grantRepo.update(grant.id, {
        status: "denied",
        decidedAt: iso(),
        denialReason: "request_timed_out",
      });
      audit.append({ action: "grant.deny", policyId: grant.policyId, grantId: grant.id, detail: { reason: "timed_out" } });
      return updated;
    },

    async retryFailed(grant: JitGrant): Promise<void> {
      const policy = policyRepo.getById(grant.policyId);
      if (!policy?.backingGroupId) return;
      await activate(grant.id, policy);
    },
  };
}

export type GrantService = ReturnType<typeof createGrantService>;
