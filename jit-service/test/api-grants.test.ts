import { beforeEach, describe, expect, it } from "vitest";
import { buildApi, seedPolicy, auth } from "./helpers/apiHarness.js";

let h: ReturnType<typeof buildApi>;
beforeEach(() => {
  h = buildApi();
});

const requestAccess = (policyId: string, durationMinutes = 60, who = "user") =>
  h.app.inject({
    method: "POST",
    url: "/v1/requests",
    headers: auth(who),
    payload: { policyId, durationMinutes },
  });

const approve = (id: string) =>
  h.app.inject({ method: "POST", url: `/v1/admin/requests/${id}/approve`, headers: auth("admin") });

describe("grant lifecycle over HTTP", () => {
  it("admin denies a pending request", async () => {
    const policy = await seedPolicy(h);
    const created = await requestAccess(policy.id);
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    const res = await h.app.inject({
      method: "POST",
      url: `/v1/admin/requests/${id}/deny`,
      headers: auth("admin"),
      payload: { reason: "not now" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("denied");
    expect(h.grantRepo.getById(id)!.status).toBe("denied");
  });

  it("requester cancels their own pending request", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id)).json().data.id;

    const res = await h.app.inject({ method: "POST", url: `/v1/requests/${id}/cancel`, headers: auth("user") });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("cancelled");
  });

  it("admin approves then revokes an active grant", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id)).json().data.id;

    const appr = await approve(id);
    expect(appr.statusCode).toBe(200);
    expect(appr.json().data.status).toBe("active");

    const rev = await h.app.inject({
      method: "POST",
      url: `/v1/admin/grants/${id}/revoke`,
      headers: auth("admin"),
      payload: { reason: "cleanup" },
    });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().data.status).toBe("revoked");
  });

  it("requester ends their active grant early", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id)).json().data.id;
    await approve(id);

    const end = await h.app.inject({ method: "POST", url: `/v1/grants/${id}/end`, headers: auth("user") });
    expect(end.statusCode).toBe(200);
    expect(end.json().data.status).toBe("revoked");
  });

  it("admin extends an active grant into a superseding grant", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id)).json().data.id;
    await approve(id);

    const ext = await h.app.inject({
      method: "POST",
      url: `/v1/admin/grants/${id}/extend`,
      headers: auth("admin"),
      payload: { durationMinutes: 30 },
    });
    expect(ext.statusCode).toBe(200);
    const renewal = ext.json().data;
    expect(renewal.status).toBe("active");
    expect(renewal.supersedesGrantId).toBe(id);
    expect(h.grantRepo.getById(id)!.status).toBe("superseded");
  });

  it("exposes mine / pending / active / audit lists", async () => {
    const policy = await seedPolicy(h);
    const id = (await requestAccess(policy.id)).json().data.id;

    const mine = await h.app.inject({ method: "GET", url: "/v1/requests/mine", headers: auth("user") });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.some((g: { id: string }) => g.id === id)).toBe(true);

    const pending = await h.app.inject({ method: "GET", url: "/v1/admin/requests?status=pending", headers: auth("admin") });
    expect(pending.json().data.some((g: { id: string }) => g.id === id)).toBe(true);

    await approve(id);
    const active = await h.app.inject({ method: "GET", url: "/v1/admin/grants/active", headers: auth("admin") });
    expect(active.json().data.some((g: { id: string }) => g.id === id)).toBe(true);

    const audit = await h.app.inject({ method: "GET", url: "/v1/admin/audit", headers: auth("admin") });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.length).toBeGreaterThan(0);
  });

  describe("validation + not-found envelopes", () => {
    it("rejects a malformed request body with 400 validation_error", async () => {
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/requests",
        headers: auth("user"),
        payload: { durationMinutes: -5 }, // missing policyId, non-positive duration
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ success: false, error: { code: "validation_error" } });
    });

    it("returns 404 for an action on a missing grant", async () => {
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/admin/requests/does-not-exist/deny",
        headers: auth("admin"),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ success: false, error: { code: "not_found" } });
    });
  });
});
