import { z } from "zod";
import { ApproverCriteria, RequestableBy, Traffic } from "../domain/types.js";

const MAX_DURATION_MINUTES = 60 * 24 * 30; // 30 days

export const CreateJitPolicyRequest = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  targetResourceIds: z.array(z.string().min(1)).min(1),
  traffic: Traffic.optional(),
  maxDurationMinutes: z.number().int().positive().max(MAX_DURATION_MINUTES),
  requestableBy: RequestableBy,
  approverCriteria: ApproverCriteria,
  pendingTtlMinutes: z.number().int().positive().optional(),
});
export type CreateJitPolicyRequest = z.infer<typeof CreateJitPolicyRequest>;

export const UpdateJitPolicyRequest = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    targetResourceIds: z.array(z.string().min(1)).min(1),
    traffic: Traffic,
    maxDurationMinutes: z.number().int().positive().max(MAX_DURATION_MINUTES),
    requestableBy: RequestableBy,
    approverCriteria: ApproverCriteria,
    pendingTtlMinutes: z.number().int().positive(),
    enabled: z.boolean(),
  })
  .partial();
export type UpdateJitPolicyRequest = z.infer<typeof UpdateJitPolicyRequest>;
