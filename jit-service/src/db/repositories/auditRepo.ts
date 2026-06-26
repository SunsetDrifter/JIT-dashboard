import type { DB } from "../index.js";
import type { AuditEntry } from "../../domain/types.js";

interface AuditRow {
  id: number;
  at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  policy_id: string | null;
  grant_id: string | null;
  detail: string | null;
}

const rowToEntry = (r: AuditRow): AuditEntry => ({
  id: r.id,
  at: r.at,
  actorUserId: r.actor_user_id ?? undefined,
  actorEmail: r.actor_email ?? undefined,
  action: r.action,
  policyId: r.policy_id ?? undefined,
  grantId: r.grant_id ?? undefined,
  detail: r.detail == null ? undefined : (JSON.parse(r.detail) as unknown),
});

export type AppendAuditInput = {
  action: string;
  actorUserId?: string;
  actorEmail?: string;
  policyId?: string;
  grantId?: string;
  detail?: unknown;
  at?: string;
};

export function createAuditRepo(db: DB, now: () => string = () => new Date().toISOString()) {
  const insert = db.prepare(
    "INSERT INTO jit_audit_log (at, actor_user_id, actor_email, action, policy_id, grant_id, detail) VALUES (@at, @actor_user_id, @actor_email, @action, @policy_id, @grant_id, @detail)",
  );
  const listStmt = db.prepare("SELECT * FROM jit_audit_log ORDER BY id DESC LIMIT ? OFFSET ?");
  const byGrantStmt = db.prepare(
    "SELECT * FROM jit_audit_log WHERE grant_id = ? ORDER BY id DESC",
  );

  return {
    append(input: AppendAuditInput): AuditEntry {
      const at = input.at ?? now();
      const info = insert.run({
        at,
        actor_user_id: input.actorUserId ?? null,
        actor_email: input.actorEmail ?? null,
        action: input.action,
        policy_id: input.policyId ?? null,
        grant_id: input.grantId ?? null,
        detail: input.detail === undefined ? null : JSON.stringify(input.detail),
      });
      return {
        id: Number(info.lastInsertRowid),
        at,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        action: input.action,
        policyId: input.policyId,
        grantId: input.grantId,
        detail: input.detail,
      };
    },

    list: (limit = 100, offset = 0): AuditEntry[] =>
      (listStmt.all(limit, offset) as AuditRow[]).map(rowToEntry),

    listForGrant: (grantId: string): AuditEntry[] =>
      (byGrantStmt.all(grantId) as AuditRow[]).map(rowToEntry),
  };
}

export type AuditRepo = ReturnType<typeof createAuditRepo>;
