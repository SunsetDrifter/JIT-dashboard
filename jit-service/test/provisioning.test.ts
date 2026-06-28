import { describe, expect, it } from "vitest";
import {
  assertApiGroup,
  buildNbPolicy,
  deprovisionBacking,
  provisionBacking,
} from "../src/domain/provisioning.js";
import { AppError, ErrorCodes } from "../src/lib/errors.js";
import type { NetbirdClient } from "../src/netbird/client.js";
import type { Traffic } from "../src/domain/types.js";

type Call = { method: string; path: string; body?: unknown };

function fakeNb(opts: { failPolicyCreate?: boolean; groupIssued?: string } = {}) {
  const calls: Call[] = [];
  const nb = {
    get: async (path: string) => {
      calls.push({ method: "GET", path });
      if (path.startsWith("/groups/")) {
        return { id: path.split("/")[2], name: "x", issued: opts.groupIssued ?? "api" };
      }
      return [];
    },
    post: async (path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      if (path === "/groups") return { id: "g1", name: (body as { name: string }).name, issued: "api" };
      if (path === "/policies") {
        if (opts.failPolicyCreate) throw new AppError(ErrorCodes.NETBIRD_UNAVAILABLE, "boom", 502);
        return { id: "p1", ...(body as object) };
      }
      return {};
    },
    put: async (path: string, body: unknown) => {
      calls.push({ method: "PUT", path, body });
      return { id: path.split("/")[2], ...(body as object) };
    },
    del: async (path: string) => {
      calls.push({ method: "DELETE", path });
      return undefined;
    },
  } as unknown as NetbirdClient;
  return { nb, calls };
}

const traffic: Traffic = { protocol: "all" };

describe("provisioning", () => {
  it("buildNbPolicy makes one rule per resource, source = backing group", () => {
    const p = buildNbPolicy("jit:", {
      name: "Prod",
      backingGroupId: "g1",
      targetResourceIds: ["r1", "r2"],
      traffic,
    });
    expect(p.name).toBe("jit:Prod");
    expect(p.rules).toHaveLength(2);
    expect(p.rules[0]!.sources).toEqual(["g1"]);
    expect(p.rules[0]!.destinationResource).toEqual({ id: "r1" });
    expect(p.rules[1]!.destinationResource).toEqual({ id: "r2" });
  });

  it("provisions a marker-named group + policy", async () => {
    const { nb, calls } = fakeNb();
    const res = await provisionBacking(nb, "jit:", {
      name: "Prod",
      targetResourceIds: ["r1"],
      traffic,
    });
    expect(res).toEqual({ backingGroupId: "g1", netbirdPolicyId: "p1" });
    expect(calls.find((c) => c.path === "/groups")?.body).toMatchObject({ name: "jit:Prod" });
    expect(calls.some((c) => c.path === "/policies")).toBe(true);
  });

  it("rolls back the group if policy creation fails", async () => {
    const { nb, calls } = fakeNb({ failPolicyCreate: true });
    await expect(
      provisionBacking(nb, "jit:", { name: "Prod", targetResourceIds: ["r1"], traffic }),
    ).rejects.toMatchObject({ code: "netbird_unavailable" });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/groups/g1")).toBe(true);
  });

  it("assertApiGroup rejects non-API groups", async () => {
    await expect(assertApiGroup(fakeNb({ groupIssued: "jwt" }).nb, "g1")).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
    });
    await expect(assertApiGroup(fakeNb({ groupIssued: "api" }).nb, "g1")).resolves.toBeUndefined();
  });

  it("deprovisions policy then group", async () => {
    const { nb, calls } = fakeNb();
    await deprovisionBacking(nb, {
      id: "x",
      name: "Prod",
      targetResourceIds: ["r1"],
      traffic,
      maxDurationMinutes: 60,
      requestableBy: { mode: "all" },
      approverCriteria: { mode: "any_admin" },
      pendingTtlMinutes: 1440,
      enabled: true,
      backingGroupId: "g1",
      netbirdPolicyId: "p1",
      createdByUserId: "a",
      createdAt: "t",
      updatedAt: "t",
    });
    const dels = calls.filter((c) => c.method === "DELETE").map((c) => c.path);
    expect(dels).toEqual(["/policies/p1", "/groups/g1"]);
  });
});
