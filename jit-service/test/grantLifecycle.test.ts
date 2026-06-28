import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { createGrantRepo, type GrantRepo } from "../src/db/repositories/grantRepo.js";
import { createAuditRepo, type AuditRepo } from "../src/db/repositories/auditRepo.js";
import { auditActionFor, createGrantLifecycle } from "../src/domain/grantLifecycle.js";
import { GrantStatus, type JitGrant } from "../src/domain/types.js";
import { ErrorCodes, isAppError } from "../src/lib/errors.js";
import type { Caller } from "../src/auth/identity.js";

const ALL = GrantStatus.options;
const admin: Caller = { userId: "adm", email: "a@x.com", role: "admin", isAdmin: true, autoGroups: [] };

// The full set of legal edges and the audit action each emits, declared
// independently of the module so any change to LEGAL must be mirrored here on
// purpose. Anything not listed must be rejected.
const LEGAL_EDGES: Record<string, string> = {
  "pending→approved": "grant.approve",
  "pending→denied": "grant.deny",
  "pending→cancelled": "grant.cancel",
  "approved→active": "grant.activate",
  "approved→failed": "grant.fail",
  "approved→cancelled": "grant.cancel",
  "active→expired": "grant.expire",
  "active→revoked": "grant.revoke",
  "active→superseded": "grant.supersede",
  "failed→active": "grant.activate",
  "failed→revoked": "grant.revoke",
  "failed→failed": "grant.fail",
};

describe("grant lifecycle — legality matrix (pure, no IO)", () => {
  it("maps exactly the legal edges to their audit action; every other pair is illegal", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        // undefined for pairs absent from LEGAL_EDGES — i.e. illegal transitions.
        expect(auditActionFor(from, to)).toBe(LEGAL_EDGES[`${from}→${to}`]);
      }
    }
  });

  it("treats every terminal status as a dead end", () => {
    for (const terminal of ["expired", "denied", "revoked", "cancelled", "superseded"] as const) {
      for (const to of ALL) {
        expect(auditActionFor(terminal, to)).toBeUndefined();
      }
    }
  });
});

describe("grant lifecycle — transition()", () => {
  function fixture() {
    const db: DB = openDb(":memory:");
    const fixed = () => "2026-06-26T12:00:00.000Z";
    const grantRepo = createGrantRepo(db, fixed);
    const audit = createAuditRepo(db, fixed);
    const lifecycle = createGrantLifecycle({ grantRepo, audit });
    const grant = grantRepo.create({ policyId: "p1", requesterUserId: "u1", requestedDurationMinutes: 60 });
    return { grantRepo, audit, lifecycle, grant };
  }

  it("applies a legal transition, stamps fields, and audits the derived action", () => {
    const { lifecycle, audit, grant } = fixture();
    const out = lifecycle.transition(grant.id, "approved", {
      stamps: { decidedAt: "2026-06-26T12:00:00.000Z", approverUserId: "adm", approverEmail: "a@x.com" },
      actor: admin,
      detail: { note: "ok" },
    });
    expect(out?.status).toBe("approved");
    expect(out?.approverUserId).toBe("adm");

    const entries = audit.listForGrant(grant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "grant.approve", // derived from the pending→approved edge, not passed in
      actorUserId: "adm",
      actorEmail: "a@x.com",
      policyId: "p1",
      grantId: grant.id,
      detail: { note: "ok" },
    });
  });

  it("throws CONFLICT on an illegal edge and writes no audit or status change", () => {
    const { lifecycle, audit, grantRepo, grant } = fixture();
    try {
      lifecycle.transition(grant.id, "active", {}); // pending→active is illegal
      expect.unreachable();
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as { code: string }).code).toBe(ErrorCodes.CONFLICT);
    }
    expect(grantRepo.getById(grant.id)!.status).toBe("pending");
    expect(audit.listForGrant(grant.id)).toHaveLength(0);
  });

  it("throws NOT_FOUND for an unknown grant", () => {
    const { lifecycle } = fixture();
    try {
      lifecycle.transition("nope", "approved", {});
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it("returns null and writes no audit when it loses the compare-and-set race", () => {
    // The row is `pending` at read time (so the edge is legal) but the CAS finds
    // it already moved — modelled by a grantRepo whose transitionFrom returns null.
    const pending = { id: "g", policyId: "p1", status: "pending", requesterUserId: "u1", requestedDurationMinutes: 60, requestedAt: "t" } as JitGrant;
    const audited: unknown[] = [];
    const lifecycle = createGrantLifecycle({
      grantRepo: { getById: () => pending, transitionFrom: () => null } as unknown as GrantRepo,
      audit: { append: (e: unknown) => void audited.push(e) } as unknown as AuditRepo,
    });

    expect(lifecycle.transition("g", "approved", { actor: admin })).toBeNull();
    expect(audited).toHaveLength(0);
  });
});
