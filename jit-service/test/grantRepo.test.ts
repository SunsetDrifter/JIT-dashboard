import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { createGrantRepo } from "../src/db/repositories/grantRepo.js";

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("grantRepo extension support", () => {
  it("persists supersedesGrantId and finds the active grant for a user+policy", () => {
    const repo = createGrantRepo(db, () => "2026-06-26T12:00:00.000Z");
    const g1 = repo.create({ policyId: "p", requesterUserId: "u", requestedDurationMinutes: 60 });
    expect(repo.getActiveFor("u", "p")).toBeNull();

    repo.update(g1.id, { status: "active", activatedAt: "2026-06-26T12:00:00.000Z" });
    expect(repo.getActiveFor("u", "p")!.id).toBe(g1.id);

    const g2 = repo.create({
      policyId: "p",
      requesterUserId: "u",
      requestedDurationMinutes: 30,
      supersedesGrantId: g1.id,
    });
    expect(repo.getById(g2.id)!.supersedesGrantId).toBe(g1.id);
  });

  it("countUndecided counts only pending and approved (not active)", () => {
    const repo = createGrantRepo(db, () => "2026-06-26T12:00:00.000Z");
    const g = repo.create({ policyId: "p", requesterUserId: "u", requestedDurationMinutes: 60 });
    expect(repo.countUndecided("u", "p")).toBe(1); // pending
    repo.update(g.id, { status: "approved" });
    expect(repo.countUndecided("u", "p")).toBe(1); // approved still counts
    repo.update(g.id, { status: "active" });
    expect(repo.countUndecided("u", "p")).toBe(0); // active is decided
  });

  it("deleteTerminalOlderThan removes superseded grants past the cutoff but keeps active ones", () => {
    const repo = createGrantRepo(db, () => "2026-06-26T12:00:00.000Z");
    const old = repo.create({ policyId: "p", requesterUserId: "u", requestedDurationMinutes: 60 });
    repo.update(old.id, { status: "superseded", revokedAt: "2020-01-01T00:00:00.000Z" });
    const live = repo.create({ policyId: "p", requesterUserId: "u2", requestedDurationMinutes: 60 });
    repo.update(live.id, { status: "active" });
    const removed = repo.deleteTerminalOlderThan("2021-01-01T00:00:00.000Z");
    expect(removed).toBe(1);
    expect(repo.getById(old.id)).toBeNull();
    expect(repo.getById(live.id)!.status).toBe("active");
  });
});
