import { z } from "zod";

/** Lifecycle of a Request → Grant (one row in jit_grants). */
export const GrantStatus = z.enum([
  "pending",
  "approved",
  "active",
  "expired",
  "denied",
  "revoked",
  "cancelled",
  "superseded",
  "failed",
]);
export type GrantStatus = z.infer<typeof GrantStatus>;

export const Protocol = z.enum(["all", "tcp", "udp", "icmp"]);
export type Protocol = z.infer<typeof Protocol>;

export const Traffic = z.object({
  protocol: Protocol.default("all"),
  ports: z.array(z.string().min(1)).optional(),
});
export type Traffic = z.infer<typeof Traffic>;

/** Who may request a JIT policy (read-only group membership check). */
export const RequestableBy = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("groups"), groupIds: z.array(z.string().min(1)).min(1) }),
]);
export type RequestableBy = z.infer<typeof RequestableBy>;

/** Who may approve/deny Requests for a JIT policy. */
export const ApproverCriteria = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("any_admin") }),
  z.object({ mode: z.literal("groups"), groupIds: z.array(z.string().min(1)).min(1) }),
]);
export type ApproverCriteria = z.infer<typeof ApproverCriteria>;

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
  /** NetBird group id JIT provisions for this policy (null until provisioned). */
  backingGroupId: string | null;
  /** NetBird access-policy id JIT provisions for this policy (null until provisioned). */
  netbirdPolicyId: string | null;
  createdByUserId: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JitGrant {
  id: string;
  policyId: string;
  /** Resolved policy name, attached when grants are listed for the UI. */
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
  /** Pending Requests auto-deny once now > pendingExpiresAt. */
  pendingExpiresAt?: string;
  decidedAt?: string;
  activatedAt?: string;
  /** Active Grants expire (revoke) once now > expiresAt. */
  expiresAt?: string;
  revokedAt?: string;
  lastError?: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorUserId?: string;
  actorEmail?: string;
  action: string;
  policyId?: string;
  grantId?: string;
  detail?: unknown;
}
