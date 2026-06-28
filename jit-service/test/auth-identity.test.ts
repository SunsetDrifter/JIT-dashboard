import { describe, expect, it } from "vitest";
import { IdentityResolver } from "../src/auth/identity.js";
import type { NetbirdClient } from "../src/netbird/client.js";

const users = [
  { id: "u1", email: "alice@example.com", role: "owner", auto_groups: ["g1"] },
  { id: "u2", email: "bob@example.com", role: "user", auto_groups: ["g2"], idp_id: "sub-bob" },
];

function nbStub(counter: { n: number }): NetbirdClient {
  return {
    get: async () => {
      counter.n++;
      return users;
    },
  } as unknown as NetbirdClient;
}

describe("IdentityResolver", () => {
  it("resolves by email and detects admin/owner", async () => {
    const c = await new IdentityResolver(nbStub({ n: 0 })).resolve({
      sub: "x",
      email: "alice@example.com",
      raw: {},
    });
    expect(c.userId).toBe("u1");
    expect(c.isAdmin).toBe(true);
    expect(c.autoGroups).toEqual(["g1"]);
  });

  it("falls back to idp_id when email does not match", async () => {
    const c = await new IdentityResolver(nbStub({ n: 0 })).resolve({ sub: "sub-bob", raw: {} });
    expect(c.userId).toBe("u2");
    expect(c.isAdmin).toBe(false);
  });

  it("throws no_netbird_user when nothing matches", async () => {
    const r = new IdentityResolver(nbStub({ n: 0 }));
    await expect(r.resolve({ sub: "ghost", email: "ghost@x.com", raw: {} })).rejects.toMatchObject({
      code: "no_netbird_user",
    });
  });

  it("caches within the TTL and refreshes after it", async () => {
    const counter = { n: 0 };
    let now = 1000;
    const r = new IdentityResolver(nbStub(counter), 30_000, () => now);
    await r.resolve({ sub: "x", email: "alice@example.com", raw: {} });
    await r.resolve({ sub: "x", email: "alice@example.com", raw: {} });
    expect(counter.n).toBe(1);
    now += 31_000;
    await r.resolve({ sub: "x", email: "alice@example.com", raw: {} });
    expect(counter.n).toBe(2);
  });
});
