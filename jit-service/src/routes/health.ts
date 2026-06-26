import type { FastifyInstance } from "fastify";
import { ok } from "../lib/envelope.js";
import type { ServerDeps } from "../server.js";

export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get("/healthz", async () => {
    deps.db.prepare("SELECT 1").get(); // throws if the DB is unusable
    return ok({ status: "ok" });
  });
}
