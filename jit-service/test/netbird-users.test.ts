import { describe, expect, it } from "vitest";
import { findUserByEmail, findUserById, putUserAutoGroups } from "../src/netbird/users.js";
import type { NetbirdClient } from "../src/netbird/client.js";
import type { NbUser } from "../src/netbird/types.js";

const users: NbUser[] = [
  { id: "u1", email: "Alice@Example.com", role: "admin", auto_groups: ["g1"], is_blocked: false },
  { id: "u2", email: "bob@example.com", role: "user", auto_groups: [] },
];

function stub(captured: { path?: string; body?: unknown } = {}): NetbirdClient {
  return {
    get: async () => users,
    put: async (path: string, body: unknown) => {
      captured.path = path;
      captured.body = body;
      return users[0];
    },
  } as unknown as NetbirdClient;
}

describe("netbird users", () => {
  it("finds by email case-insensitively", async () => {
    const c = stub();
    expect((await findUserByEmail(c, "alice@example.com"))?.id).toBe("u1");
    expect(await findUserByEmail(c, "nobody@x.com")).toBeNull();
  });

  it("finds by id", async () => {
    expect((await findUserById(stub(), "u2"))?.email).toBe("bob@example.com");
  });

  it("puts auto_groups preserving role + is_blocked", async () => {
    const captured: { path?: string; body?: unknown } = {};
    await putUserAutoGroups(stub(captured), users[0]!, ["g1", "g2"]);
    expect(captured.path).toBe("/users/u1");
    expect(captured.body).toEqual({ role: "admin", auto_groups: ["g1", "g2"], is_blocked: false });
  });
});
