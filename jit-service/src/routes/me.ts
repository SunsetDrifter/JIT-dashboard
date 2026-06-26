import type { FastifyInstance } from "fastify";
import { ok } from "../lib/envelope.js";
import { isGroupsPropagationEnabled } from "../netbird/accounts.js";
import type { ServerDeps } from "../server.js";

export function registerMeRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get("/me", { preHandler: app.authenticate }, async (req) => {
    const caller = req.caller!;
    let propagationEnabled = false;
    try {
      propagationEnabled = await isGroupsPropagationEnabled(deps.nb);
    } catch {
      propagationEnabled = false; // surfaced as a warning elsewhere; never block /me
    }
    return ok({
      userId: caller.userId,
      email: caller.email,
      role: caller.role,
      isAdmin: caller.isAdmin,
      propagationEnabled,
    });
  });
}
