import type { FastifyInstance } from "fastify";
import { isEligible } from "../auth/guards.js";
import { ok } from "../lib/envelope.js";
import { parse } from "../lib/validate.js";
import { CreateRequestRequest } from "../schemas/request.js";
import type { GrantStatus } from "../domain/types.js";
import type { ServerDeps } from "../server.js";

/** End-user (self-service) routes. Auth required; the backend authorizes per caller. */
export function registerUserRequestRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const grants = deps.grantService!;
  const policies = deps.policyService!;
  const auth = { preHandler: app.authenticate };

  app.get("/policies/eligible", auth, async (req) => {
    const caller = req.caller!;
    const eligible = policies
      .list()
      .filter((p) => p.enabled && isEligible(caller, p.requestableBy))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        targetResourceIds: p.targetResourceIds,
        maxDurationMinutes: p.maxDurationMinutes,
      }));
    return ok(eligible);
  });

  app.post("/requests", auth, async (req, reply) => {
    const body = parse(CreateRequestRequest, req.body);
    const grant = grants.requestAccess(body.policyId, req.caller!, {
      durationMinutes: body.durationMinutes,
      justification: body.justification,
    });
    reply.status(201);
    return ok(grant);
  });

  app.get("/requests/mine", auth, async (req) => {
    const status = (req.query as { status?: string }).status as GrantStatus | undefined;
    return ok(grants.listMine(req.caller!, status));
  });

  app.post("/requests/:id/cancel", auth, async (req) => {
    const { id } = req.params as { id: string };
    return ok(grants.cancel(id, req.caller!));
  });

  app.post("/grants/:id/end", auth, async (req) => {
    const { id } = req.params as { id: string };
    return ok(await grants.endEarly(id, req.caller!));
  });
}
