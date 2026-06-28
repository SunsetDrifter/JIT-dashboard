import { beforeEach, describe, expect, it } from "vitest";
import { buildApi, seedPolicy, auth } from "./helpers/apiHarness.js";

let h: ReturnType<typeof buildApi>;
beforeEach(() => {
  h = buildApi();
});

const requestAccess = (policyId: string, who: string) =>
  h.app.inject({ method: "POST", url: "/v1/requests", headers: auth(who), payload: { policyId, durationMinutes: 60 } });

describe("API authentication + authorization", () => {
  it("rejects unauthenticated requests with 401", async () => {
    for (const url of ["/v1/me", "/v1/requests/mine", "/v1/admin/requests", "/v1/admin/grants/active"]) {
      const res = await h.app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code, url).toBe("unauthenticated");
    }
  });

  it("forbids non-admins from admin-only routes with 403", async () => {
    const adminRoutes: Array<["GET" | "POST", string]> = [
      ["GET", "/v1/admin/requests"],
      ["GET", "/v1/admin/grants/active"],
      ["GET", "/v1/admin/audit"],
      ["GET", "/v1/admin/policies"],
      ["GET", "/v1/admin/network-resources"],
      ["POST", "/v1/admin/policies"],
    ];
    for (const [method, url] of adminRoutes) {
      const res = await h.app.inject({ method, url, headers: auth("user") });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code, `${method} ${url}`).toBe("forbidden");
    }
  });

  it("forbids a non-approver, non-admin from approving", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id, "user")).json().data.id;
    // user2 is neither admin nor in an approver group.
    const res = await h.app.inject({ method: "POST", url: `/v1/admin/requests/${id}/approve`, headers: auth("user2") });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  });

  it("forbids self-approval even for an admin", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id, "admin")).json().data.id;
    const res = await h.app.inject({ method: "POST", url: `/v1/admin/requests/${id}/approve`, headers: auth("admin") });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  });

  it("forbids ending someone else's grant", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id, "user")).json().data.id;
    await h.app.inject({ method: "POST", url: `/v1/admin/requests/${id}/approve`, headers: auth("admin") });
    const res = await h.app.inject({ method: "POST", url: `/v1/grants/${id}/end`, headers: auth("user2") });
    expect(res.statusCode).toBe(403);
  });
});
