import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { isAppError } from "../src/lib/errors.js";

const base = () => ({
  NETBIRD_MGMT_API_ENDPOINT: "https://api.netbird.io",
  NETBIRD_SERVICE_TOKEN: "tok_123",
  AUTH_AUTHORITY: "https://idp.example.com/",
  AUTH_AUDIENCE: "netbird",
});

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) rmSync(f, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("parses a valid env and applies defaults", () => {
    const cfg = loadConfig(base() as NodeJS.ProcessEnv);
    expect(cfg.netbirdApiBase).toBe("https://api.netbird.io/api");
    expect(cfg.serviceToken).toBe("tok_123");
    expect(cfg.authAuthority).toBe("https://idp.example.com"); // trailing slash stripped
    expect(cfg.listenPort).toBe(8080);
    expect(cfg.sweepIntervalSec).toBe(30);
    expect(cfg.pendingTtlMinutes).toBe(1440);
    expect(cfg.groupMarker).toBe("jit:");
    expect(cfg.reconcileEnabled).toBe(true);
    expect(cfg.maxRemovalsPerPass).toBe(100);
    expect(cfg.allowedOrigins).toEqual([]);
  });

  it("does not double-append /api", () => {
    const cfg = loadConfig({ ...base(), NETBIRD_MGMT_API_ENDPOINT: "https://x.io/" } as NodeJS.ProcessEnv);
    expect(cfg.netbirdApiBase).toBe("https://x.io/api");
  });

  it("parses CSV allowed origins", () => {
    const cfg = loadConfig({
      ...base(),
      JIT_ALLOWED_ORIGINS: "https://a.io, https://b.io ,",
    } as NodeJS.ProcessEnv);
    expect(cfg.allowedOrigins).toEqual(["https://a.io", "https://b.io"]);
  });

  it("reads the service token from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "jit-cfg-"));
    tmpFiles.push(dir);
    const file = join(dir, "token");
    writeFileSync(file, "  file_token_xyz\n");
    const env = base() as Record<string, string>;
    delete env.NETBIRD_SERVICE_TOKEN;
    const cfg = loadConfig({ ...env, NETBIRD_SERVICE_TOKEN_FILE: file } as NodeJS.ProcessEnv);
    expect(cfg.serviceToken).toBe("file_token_xyz");
  });

  it("treats JIT_RECONCILE_ENABLED=false as false", () => {
    const cfg = loadConfig({ ...base(), JIT_RECONCILE_ENABLED: "false" } as NodeJS.ProcessEnv);
    expect(cfg.reconcileEnabled).toBe(false);
  });

  it("throws when a required value is missing", () => {
    const env = base() as Record<string, string>;
    delete env.AUTH_AUDIENCE;
    try {
      loadConfig(env as NodeJS.ProcessEnv);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as Error).message).toContain("AUTH_AUDIENCE");
    }
  });

  it("throws when no service token is provided", () => {
    const env = base() as Record<string, string>;
    delete env.NETBIRD_SERVICE_TOKEN;
    try {
      loadConfig(env as NodeJS.ProcessEnv);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as Error).message).toContain("service token");
    }
  });
});
