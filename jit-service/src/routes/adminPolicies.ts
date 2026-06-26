import type { FastifyInstance } from "fastify";
import { assertAdmin } from "../auth/guards.js";
import { ok } from "../lib/envelope.js";
import { AppError, ErrorCodes } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { listNetworkResources } from "../netbird/accounts.js";
import { CreateJitPolicyRequest, UpdateJitPolicyRequest } from "../schemas/policy.js";
import type { ServerDeps } from "../server.js";

export function registerAdminPolicyRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const svc = deps.policyService!;
  const auth = { preHandler: app.authenticate };

  app.post("/admin/policies", auth, async (req, reply) => {
    assertAdmin(req.caller!);
    const policy = await svc.create(parse(CreateJitPolicyRequest, req.body), req.caller!);
    reply.status(201);
    return ok(policy);
  });

  app.get("/admin/policies", auth, async (req) => {
    assertAdmin(req.caller!);
    return ok(svc.list());
  });

  app.get("/admin/policies/:id", auth, async (req) => {
    assertAdmin(req.caller!);
    const { id } = req.params as { id: string };
    const policy = svc.get(id);
    if (!policy) throw new AppError(ErrorCodes.NOT_FOUND, "JIT policy not found", 404);
    return ok(policy);
  });

  app.put("/admin/policies/:id", auth, async (req) => {
    assertAdmin(req.caller!);
    const { id } = req.params as { id: string };
    return ok(await svc.update(id, parse(UpdateJitPolicyRequest, req.body), req.caller!));
  });

  app.delete("/admin/policies/:id", auth, async (req) => {
    assertAdmin(req.caller!);
    const { id } = req.params as { id: string };
    await svc.remove(id, req.caller!);
    return ok({ deleted: true });
  });

  // Resource picker for the admin JIT-policy UI (sourced from the JIT backend).
  app.get("/admin/network-resources", auth, async (req) => {
    assertAdmin(req.caller!);
    return ok(await listNetworkResources(deps.nb));
  });
}
