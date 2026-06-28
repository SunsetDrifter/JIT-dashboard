import { AppError, ErrorCodes } from "../lib/errors.js";
import type { ApproverCriteria, RequestableBy } from "../domain/types.js";
import type { Caller } from "./identity.js";

export const hasGroupIntersection = (a: string[], b: string[]): boolean => {
  const set = new Set(a);
  return b.some((g) => set.has(g));
};

/** May this caller request the given JIT policy? */
export const isEligible = (caller: Caller, rb: RequestableBy): boolean =>
  rb.mode === "all" ? true : hasGroupIntersection(caller.autoGroups, rb.groupIds);

/** May this caller approve/deny Requests for the given JIT policy? */
export const canApprove = (caller: Caller, ac: ApproverCriteria): boolean =>
  caller.isAdmin || (ac.mode === "groups" && hasGroupIntersection(caller.autoGroups, ac.groupIds));

export function assertAdmin(caller: Caller): void {
  if (!caller.isAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Administrator role required", 403);
  }
}

export function assertSelf(caller: Caller, targetUserId: string): void {
  if (caller.userId !== targetUserId) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Action not permitted for this user", 403);
  }
}

export function assertCanApprove(caller: Caller, ac: ApproverCriteria): void {
  if (!canApprove(caller, ac)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Not permitted to approve this request", 403);
  }
}
