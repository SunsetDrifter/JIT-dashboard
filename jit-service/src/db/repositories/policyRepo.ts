import { randomUUID } from "node:crypto";
import type { DB } from "../index.js";
import { AppError, ErrorCodes } from "../../lib/errors.js";
import type {
  ApproverCriteria,
  JitPolicy,
  RequestableBy,
  Traffic,
} from "../../domain/types.js";

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  target_resource_ids: string;
  traffic: string;
  max_duration_minutes: number;
  requestable_by: string;
  approver_criteria: string;
  pending_ttl_minutes: number;
  enabled: number;
  backing_group_id: string | null;
  netbird_policy_id: string | null;
  created_by_user_id: string;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

const rowToPolicy = (r: PolicyRow): JitPolicy => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  targetResourceIds: JSON.parse(r.target_resource_ids) as string[],
  traffic: JSON.parse(r.traffic) as Traffic,
  maxDurationMinutes: r.max_duration_minutes,
  requestableBy: JSON.parse(r.requestable_by) as RequestableBy,
  approverCriteria: JSON.parse(r.approver_criteria) as ApproverCriteria,
  pendingTtlMinutes: r.pending_ttl_minutes,
  enabled: r.enabled === 1,
  backingGroupId: r.backing_group_id,
  netbirdPolicyId: r.netbird_policy_id,
  createdByUserId: r.created_by_user_id,
  createdByEmail: r.created_by_email ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const policyToRow = (p: JitPolicy): PolicyRow => ({
  id: p.id,
  name: p.name,
  description: p.description ?? null,
  target_resource_ids: JSON.stringify(p.targetResourceIds),
  traffic: JSON.stringify(p.traffic),
  max_duration_minutes: p.maxDurationMinutes,
  requestable_by: JSON.stringify(p.requestableBy),
  approver_criteria: JSON.stringify(p.approverCriteria),
  pending_ttl_minutes: p.pendingTtlMinutes,
  enabled: p.enabled ? 1 : 0,
  backing_group_id: p.backingGroupId,
  netbird_policy_id: p.netbirdPolicyId,
  created_by_user_id: p.createdByUserId,
  created_by_email: p.createdByEmail ?? null,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

export type CreatePolicyInput = Omit<
  JitPolicy,
  "id" | "createdAt" | "updatedAt" | "enabled" | "backingGroupId" | "netbirdPolicyId"
> & {
  enabled?: boolean;
  backingGroupId?: string | null;
  netbirdPolicyId?: string | null;
};

export type UpdatePolicyInput = Partial<Omit<JitPolicy, "id" | "createdAt">>;

const COLS =
  "id, name, description, target_resource_ids, traffic, max_duration_minutes, requestable_by, approver_criteria, pending_ttl_minutes, enabled, backing_group_id, netbird_policy_id, created_by_user_id, created_by_email, created_at, updated_at";
const VALS =
  "@id, @name, @description, @target_resource_ids, @traffic, @max_duration_minutes, @requestable_by, @approver_criteria, @pending_ttl_minutes, @enabled, @backing_group_id, @netbird_policy_id, @created_by_user_id, @created_by_email, @created_at, @updated_at";
const SET =
  "name=@name, description=@description, target_resource_ids=@target_resource_ids, traffic=@traffic, max_duration_minutes=@max_duration_minutes, requestable_by=@requestable_by, approver_criteria=@approver_criteria, pending_ttl_minutes=@pending_ttl_minutes, enabled=@enabled, backing_group_id=@backing_group_id, netbird_policy_id=@netbird_policy_id, created_by_user_id=@created_by_user_id, created_by_email=@created_by_email, created_at=@created_at, updated_at=@updated_at";

export function createPolicyRepo(db: DB, now: () => string = () => new Date().toISOString()) {
  const insert = db.prepare(`INSERT INTO jit_policies (${COLS}) VALUES (${VALS})`);
  const updateStmt = db.prepare(`UPDATE jit_policies SET ${SET} WHERE id=@id`);
  const getStmt = db.prepare("SELECT * FROM jit_policies WHERE id = ?");
  const listStmt = db.prepare("SELECT * FROM jit_policies ORDER BY created_at ASC");
  const listEnabledStmt = db.prepare(
    "SELECT * FROM jit_policies WHERE enabled = 1 ORDER BY created_at ASC",
  );
  const delStmt = db.prepare("DELETE FROM jit_policies WHERE id = ?");

  const getById = (id: string): JitPolicy | null => {
    const row = getStmt.get(id) as PolicyRow | undefined;
    return row ? rowToPolicy(row) : null;
  };

  return {
    create(input: CreatePolicyInput): JitPolicy {
      const ts = now();
      const policy: JitPolicy = {
        ...input,
        id: randomUUID(),
        enabled: input.enabled ?? true,
        backingGroupId: input.backingGroupId ?? null,
        netbirdPolicyId: input.netbirdPolicyId ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      insert.run(policyToRow(policy) as unknown as Record<string, unknown>);
      return policy;
    },

    getById,

    list: (): JitPolicy[] => (listStmt.all() as PolicyRow[]).map(rowToPolicy),
    listEnabled: (): JitPolicy[] => (listEnabledStmt.all() as PolicyRow[]).map(rowToPolicy),

    update(id: string, patch: UpdatePolicyInput): JitPolicy {
      const existing = getById(id);
      if (!existing) {
        throw new AppError(ErrorCodes.NOT_FOUND, `JIT policy ${id} not found`, 404);
      }
      const merged: JitPolicy = { ...existing, ...patch, id, updatedAt: now() };
      updateStmt.run(policyToRow(merged) as unknown as Record<string, unknown>);
      return merged;
    },

    remove(id: string): void {
      delStmt.run(id);
    },
  };
}

export type PolicyRepo = ReturnType<typeof createPolicyRepo>;
