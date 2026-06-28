import type { Caller } from "../auth/identity.js";
import type { AuditRepo } from "../db/repositories/auditRepo.js";
import type { GrantRepo } from "../db/repositories/grantRepo.js";
import { AppError, ErrorCodes } from "../lib/errors.js";
import type { GrantStatus, JitGrant } from "./types.js";

/**
 * The single authority for a Grant's status. Every status change is one
 * `transition(id, to, …)` call, which is:
 *   - legal only if the `from → to` edge exists in LEGAL,
 *   - atomic (compare-and-set, so two concurrent callers can't both win),
 *   - audited with an action derived from the edge — no hand-threaded actor/policy fields.
 *
 * Membership side-effects (adding/removing the backing group) live in
 * grantService; this module never touches NetBird. grantService.create() still
 * owns the birth of a Grant (status `pending`) and its `request.create` audit —
 * creation is not a transition.
 */

/**
 * Legal status edges; the value is the audit action the edge emits. Terminal
 * statuses have no outgoing edges. `failed → failed` is a deliberate self-edge:
 * a retry that fails again re-stamps `lastError` and re-audits `grant.fail`,
 * matching the pre-existing retry behaviour.
 */
const LEGAL: Record<GrantStatus, Partial<Record<GrantStatus, string>>> = {
  pending: { approved: "grant.approve", denied: "grant.deny", cancelled: "grant.cancel" },
  approved: { active: "grant.activate", failed: "grant.fail", cancelled: "grant.cancel" },
  active: { expired: "grant.expire", revoked: "grant.revoke", superseded: "grant.supersede" },
  failed: { active: "grant.activate", revoked: "grant.revoke", failed: "grant.fail" },
  expired: {},
  denied: {},
  revoked: {},
  cancelled: {},
  superseded: {},
};

/**
 * Pure: the audit action for a `from → to` edge, or `undefined` if illegal.
 * Exported so the legality matrix can be tested exhaustively without a DB.
 */
export const auditActionFor = (from: GrantStatus, to: GrantStatus): string | undefined =>
  LEGAL[from]?.[to];

/** The non-status fields a transition may stamp onto the grant. */
export type TransitionStamps = Partial<
  Pick<
    JitGrant,
    | "decidedAt"
    | "activatedAt"
    | "expiresAt"
    | "revokedAt"
    | "revokeReason"
    | "denialReason"
    | "approverUserId"
    | "approverEmail"
    | "lastError"
  >
>;

export interface TransitionContext {
  stamps?: TransitionStamps;
  /** Whoever caused the transition; omit for system/scheduler actions. */
  actor?: Caller;
  detail?: unknown;
}

export interface GrantLifecycleDeps {
  grantRepo: GrantRepo;
  audit: AuditRepo;
}

export function createGrantLifecycle(deps: GrantLifecycleDeps) {
  const { grantRepo, audit } = deps;

  return {
    /**
     * Move grant `id` to status `to`. Throws CONFLICT if the `from → to` edge is
     * illegal (a programming/precondition error). Returns the updated grant, or
     * `null` if it lost the compare-and-set race — i.e. the row was no longer in
     * its prior status. Callers decide whether that `null` is a 409 (mandatory
     * transition) or a benign skip (opportunistic transition).
     */
    transition(id: string, to: GrantStatus, ctx: TransitionContext = {}): JitGrant | null {
      const grant = grantRepo.getById(id);
      if (!grant) throw new AppError(ErrorCodes.NOT_FOUND, `Grant ${id} not found`, 404);

      const from = grant.status;
      const action = auditActionFor(from, to);
      if (!action) {
        throw new AppError(ErrorCodes.CONFLICT, `Illegal grant transition ${from} → ${to}`, 409);
      }

      // The WHERE status=@expected clause is the guard: if the row moved between
      // the read above and this write, `transitionFrom` returns null and we
      // neither stamp nor audit.
      const updated = grantRepo.transitionFrom(id, from, { status: to, ...ctx.stamps });
      if (!updated) return null;

      audit.append({
        action,
        actorUserId: ctx.actor?.userId,
        actorEmail: ctx.actor?.email,
        policyId: grant.policyId,
        grantId: id,
        detail: ctx.detail,
      });
      return updated;
    },
  };
}

export type GrantLifecycle = ReturnType<typeof createGrantLifecycle>;
