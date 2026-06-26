import type { DB } from "./index.js";

/**
 * Ordered, append-only migrations. Index i applies when user_version === i,
 * then bumps user_version to i+1. Never edit a shipped migration — add a new one.
 */
const MIGRATIONS: Array<(db: DB) => void> = [
  // v1 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE jit_policies (
        id                     TEXT PRIMARY KEY,
        name                   TEXT NOT NULL,
        description            TEXT,
        target_resource_ids    TEXT NOT NULL,
        traffic                TEXT NOT NULL,
        max_duration_minutes   INTEGER NOT NULL,
        requestable_by         TEXT NOT NULL,
        approver_criteria      TEXT NOT NULL,
        pending_ttl_minutes    INTEGER NOT NULL,
        enabled                INTEGER NOT NULL DEFAULT 1,
        backing_group_id       TEXT,
        netbird_policy_id      TEXT,
        created_by_user_id     TEXT NOT NULL,
        created_by_email       TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );

      CREATE TABLE jit_grants (
        id                          TEXT PRIMARY KEY,
        policy_id                   TEXT NOT NULL,
        requester_user_id           TEXT NOT NULL,
        requester_email             TEXT,
        requested_duration_minutes  INTEGER NOT NULL,
        justification               TEXT,
        status                      TEXT NOT NULL,
        approver_user_id            TEXT,
        approver_email              TEXT,
        denial_reason               TEXT,
        revoke_reason               TEXT,
        requested_at                TEXT NOT NULL,
        pending_expires_at          TEXT,
        decided_at                  TEXT,
        activated_at                TEXT,
        expires_at                  TEXT,
        revoked_at                  TEXT,
        last_error                  TEXT
      );

      CREATE INDEX idx_grants_status_expires   ON jit_grants(status, expires_at);
      CREATE INDEX idx_grants_status_pending   ON jit_grants(status, pending_expires_at);
      CREATE INDEX idx_grants_requester_status ON jit_grants(requester_user_id, status);
      CREATE INDEX idx_grants_policy           ON jit_grants(policy_id);

      CREATE TABLE jit_audit_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        at             TEXT NOT NULL,
        actor_user_id  TEXT,
        actor_email    TEXT,
        action         TEXT NOT NULL,
        policy_id      TEXT,
        grant_id       TEXT,
        detail         TEXT
      );

      CREATE INDEX idx_audit_grant ON jit_audit_log(grant_id);
    `);
  },
];

export function runMigrations(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const migrate = MIGRATIONS[v]!;
    const tx = db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${v + 1}`);
    });
    tx();
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
