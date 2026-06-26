import { describe, expect, it } from "vitest";
import { NetbirdClient } from "../src/netbird/client.js";

function scripted(thunks: Array<() => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const t = thunks[Math.min(i, thunks.length - 1)]!;
    i++;
    return t();
  };
  return { fn, calls };
}

const client = (fn: (u: string, i?: RequestInit) => Promise<Response>) =>
  new NetbirdClient({
    apiBase: "https://nb/api",
    serviceToken: "tok",
    fetchImpl: fn,
    baseDelayMs: 1,
    maxRetries: 2,
  });

describe("NetbirdClient", () => {
  it("sends the bearer header and parses JSON", async () => {
    const s = scripted([() => new Response(JSON.stringify([{ id: "u1" }]), { status: 200 })]);
    const data = await client(s.fn).get<{ id: string }[]>("/users");
    expect(data).toEqual([{ id: "u1" }]);
    expect((s.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(s.calls[0]!.url).toBe("https://nb/api/users");
  });

  it("does not retry 4xx", async () => {
    const s = scripted([() => new Response(JSON.stringify({ message: "bad" }), { status: 400 })]);
    await expect(client(s.fn).get("/x")).rejects.toMatchObject({ code: "netbird_unavailable" });
    expect(s.calls).toHaveLength(1);
  });

  it("retries 5xx then succeeds", async () => {
    const s = scripted([
      () => new Response("", { status: 500 }),
      () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    ]);
    expect(await client(s.fn).get("/x")).toEqual({ ok: 1 });
    expect(s.calls).toHaveLength(2);
  });

  it("retries network errors", async () => {
    const s = scripted([
      () => {
        throw new Error("ECONNRESET");
      },
      () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    ]);
    expect(await client(s.fn).get("/x")).toEqual({ ok: 1 });
    expect(s.calls).toHaveLength(2);
  });

  it("throws after exhausting retries", async () => {
    const s = scripted([() => new Response("", { status: 503 })]);
    await expect(client(s.fn).get("/x")).rejects.toMatchObject({ code: "netbird_unavailable" });
    expect(s.calls).toHaveLength(3); // 1 attempt + 2 retries
  });

  it("maps 404 to not_found", async () => {
    const s = scripted([() => new Response(JSON.stringify({ message: "nope" }), { status: 404 })]);
    await expect(client(s.fn).get("/x")).rejects.toMatchObject({ code: "not_found" });
    expect(s.calls).toHaveLength(1);
  });
});
