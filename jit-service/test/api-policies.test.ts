import { beforeEach, describe, expect, it } from "vitest";
import { buildApi, auth } from "./helpers/apiHarness.js";

let h: ReturnType<typeof buildApi>;
beforeEach(() => {
  h = buildApi();
});

const validPolicy = () => ({
  name: "Prod DB",
  targetResourceIds: ["r1"],
  maxDurationMinutes: 120,
  requestableBy: { mode: "all" },
  approverCriteria: { mode: "any_admin" },
});

const createPolicy = (body: Record<string, unknown> = validPolicy()) =>
  h.app.inject({ method: "POST", url: "/v1/admin/policies", headers: auth("admin"), payload: body });

describe("policy CRUD over HTTP", () => {
  it("creates a policy (201) and provisions backing objects", async () => {
    const res = await createPolicy();
    expect(res.statusCode).toBe(201);
    const p = res.json().data;
    expect(p.id).toBeTruthy();
    expect(p.backingGroupId).toBe("g1");
    expect(p.netbirdPolicyId).toBe("p1");
  });

  it("lists, gets, updates, and deletes a policy", async () => {
    const id = (await createPolicy()).json().data.id;

    const list = await h.app.inject({ method: "GET", url: "/v1/admin/policies", headers: auth("admin") });
    expect(list.json().data.some((p: { id: string }) => p.id === id)).toBe(true);

    const got = await h.app.inject({ method: "GET", url: `/v1/admin/policies/${id}`, headers: auth("admin") });
    expect(got.statusCode).toBe(200);
    expect(got.json().data.id).toBe(id);

    const upd = await h.app.inject({
      method: "PUT",
      url: `/v1/admin/policies/${id}`,
      headers: auth("admin"),
      payload: { maxDurationMinutes: 30 },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.maxDurationMinutes).toBe(30);

    const del = await h.app.inject({ method: "DELETE", url: `/v1/admin/policies/${id}`, headers: auth("admin") });
    expect(del.statusCode).toBe(200);
    expect(del.json().data).toMatchObject({ deleted: true });
    // backing NetBird policy + group are torn down.
    const deletes = h.calls.filter((c) => c.method === "DELETE").map((c) => c.path);
    expect(deletes).toContain("/policies/p1");
    expect(deletes).toContain("/groups/g1");
  });

  it("returns 404 for a missing policy", async () => {
    const res = await h.app.inject({ method: "GET", url: "/v1/admin/policies/nope", headers: auth("admin") });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("rejects an invalid policy body with 400 validation_error", async () => {
    const bad: Array<Record<string, unknown>> = [
      { ...validPolicy(), name: "" }, // empty name
      { ...validPolicy(), targetResourceIds: [] }, // no resources
      { ...validPolicy(), maxDurationMinutes: 0 }, // non-positive
    ];
    for (const body of bad) {
      const res = await createPolicy(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error.code).toBe("validation_error");
    }
  });
});
