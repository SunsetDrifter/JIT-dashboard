import { readFileSync } from "node:fs";
import { z } from "zod";
import { AppError, ErrorCodes } from "./lib/errors.js";

const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v !== "false" && v !== "0"));

const EnvSchema = z.object({
  NETBIRD_MGMT_API_ENDPOINT: z.string().url(),
  NETBIRD_SERVICE_TOKEN: z.string().min(1).optional(),
  NETBIRD_SERVICE_TOKEN_FILE: z.string().min(1).optional(),
  AUTH_AUTHORITY: z.string().url(),
  AUTH_AUDIENCE: z.string().min(1),
  JIT_DB_PATH: z.string().min(1).default("/data/jit.db"),
  JIT_LISTEN_PORT: z.coerce.number().int().positive().default(8080),
  JIT_LISTEN_HOST: z.string().min(1).default("0.0.0.0"),
  JIT_ALLOWED_ORIGINS: z.string().default(""),
  JIT_SWEEP_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  JIT_PENDING_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  JIT_GROUP_MARKER: z.string().min(1).default("jit:"),
  JIT_GRANT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  JIT_RECONCILE_ENABLED: boolish(true),
  JIT_ALLOW_SELF_APPROVAL: boolish(false),
  LOG_LEVEL: z.string().min(1).default("info"),
});

export interface Config {
  netbirdApiBase: string; // already suffixed with /api
  serviceToken: string;
  authAuthority: string;
  authAudience: string;
  dbPath: string;
  listenPort: number;
  listenHost: string;
  allowedOrigins: string[];
  sweepIntervalSec: number;
  pendingTtlMinutes: number;
  groupMarker: string;
  grantRetentionDays: number;
  reconcileEnabled: boolean;
  allowSelfApproval: boolean;
  logLevel: string;
}

function resolveServiceToken(env: {
  NETBIRD_SERVICE_TOKEN?: string;
  NETBIRD_SERVICE_TOKEN_FILE?: string;
}): string {
  if (env.NETBIRD_SERVICE_TOKEN_FILE) {
    try {
      const token = readFileSync(env.NETBIRD_SERVICE_TOKEN_FILE, "utf8").trim();
      if (!token) {
        throw new AppError(
          ErrorCodes.CONFIG_INVALID,
          `NETBIRD_SERVICE_TOKEN_FILE (${env.NETBIRD_SERVICE_TOKEN_FILE}) is empty`,
        );
      }
      return token;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        ErrorCodes.CONFIG_INVALID,
        `Cannot read NETBIRD_SERVICE_TOKEN_FILE (${env.NETBIRD_SERVICE_TOKEN_FILE}): ${(e as Error).message}`,
      );
    }
  }
  if (env.NETBIRD_SERVICE_TOKEN) return env.NETBIRD_SERVICE_TOKEN;
  throw new AppError(
    ErrorCodes.CONFIG_INVALID,
    "Missing NetBird service token: set NETBIRD_SERVICE_TOKEN or NETBIRD_SERVICE_TOKEN_FILE",
  );
}

/**
 * Parse + validate configuration from an env-like object. Pure and
 * injectable (defaults to process.env) so it can be unit-tested.
 * Throws AppError(CONFIG_INVALID) with a readable message on any problem.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AppError(ErrorCodes.CONFIG_INVALID, `Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const serviceToken = resolveServiceToken(e);

  const allowedOrigins = e.JIT_ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return Object.freeze({
    netbirdApiBase: e.NETBIRD_MGMT_API_ENDPOINT.replace(/\/+$/, "") + "/api",
    serviceToken,
    authAuthority: e.AUTH_AUTHORITY.replace(/\/+$/, ""),
    authAudience: e.AUTH_AUDIENCE,
    dbPath: e.JIT_DB_PATH,
    listenPort: e.JIT_LISTEN_PORT,
    listenHost: e.JIT_LISTEN_HOST,
    allowedOrigins,
    sweepIntervalSec: e.JIT_SWEEP_INTERVAL_SEC,
    pendingTtlMinutes: e.JIT_PENDING_TTL_MINUTES,
    groupMarker: e.JIT_GROUP_MARKER,
    grantRetentionDays: e.JIT_GRANT_RETENTION_DAYS,
    reconcileEnabled: e.JIT_RECONCILE_ENABLED,
    allowSelfApproval: e.JIT_ALLOW_SELF_APPROVAL,
    logLevel: e.LOG_LEVEL,
  });
}
