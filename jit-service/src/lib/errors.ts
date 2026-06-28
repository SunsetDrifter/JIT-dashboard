/**
 * Domain error carrying a stable machine code and an HTTP status.
 * Route handlers translate these into the response envelope; internal
 * details never leak past the message.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

// Common, reused error codes.
export const ErrorCodes = {
  CONFIG_INVALID: "config_invalid",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  VALIDATION: "validation_error",
  CONFLICT: "conflict",
  NO_NETBIRD_USER: "no_netbird_user",
  PROPAGATION_DISABLED: "propagation_disabled",
  NETBIRD_UNAVAILABLE: "netbird_unavailable",
  INTERNAL: "internal_error",
} as const;
