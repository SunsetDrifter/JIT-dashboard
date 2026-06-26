import { describe, expect, it } from "vitest";
import { assertAdmin, assertSelf, canApprove, isEligible } from "../src/auth/guards.js";
import type { Caller } from "../src/auth/identity.js";

const caller = (over: Partial<Caller> = {}): Caller => ({
  userId: "u1",
  role: "user",
  isAdmin: false,
  autoGroups: ["g1"],
  ...over,
});

describe("guards", () => {
  it("eligibility: all vs specific groups", () => {
    expect(isEligible(caller(), { mode: "all" })).toBe(true);
    expect(isEligible(caller({ autoGroups: ["g1"] }), { mode: "groups", groupIds: ["g1"] })).toBe(true);
    expect(isEligible(caller({ autoGroups: ["gx"] }), { mode: "groups", groupIds: ["g1"] })).toBe(false);
  });

  it("approval: admins always; group members in groups mode", () => {
    expect(canApprove(caller({ isAdmin: true }), { mode: "any_admin" })).toBe(true);
    expect(canApprove(caller(), { mode: "any_admin" })).toBe(false);
    expect(canApprove(caller({ autoGroups: ["appr"] }), { mode: "groups", groupIds: ["appr"] })).toBe(true);
    expect(canApprove(caller({ autoGroups: ["x"] }), { mode: "groups", groupIds: ["appr"] })).toBe(false);
  });

  it("assertAdmin / assertSelf throw appropriately", () => {
    expect(() => assertAdmin(caller({ isAdmin: true }))).not.toThrow();
    expect(() => assertAdmin(caller())).toThrow();
    expect(() => assertSelf(caller({ userId: "u1" }), "u1")).not.toThrow();
    expect(() => assertSelf(caller({ userId: "u1" }), "u2")).toThrow();
  });
});
