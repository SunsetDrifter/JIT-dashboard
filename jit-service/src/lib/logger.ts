import pino from "pino";

// Standalone (no dependency on config) so it is safe to import anywhere,
// including during config parsing.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

export type Logger = typeof logger;
