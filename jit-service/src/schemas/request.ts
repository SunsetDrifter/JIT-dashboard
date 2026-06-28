import { z } from "zod";

export const CreateRequestRequest = z.object({
  policyId: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  justification: z.string().max(1000).optional(),
});
export type CreateRequestRequest = z.infer<typeof CreateRequestRequest>;

export const DecisionReason = z.object({
  reason: z.string().max(500).optional(),
});
export type DecisionReason = z.infer<typeof DecisionReason>;

export const ExtendRequest = z.object({
  durationMinutes: z.number().int().positive(),
});
export type ExtendRequest = z.infer<typeof ExtendRequest>;
