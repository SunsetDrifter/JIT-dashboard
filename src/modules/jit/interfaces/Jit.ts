// Frontend mirror of the native /api/jit contract.
// Field names match the backend's JSON tags (camelCase).
export type { NetworkResource as JitNetworkResource } from "@/interfaces/Network";

export type GrantStatus =
  | "pending"
  | "approved"
  | "active"
  | "expired"
  | "denied"
  | "revoked"
  | "cancelled"
  | "superseded"
  | "failed";

export type Protocol = "all" | "tcp" | "udp" | "icmp";
export interface Traffic {
  protocol: Protocol;
  ports?: string[];
}

export type RequestableBy = { mode: "all" } | { mode: "groups"; groupIds: string[] };
export type ApproverCriteria = { mode: "any_admin" } | { mode: "groups"; groupIds: string[] };

export interface JitPolicy {
  id: string;
  name: string;
  description?: string;
  targetResourceIds: string[];
  traffic: Traffic;
  maxDurationMinutes: number;
  requestableBy: RequestableBy;
  approverCriteria: ApproverCriteria;
  pendingTtlMinutes: number;
  enabled: boolean;
  // Backing group / access-policy IDs. The backend omits these when unset
  // (absent, not null), so they're optional.
  backingGroupId?: string;
  netbirdPolicyId?: string;
  // Mirror-type policy: set when this policy copies an existing Access Control
  // policy instead of a resource list. sourcePolicyName is the source's name
  // captured at the last sync; sourceDrifted/sourceDeleted are computed
  // server-side for admin reads (the source changed / no longer exists).
  sourcePolicyId?: string;
  sourcePolicyName?: string;
  sourceDrifted?: boolean;
  sourceDeleted?: boolean;
  createdByUserId: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

/** Trimmed view returned by GET /jit/policies/eligible. */
export interface EligiblePolicy {
  id: string;
  name: string;
  description?: string;
  targetResourceIds: string[];
  /** Set when the policy mirrors an Access Control policy; name is for display. */
  sourcePolicyId?: string;
  sourcePolicyName?: string;
  maxDurationMinutes: number;
}

export interface JitGrant {
  id: string;
  policyId: string;
  /** Policy name — not sent by the native backend; resolved client-side from the policies list. */
  policyName?: string;
  /** When set, this grant renews/replaces the referenced grant on activation. */
  supersedesGrantId?: string;
  requesterUserId: string;
  requesterEmail?: string;
  requestedDurationMinutes: number;
  justification?: string;
  status: GrantStatus;
  approverUserId?: string;
  approverEmail?: string;
  denialReason?: string;
  revokeReason?: string;
  requestedAt: string;
  pendingExpiresAt?: string;
  decidedAt?: string;
  activatedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  lastError?: string;
}

export interface CreateJitPolicyBody {
  name: string;
  description?: string;
  // Provide exactly one of targetResourceIds (resource-based) or sourcePolicyId
  // (mirror an existing Access Control policy). The backend enforces this.
  targetResourceIds?: string[];
  sourcePolicyId?: string;
  traffic?: Traffic;
  maxDurationMinutes: number;
  requestableBy: RequestableBy;
  approverCriteria: ApproverCriteria;
}
