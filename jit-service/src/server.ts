import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fail } from "./lib/envelope.js";
import { AppError, ErrorCodes, isAppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import type { Config } from "./config.js";
import type { DB } from "./db/index.js";
import type { NetbirdClient } from "./netbird/client.js";
import type { JwtVerifier } from "./auth/jwt.js";
import type { Caller, IdentityResolver } from "./auth/identity.js";
import type { PolicyService } from "./domain/policyService.js";
import type { GrantService } from "./domain/grantService.js";
import type { AuditRepo } from "./db/repositories/auditRepo.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerAdminPolicyRoutes } from "./routes/adminPolicies.js";
import { registerUserRequestRoutes } from "./routes/userRequests.js";
import { registerAdminRequestRoutes } from "./routes/adminRequests.js";

declare module "fastify" {
  interface FastifyRequest {
    caller?: Caller;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface ServerDeps {
  config: Config;
  db: DB;
  nb: NetbirdClient;
  jwt: JwtVerifier;
  identity: IdentityResolver;
  /** Optional services; their routes register only when provided (added per phase). */
  policyService?: PolicyService;
  grantService?: GrantService;
  auditRepo?: AuditRepo;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Tolerate empty JSON bodies (approve/deny/cancel/end/revoke are bodyless POSTs).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = (body as string).trim();
      if (text === "") return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  // Security middleware (registrations are queued and applied on ready()).
  void app.register(helmet, { contentSecurityPolicy: false }); // JSON API; no document CSP
  if (deps.config.allowedOrigins?.length) {
    void app.register(cors, { origin: deps.config.allowedOrigins, credentials: true });
  }
  void app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  app.decorate(
    "authenticate",
    async (req: FastifyRequest): Promise<void> => {
      const header = req.headers.authorization;
      if (!header || !header.startsWith("Bearer ")) {
        throw new AppError(ErrorCodes.UNAUTHENTICATED, "Missing bearer token", 401);
      }
      const claims = await deps.jwt.verify(header.slice("Bearer ".length));
      req.caller = await deps.identity.resolve(claims);
    },
  );

  app.setErrorHandler((err: Error, req, reply) => {
    if (isAppError(err)) {
      if (err.httpStatus >= 500) {
        logger.error({ err: err.message, code: err.code, path: req.url }, "request failed");
      }
      reply.status(err.httpStatus).send(fail(err.code, err.message));
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      reply.status(400).send(fail(ErrorCodes.VALIDATION, err.message));
      return;
    }
    logger.error({ err: err.message, path: req.url }, "unhandled error");
    reply.status(500).send(fail(ErrorCodes.INTERNAL, "Internal error"));
  });

  registerHealthRoutes(app, deps);
  app.register(
    async (v1) => {
      registerMeRoutes(v1, deps);
      if (deps.policyService) registerAdminPolicyRoutes(v1, deps);
      if (deps.grantService) {
        registerUserRequestRoutes(v1, deps);
        registerAdminRequestRoutes(v1, deps);
      }
    },
    { prefix: "/v1" },
  );

  return app;
}
