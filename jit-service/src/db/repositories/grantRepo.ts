import { randomUUID } from "node:crypto";
import type { DB } from "../index.js";
import { AppError, ErrorCodes } from "../../lib/errors.js";
import type { GrantStatus, JitGrant } from "../../domain/types.js";

interface GrantRow {
  id: string;
  policy_id: string;
  requester_user_id: string;
  requester_email: string | null;
  requested_duration_minutes: number;
  justification: string | null;
  status: string;
  approver_user_id: string | null;
  approver_email: string | null;
  denial_reason: string | null;
  revoke_reason: string | null;
  requested_at: string;
  pending_expires_at: string | null;
  decided_at: string | null;
  activated_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_error: string | null;
  supersedes_grant_id: string | null;
}

const rowToGrant = (r: GrantRow): JitGrant => ({
  id: r.id,
  policyId: r.policy_id,
  requesterUserId: r.requester_user_id,
  requesterEmail: r.requester_email ?? undefined,
  requestedDurationMinutes: r.requested_duration_minutes,
  justification: r.justification ?? undefined,
  status: r.status as GrantStatus,
  approverUserId: r.approver_user_id ?? undefined,
  approverEmail: r.approver_email ?? undefined,
  denialReason: r.denial_reason ?? undefined,
  revokeReason: r.revoke_reason ?? undefined,
  requestedAt: r.requested_at,
  pendingExpiresAt: r.pending_expires_at ?? undefined,
  decidedAt: r.decided_at ?? undefined,
  activatedAt: r.activated_at ?? undefined,
  expiresAt: r.expires_at ?? undefined,
  revokedAt: r.revoked_at ?? undefined,
  lastError: r.last_error ?? undefined,
  supersedesGrantId: r.supersedes_grant_id ?? undefined,
});

const grantToRow = (g: JitGrant): GrantRow => ({
  id: g.id,
  policy_id: g.policyId,
  requester_user_id: g.requesterUserId,
  requester_email: g.requesterEmail ?? null,
  requested_duration_minutes: g.requestedDurationMinutes,
  justification: g.justification ?? null,
  status: g.status,
  approver_user_id: g.approverUserId ?? null,
  approver_email: g.approverEmail ?? null,
  denial_reason: g.denialReason ?? null,
  revoke_reason: g.revokeReason ?? null,
  requested_at: g.requestedAt,
  pending_expires_at: g.pendingExpiresAt ?? null,
  decided_at: g.decidedAt ?? null,
  activated_at: g.activatedAt ?? null,
  expires_at: g.expiresAt ?? null,
  revoked_at: g.revokedAt ?? null,
  last_error: g.lastError ?? null,
  supersedes_grant_id: g.supersedesGrantId ?? null,
});

export type CreateGrantInput = {
  policyId: string;
  requesterUserId: string;
  requesterEmail?: string;
  requestedDurationMinutes: number;
  justification?: string;
  pendingExpiresAt?: string;
  supersedesGrantId?: string;
};

export type UpdateGrantInput = Partial<Omit<JitGrant, "id" | "policyId" | "requestedAt">>;

const COLS =
  "id, policy_id, requester_user_id, requester_email, requested_duration_minutes, justification, status, approver_user_id, approver_email, denial_reason, revoke_reason, requested_at, pending_expires_at, decided_at, activated_at, expires_at, revoked_at, last_error, supersedes_grant_id";
const VALS =
  "@id, @policy_id, @requester_user_id, @requester_email, @requested_duration_minutes, @justification, @status, @approver_user_id, @approver_email, @denial_reason, @revoke_reason, @requested_at, @pending_expires_at, @decided_at, @activated_at, @expires_at, @revoked_at, @last_error, @supersedes_grant_id";
const SET =
  "policy_id=@policy_id, requester_user_id=@requester_user_id, requester_email=@requester_email, requested_duration_minutes=@requested_duration_minutes, justification=@justification, status=@status, approver_user_id=@approver_user_id, approver_email=@approver_email, denial_reason=@denial_reason, revoke_reason=@revoke_reason, requested_at=@requested_at, pending_expires_at=@pending_expires_at, decided_at=@decided_at, activated_at=@activated_at, expires_at=@expires_at, revoked_at=@revoked_at, last_error=@last_error, supersedes_grant_id=@supersedes_grant_id";

export function createGrantRepo(db: DB, now: () => string = () => new Date().toISOString()) {
  const insert = db.prepare(`INSERT INTO jit_grants (${COLS}) VALUES (${VALS})`);
  const updateStmt = db.prepare(`UPDATE jit_grants SET ${SET} WHERE id=@id`);
  const getStmt = db.prepare("SELECT * FROM jit_grants WHERE id = ?");
  const byRequesterStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE requester_user_id = ? ORDER BY requested_at DESC",
  );
  const byRequesterStatusStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE requester_user_id = ? AND status = ? ORDER BY requested_at DESC",
  );
  const byPolicyStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE policy_id = ? ORDER BY requested_at DESC",
  );
  const byStatusStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE status = ? ORDER BY requested_at DESC",
  );
  const activeStmt = db.prepare("SELECT * FROM jit_grants WHERE status = 'active'");
  const activeExpiredStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?",
  );
  const pendingExpiredStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE status = 'pending' AND pending_expires_at IS NOT NULL AND pending_expires_at <= ?",
  );
  const undecidedStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM jit_grants WHERE requester_user_id = ? AND policy_id = ? AND status IN ('pending','approved')",
  );
  const activeForStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE requester_user_id = ? AND policy_id = ? AND status = 'active' LIMIT 1",
  );
  const activeUserIdsStmt = db.prepare(
    "SELECT DISTINCT requester_user_id AS uid FROM jit_grants WHERE policy_id = ? AND status = 'active'",
  );
  const cleanupStmt = db.prepare(
    "DELETE FROM jit_grants WHERE status IN ('expired','denied','revoked','cancelled') AND COALESCE(revoked_at, decided_at, requested_at) <= ?",
  );
  const countAllStmt = db.prepare("SELECT COUNT(*) AS n FROM jit_grants");

  const getById = (id: string): JitGrant | null => {
    const row = getStmt.get(id) as GrantRow | undefined;
    return row ? rowToGrant(row) : null;
  };

  return {
    create(input: CreateGrantInput): JitGrant {
      const grant: JitGrant = {
        id: randomUUID(),
        policyId: input.policyId,
        requesterUserId: input.requesterUserId,
        requesterEmail: input.requesterEmail,
        requestedDurationMinutes: input.requestedDurationMinutes,
        justification: input.justification,
        status: "pending",
        requestedAt: now(),
        pendingExpiresAt: input.pendingExpiresAt,
        supersedesGrantId: input.supersedesGrantId,
      };
      insert.run(grantToRow(grant) as unknown as Record<string, unknown>);
      return grant;
    },

    getById,

    update(id: string, patch: UpdateGrantInput): JitGrant {
      const existing = getById(id);
      if (!existing) {
        throw new AppError(ErrorCodes.NOT_FOUND, `Grant ${id} not found`, 404);
      }
      const merged: JitGrant = { ...existing, ...patch, id };
      updateStmt.run(grantToRow(merged) as unknown as Record<string, unknown>);
      return merged;
    },

    listByRequester: (userId: string, status?: GrantStatus): JitGrant[] =>
      (status
        ? (byRequesterStatusStmt.all(userId, status) as GrantRow[])
        : (byRequesterStmt.all(userId) as GrantRow[])
      ).map(rowToGrant),

    listByPolicy: (policyId: string): JitGrant[] =>
      (byPolicyStmt.all(policyId) as GrantRow[]).map(rowToGrant),

    listByStatus: (status: GrantStatus): JitGrant[] =>
      (byStatusStmt.all(status) as GrantRow[]).map(rowToGrant),

    listActive: (): JitGrant[] => (activeStmt.all() as GrantRow[]).map(rowToGrant),

    listActiveExpiredBefore: (iso: string): JitGrant[] =>
      (activeExpiredStmt.all(iso) as GrantRow[]).map(rowToGrant),

    listPendingExpiredBefore: (iso: string): JitGrant[] =>
      (pendingExpiredStmt.all(iso) as GrantRow[]).map(rowToGrant),

    countUndecided: (userId: string, policyId: string): number =>
      (undecidedStmt.get(userId, policyId) as { n: number }).n,

    getActiveFor: (userId: string, policyId: string): JitGrant | null => {
      const row = activeForStmt.get(userId, policyId) as GrantRow | undefined;
      return row ? rowToGrant(row) : null;
    },

    activeUserIdsForPolicy: (policyId: string): string[] =>
      (activeUserIdsStmt.all(policyId) as { uid: string }[]).map((r) => r.uid),

    deleteTerminalOlderThan: (iso: string): number => cleanupStmt.run(iso).changes,

    countAll: (): number => (countAllStmt.get() as { n: number }).n,
  };
}

export type GrantRepo = ReturnType<typeof createGrantRepo>;
