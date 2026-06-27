import type { FastifyInstance } from "fastify";
import { assertAdmin } from "../auth/guards.js";
import { ok } from "../lib/envelope.js";
import { parse } from "../lib/validate.js";
import { DecisionReason, ExtendRequest } from "../schemas/request.js";
import type { GrantStatus } from "../domain/types.js";
import type { ServerDeps } from "../server.js";

/** Admin / approver routes. approve+deny authorize via the service (approver groups allowed). */
export function registerAdminRequestRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const grants = deps.grantService!;
  const audit = deps.auditRepo!;
  const auth = { preHandler: app.authenticate };

  app.get("/admin/requests", auth, async (req) => {
    assertAdmin(req.caller!);
    const status = ((req.query as { status?: string }).status ?? "pending") as GrantStatus;
    return ok(grants.listAll(status));
  });

  // approve/deny are NOT admin-gated: the service permits approver-group members too.
  app.post("/admin/requests/:id/approve", auth, async (req) => {
    const { id } = req.params as { id: string };
    return ok(await grants.approve(id, req.caller!));
  });

  app.post("/admin/requests/:id/deny", auth, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(DecisionReason, req.body ?? {});
    return ok(grants.deny(id, req.caller!, body.reason));
  });

  app.get("/admin/grants/active", auth, async (req) => {
    assertAdmin(req.caller!);
    return ok(grants.listActive());
  });

  app.post("/admin/grants/:id/revoke", auth, async (req) => {
    assertAdmin(req.caller!);
    const { id } = req.params as { id: string };
    const body = parse(DecisionReason, req.body ?? {});
    return ok(await grants.revoke(id, req.caller!, body.reason ?? "manual"));
  });

  app.post("/admin/grants/:id/extend", auth, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(ExtendRequest, req.body);
    return ok(await grants.extendByAdmin(id, req.caller!, body.durationMinutes));
  });

  app.get("/admin/audit", auth, async (req) => {
    assertAdmin(req.caller!);
    const q = req.query as { limit?: string; offset?: string };
    return ok(audit.list(q.limit ? Number(q.limit) : 100, q.offset ? Number(q.offset) : 0));
  });
}
