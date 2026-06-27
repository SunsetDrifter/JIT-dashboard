// Frontend mirror of the jit-service contract (jit-service/src/domain/types.ts).
export type GrantStatus =
  | "pending"
  | "approved"
  | "active"
  | "expired"
  | "denied"
  | "revoked"
  | "cancelled"
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
  backingGroupId: string | null;
  netbirdPolicyId: string | null;
  createdByUserId: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

/** Trimmed view returned by GET /policies/eligible. */
export interface EligiblePolicy {
  id: string;
  name: string;
  description?: string;
  targetResourceIds: string[];
  maxDurationMinutes: number;
}

export interface JitGrant {
  id: string;
  policyId: string;
  /** Resolved policy name, attached by the backend when grants are listed. */
  policyName?: string;
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

export interface JitMe {
  userId: string;
  email?: string;
  role: string;
  isAdmin: boolean;
  propagationEnabled: boolean;
}

export interface JitNetworkResource {
  id: string;
  name: string;
  description?: string;
  address?: string;
  type?: "domain" | "host" | "subnet";
}

export interface CreateJitPolicyBody {
  name: string;
  description?: string;
  targetResourceIds: string[];
  traffic?: Traffic;
  maxDurationMinutes: number;
  requestableBy: RequestableBy;
  approverCriteria: ApproverCriteria;
}
