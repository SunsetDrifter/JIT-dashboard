# JIT Grant Extensions (Renewals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users request extensions to an active JIT grant (approved like any request) and let admins extend an active grant directly — both renewing the access window with no interruption.

**Architecture:** An extension is a **new grant row** that *supersedes* the requester's current active grant for the same policy. Because backing-group membership is binary and idempotent, renewing never touches NetBird — it only moves `expiresAt` forward. On activation the superseding grant retires the prior one (`status = superseded`, **no** membership removal), so there is always exactly one `active` grant per (user, policy) and the scheduler/expiry/reconcile/revoke paths are unchanged.

**Tech Stack:** Backend `jit-service` (Node 20, TypeScript, Fastify, better-sqlite3, zod, vitest). Frontend JIT module (Next.js App Router, React, SWR, TanStack Table).

## Global Constraints

- **Fork isolation:** ALL changes live under `jit-service/**` and `src/modules/jit/**` + the two JIT page dirs `src/app/(dashboard)/jit/**`. **Zero upstream-file edits** (do NOT touch `src/layouts/*`, `src/utils/api.tsx`, etc.).
- **Renew semantics:** approved extension sets `expiresAt = approvalTime + requestedDurationMinutes`, capped per-request at the policy's `maxDurationMinutes`. Renewable repeatedly; each renewal is independently approved. No cumulative ceiling.
- **Hard invariant:** never call `membership.remove` when superseding; never mutate IdP/JWT groups; exactly one `active` grant per (user, policy).
- **Immutability:** never mutate objects in place — spread into new ones (the repo `update` already does `{...existing, ...patch}`).
- **Backend tests:** run from `jit-service/` with `npm test` (`vitest run`); typecheck `npm run typecheck`.
- **Frontend typecheck:** `npx tsc --noEmit` from repo root; full build `npm run build` (run under Node 20 to match CI).
- **Commits:** conventional-commit format; attribution is disabled globally — do not add Co-Authored-By/footers.

---

### Task 1: Persist `supersedesGrantId` + extension-aware grant queries

**Files:**
- Modify: `jit-service/src/db/migrations.ts` (append migration v2)
- Modify: `jit-service/src/domain/types.ts` (add `superseded` status + `supersedesGrantId`)
- Modify: `jit-service/src/db/repositories/grantRepo.ts` (column mapping, `countUndecided`, `getActiveFor`)
- Test: `jit-service/test/grantRepo.test.ts` (new)

**Interfaces:**
- Produces: `GrantStatus` includes `"superseded"`; `JitGrant.supersedesGrantId?: string`; `CreateGrantInput.supersedesGrantId?: string`; `grantRepo.countUndecided(userId, policyId): number`; `grantRepo.getActiveFor(userId, policyId): JitGrant | null`.

- [ ] **Step 1: Write the failing test**

Create `jit-service/test/grantRepo.test.ts`:

```ts
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
    repo.update(g.id, { status: "active" });
    expect(repo.countUndecided("u", "p")).toBe(0); // active is decided
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jit-service && npm test -- grantRepo`
Expected: FAIL — `countUndecided`/`getActiveFor` are not functions (and/or `supersedesGrantId` undefined).

- [ ] **Step 3: Add migration v2**

In `jit-service/src/db/migrations.ts`, append a new element to the `MIGRATIONS` array (after the v1 function, before the closing `]`):

```ts
  // v2 — grant renewals: link a renewal to the grant it supersedes
  (db) => {
    db.exec(`ALTER TABLE jit_grants ADD COLUMN supersedes_grant_id TEXT;`);
  },
```

- [ ] **Step 4: Extend the domain types**

In `jit-service/src/domain/types.ts`, add `"superseded"` to the `GrantStatus` enum:

```ts
export const GrantStatus = z.enum([
  "pending",
  "approved",
  "active",
  "expired",
  "denied",
  "revoked",
  "cancelled",
  "superseded",
  "failed",
]);
```

And add the field to the `JitGrant` interface, immediately after `policyName?: string;`:

```ts
  /** When set, this grant renews/replaces the referenced grant on activation. */
  supersedesGrantId?: string;
```

- [ ] **Step 5: Map the column + add queries in the repo**

In `jit-service/src/db/repositories/grantRepo.ts`:

Add to the `GrantRow` interface (after `last_error`):
```ts
  supersedes_grant_id: string | null;
```
Add to `rowToGrant` (after `lastError`):
```ts
  supersedesGrantId: r.supersedes_grant_id ?? undefined,
```
Add to `grantToRow` (after `last_error`):
```ts
  supersedes_grant_id: g.supersedesGrantId ?? null,
```
Add to `CreateGrantInput` (after `pendingExpiresAt?`):
```ts
  supersedesGrantId?: string;
```
Append `supersedes_grant_id` to the three SQL fragments:
```ts
const COLS =
  "id, policy_id, requester_user_id, requester_email, requested_duration_minutes, justification, status, approver_user_id, approver_email, denial_reason, revoke_reason, requested_at, pending_expires_at, decided_at, activated_at, expires_at, revoked_at, last_error, supersedes_grant_id";
const VALS =
  "@id, @policy_id, @requester_user_id, @requester_email, @requested_duration_minutes, @justification, @status, @approver_user_id, @approver_email, @denial_reason, @revoke_reason, @requested_at, @pending_expires_at, @decided_at, @activated_at, @expires_at, @revoked_at, @last_error, @supersedes_grant_id";
const SET =
  "policy_id=@policy_id, requester_user_id=@requester_user_id, requester_email=@requester_email, requested_duration_minutes=@requested_duration_minutes, justification=@justification, status=@status, approver_user_id=@approver_user_id, approver_email=@approver_email, denial_reason=@denial_reason, revoke_reason=@revoke_reason, requested_at=@requested_at, pending_expires_at=@pending_expires_at, decided_at=@decided_at, activated_at=@activated_at, expires_at=@expires_at, revoked_at=@revoked_at, last_error=@last_error, supersedes_grant_id=@supersedes_grant_id";
```
Set the field in `create()` (add to the `grant` object literal, after `pendingExpiresAt`):
```ts
        supersedesGrantId: input.supersedesGrantId,
```
Add two prepared statements **alongside** the existing `inFlightStmt` (leave `inFlightStmt` in place — Task 2 removes it once `requestAccess` stops using it, keeping the tree green after each task). After the `inFlightStmt` declaration, add:
```ts
  const undecidedStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM jit_grants WHERE requester_user_id = ? AND policy_id = ? AND status IN ('pending','approved')",
  );
  const activeForStmt = db.prepare(
    "SELECT * FROM jit_grants WHERE requester_user_id = ? AND policy_id = ? AND status = 'active' LIMIT 1",
  );
```
Add two methods to the returned object, right after the existing `countInFlight` method (keep `countInFlight`):
```ts
    countUndecided: (userId: string, policyId: string): number =>
      (undecidedStmt.get(userId, policyId) as { n: number }).n,

    getActiveFor: (userId: string, policyId: string): JitGrant | null => {
      const row = activeForStmt.get(userId, policyId) as GrantRow | undefined;
      return row ? rowToGrant(row) : null;
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd jit-service && npm test && npm run typecheck`
Expected: all backend tests PASS (existing suite + new `grantRepo.test.ts`); typecheck clean. The tree stays green — `countInFlight` remains in place until Task 2 removes it.

- [ ] **Step 7: Commit**

```bash
git add jit-service/src/db/migrations.ts jit-service/src/domain/types.ts jit-service/src/db/repositories/grantRepo.ts jit-service/test/grantRepo.test.ts
git commit -m "feat(jit): persist supersedesGrantId and add extension-aware grant queries"
```

---

### Task 2: Relax the in-flight rule — allow an extension request while active

**Files:**
- Modify: `jit-service/src/domain/grantService.ts` (`requestAccess`)
- Test: `jit-service/test/grantService.test.ts` (add a case)

**Interfaces:**
- Consumes: `grantRepo.countUndecided`, `grantRepo.getActiveFor` (Task 1).
- Produces: `requestAccess` returns a pending grant whose `supersedesGrantId` is set to the caller's active grant id when one exists.

- [ ] **Step 1: Write the failing test**

In `jit-service/test/grantService.test.ts`, add inside the `describe("grantService", ...)` block:

```ts
  it("blocks a second undecided request but allows an extension request while active", async () => {
    const { svc, policy } = setup();
    const g1 = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    // second request while g1 is still pending → blocked
    expect(() => svc.requestAccess(policy.id, requester, { durationMinutes: 60 })).toThrow();

    await svc.approve(g1.id, admin); // g1 now active
    const ext = svc.requestAccess(policy.id, requester, { durationMinutes: 90 });
    expect(ext.status).toBe("pending");
    expect(ext.supersedesGrantId).toBe(g1.id);

    // a third (double extension) is blocked again — ext is undecided
    expect(() => svc.requestAccess(policy.id, requester, { durationMinutes: 30 })).toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jit-service && npm test -- grantService`
Expected: FAIL — the second request still throws on the active in-flight grant (and `supersedesGrantId` is undefined).

- [ ] **Step 3: Update `requestAccess`**

In `jit-service/src/domain/grantService.ts`, replace this block:

```ts
      if (grantRepo.countInFlight(caller.userId, policyId) > 0) {
        throw new AppError(
          ErrorCodes.CONFLICT,
          "You already have a pending or active request for this policy",
          409,
        );
      }
      const grant = grantRepo.create({
        policyId,
        requesterUserId: caller.userId,
        requesterEmail: caller.email,
        requestedDurationMinutes: input.durationMinutes,
        justification: input.justification,
        pendingExpiresAt: minutesFrom(now(), policy.pendingTtlMinutes),
      });
```

with:

```ts
      if (grantRepo.countUndecided(caller.userId, policyId) > 0) {
        throw new AppError(
          ErrorCodes.CONFLICT,
          "You already have a request awaiting a decision for this policy",
          409,
        );
      }
      // An active grant means this is an extension/renewal: it supersedes that grant on approval.
      const active = grantRepo.getActiveFor(caller.userId, policyId);
      const grant = grantRepo.create({
        policyId,
        requesterUserId: caller.userId,
        requesterEmail: caller.email,
        requestedDurationMinutes: input.durationMinutes,
        justification: input.justification,
        pendingExpiresAt: minutesFrom(now(), policy.pendingTtlMinutes),
        supersedesGrantId: active?.id,
      });
```

And add `extension` to the create-audit detail — change:
```ts
        detail: { durationMinutes: input.durationMinutes },
```
to:
```ts
        detail: { durationMinutes: input.durationMinutes, extension: Boolean(active) },
```

Now that `requestAccess` no longer calls `countInFlight`, remove the dead code in `jit-service/src/db/repositories/grantRepo.ts`: delete the `inFlightStmt` declaration and the `countInFlight` method (the `undecidedStmt`/`countUndecided` added in Task 1 replace them). Confirm nothing else references `countInFlight`:

Run: `cd jit-service && grep -rn countInFlight src test`
Expected: no matches.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd jit-service && npm test && npm run typecheck`
Expected: the full backend suite PASSES (including the existing "blocks duplicates" case — a pending grant still blocks) and typecheck is clean (verifying the `countInFlight` removal broke nothing).

- [ ] **Step 5: Commit**

```bash
git add jit-service/src/domain/grantService.ts jit-service/src/db/repositories/grantRepo.ts jit-service/test/grantService.test.ts
git commit -m "feat(jit): allow an extension request while a grant is active"
```

---

### Task 3: Supersede the prior grant on activation

**Files:**
- Modify: `jit-service/src/domain/grantService.ts` (`activate`)
- Test: `jit-service/test/grantService.test.ts` (add a case)

**Interfaces:**
- Consumes: `grantRepo.getById`, `grantRepo.update`, `audit.append`, `iso()`, `now()` (all already in scope).
- Produces: approving a grant with `supersedesGrantId` retires the referenced grant to `superseded` (only if still `active`) without removing membership.

- [ ] **Step 1: Write the failing test**

In `jit-service/test/grantService.test.ts`, add:

```ts
  it("approving an extension supersedes the prior active grant without touching membership", async () => {
    const { svc, grantRepo, membership, policy } = setup();
    const g1 = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    await svc.approve(g1.id, admin); // g1 active, expires 13:00

    const g2 = svc.requestAccess(policy.id, requester, { durationMinutes: 120 });
    expect(g2.supersedesGrantId).toBe(g1.id);

    membership.calls.length = 0;
    const active2 = await svc.approve(g2.id, admin);
    expect(active2.status).toBe("active");
    expect(active2.expiresAt).toBe("2026-06-26T14:00:00.000Z"); // FIXED + 120m (fresh period)
    expect(grantRepo.getById(g1.id)!.status).toBe("superseded");
    // the renewal re-adds the group (idempotent no-op in prod) but NEVER removes it
    expect(membership.calls.some((c) => c.op === "remove")).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jit-service && npm test -- grantService`
Expected: FAIL — `g1` status is still `active` (not `superseded`).

- [ ] **Step 3: Add the supersede step to `activate`**

In `jit-service/src/domain/grantService.ts`, inside `activate`, after the `const active = grantRepo.update(...)` assignment and its `audit.append({ action: "grant.activate", ... })` call, and before `return active;`, insert:

```ts
      // If this grant renews an existing one, retire the prior grant — but never
      // remove the backing group (this grant now holds it). Only supersede if the
      // target is still active; if it already expired/ended, leave its status intact.
      if (active.supersedesGrantId) {
        const prior = grantRepo.getById(active.supersedesGrantId);
        if (prior && prior.status === "active") {
          grantRepo.update(prior.id, {
            status: "superseded",
            revokedAt: iso(),
            revokeReason: "superseded_by_renewal",
          });
          audit.append({
            action: "grant.supersede",
            actorUserId: actor?.userId,
            actorEmail: actor?.email,
            policyId: policy.id,
            grantId: prior.id,
            detail: { supersededBy: grantId },
          });
        }
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd jit-service && npm test -- grantService && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add jit-service/src/domain/grantService.ts jit-service/test/grantService.test.ts
git commit -m "feat(jit): supersede the prior active grant when a renewal activates"
```

---

### Task 4: Admin direct-extend (service method + schema + route)

**Files:**
- Modify: `jit-service/src/domain/grantService.ts` (add `extendByAdmin`)
- Modify: `jit-service/src/schemas/request.ts` (add `ExtendRequest`)
- Modify: `jit-service/src/routes/adminRequests.ts` (add the route)
- Test: `jit-service/test/grantService.test.ts` (add a case)

**Interfaces:**
- Consumes: `mustGrant`, `policyFor`, `assertCanApprove`, `activate`, `grantRepo.create`, `iso()`.
- Produces: `grantService.extendByAdmin(activeGrantId, caller, durationMinutes): Promise<JitGrant>` and `POST /admin/grants/:id/extend { durationMinutes }`.

- [ ] **Step 1: Write the failing test**

In `jit-service/test/grantService.test.ts`, add:

```ts
  it("admin extend creates a superseding active grant, capped at max, gated to approvers", async () => {
    const { svc, grantRepo, membership, policy } = setup();
    const g1 = svc.requestAccess(policy.id, requester, { durationMinutes: 60 });
    await svc.approve(g1.id, admin);

    membership.calls.length = 0;
    const renewed = await svc.extendByAdmin(g1.id, admin, 120);
    expect(renewed.status).toBe("active");
    expect(renewed.expiresAt).toBe("2026-06-26T14:00:00.000Z");
    expect(renewed.supersedesGrantId).toBe(g1.id);
    expect(grantRepo.getById(g1.id)!.status).toBe("superseded");
    expect(membership.calls.some((c) => c.op === "remove")).toBe(false);

    await expect(svc.extendByAdmin(renewed.id, admin, 999)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION });
    await expect(svc.extendByAdmin(renewed.id, requester, 30)).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });
    await expect(svc.extendByAdmin(g1.id, admin, 30)).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd jit-service && npm test -- grantService`
Expected: FAIL — `svc.extendByAdmin is not a function`.

- [ ] **Step 3: Implement `extendByAdmin`**

In `jit-service/src/domain/grantService.ts`, add this method to the returned object (place it right after the `revoke` method, before `terminateAllForPolicy`):

```ts
    /**
     * Admin/approver renews an active grant directly (no pending step): create a
     * pre-approved superseding grant and activate it. Renews the clock to
     * now + duration; membership is unchanged (the target already holds the group).
     */
    async extendByAdmin(activeGrantId: string, caller: Caller, durationMinutes: number): Promise<JitGrant> {
      const target = mustGrant(activeGrantId);
      if (target.status !== "active") {
        throw new AppError(ErrorCodes.CONFLICT, "Only active grants can be extended", 409);
      }
      const policy = policyFor(target);
      assertCanApprove(caller, policy.approverCriteria);
      if (durationMinutes > policy.maxDurationMinutes) {
        throw new AppError(
          ErrorCodes.VALIDATION,
          `Requested duration exceeds the maximum of ${policy.maxDurationMinutes} minutes`,
          400,
        );
      }
      const renewal = grantRepo.create({
        policyId: target.policyId,
        requesterUserId: target.requesterUserId,
        requesterEmail: target.requesterEmail,
        requestedDurationMinutes: durationMinutes,
        supersedesGrantId: target.id,
      });
      grantRepo.update(renewal.id, {
        status: "approved",
        approverUserId: caller.userId,
        approverEmail: caller.email,
        decidedAt: iso(),
      });
      audit.append({
        action: "grant.approve",
        actorUserId: caller.userId,
        actorEmail: caller.email,
        policyId: policy.id,
        grantId: renewal.id,
        detail: { adminExtend: true },
      });
      return activate(renewal.id, policy, caller);
    },
```

- [ ] **Step 4: Add the request schema**

In `jit-service/src/schemas/request.ts`, append:

```ts
export const ExtendRequest = z.object({
  durationMinutes: z.number().int().positive(),
});
export type ExtendRequest = z.infer<typeof ExtendRequest>;
```

- [ ] **Step 5: Add the route**

In `jit-service/src/routes/adminRequests.ts`, update the schema import:

```ts
import { DecisionReason, ExtendRequest } from "../schemas/request.js";
```

And add this route immediately after the `/admin/grants/:id/revoke` handler (it is approver-gated by the service, like approve/deny — not `assertAdmin`):

```ts
  app.post("/admin/grants/:id/extend", auth, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(ExtendRequest, req.body);
    return ok(await grants.extendByAdmin(id, req.caller!, body.durationMinutes));
  });
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd jit-service && npm test && npm run typecheck`
Expected: all tests PASS (the original suite + the new grantRepo and extension cases); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add jit-service/src/domain/grantService.ts jit-service/src/schemas/request.ts jit-service/src/routes/adminRequests.ts jit-service/test/grantService.test.ts
git commit -m "feat(jit): admin direct-extend endpoint for active grants"
```

---

### Task 5: Frontend data layer — status, type, provider method

**Files:**
- Modify: `src/modules/jit/interfaces/Jit.ts` (status union + field)
- Modify: `src/modules/jit/misc/format.tsx` (badge variant)
- Modify: `src/modules/jit/JitProvider.tsx` (`extendGrant`)

**Interfaces:**
- Produces: frontend `GrantStatus` includes `"superseded"`; `JitGrant.supersedesGrantId?: string`; `useJit().extendGrant(id: string, durationMinutes: number): Promise<void>`.

- [ ] **Step 1: Update the interface**

In `src/modules/jit/interfaces/Jit.ts`, add `"superseded"` to the `GrantStatus` union:

```ts
export type GrantStatus =
  | "pending"
  | "approved"
  | "active"
  | "expired"
  | "denied"
  | "revoked"
  | "cancelled"
  | "superseded"
  | "failed";
```

And add to the `JitGrant` interface, immediately after `policyName?: string;`:

```ts
  /** When set, this grant renews/replaces the referenced grant on activation. */
  supersedesGrantId?: string;
```

- [ ] **Step 2: Add the status badge variant**

In `src/modules/jit/misc/format.tsx`, add to the `STATUS_VARIANT` map (after `cancelled`):

```ts
  superseded: "gray",
```

- [ ] **Step 3: Add `extendGrant` to the provider**

In `src/modules/jit/JitProvider.tsx`:

Add to the `JitContextValue` type (after `revokeGrant`):
```ts
  extendGrant: (id: string, durationMinutes: number) => Promise<void>;
```
Add the implementation (after the `revokeGrant` function):
```ts
  const extendGrant = (id: string, durationMinutes: number) =>
    run(
      adminGrantCall.post({ durationMinutes }, `/${id}/extend`).then(() => active.mutate()),
      "Extend grant",
      "Grant extended",
      "Extending…",
    );
```
Add `extendGrant` to the `value` object (after `revokeGrant`):
```ts
    extendGrant,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/modules/jit/interfaces/Jit.ts src/modules/jit/misc/format.tsx src/modules/jit/JitProvider.tsx
git commit -m "feat(jit): frontend superseded status and extendGrant provider action"
```

---

### Task 6: Request page — user "Extend" action

**Files:**
- Modify: `src/modules/jit/modals/JitRequestModal.tsx` (optional `mode` prop)
- Modify: `src/app/(dashboard)/jit/request/page.tsx` (Extend button, extension tag)

**Interfaces:**
- Consumes: `useJit().requestAccess` (existing — backend auto-detects the supersede), `useJit().eligiblePolicies`, `useJit().myRequests`.
- Produces: an "Extend" affordance on active rows that opens `JitRequestModal` in `mode="extend"`.

- [ ] **Step 1: Add a `mode` prop to the request modal**

In `src/modules/jit/modals/JitRequestModal.tsx`, extend `Props`:

```ts
type Props = {
  policy: EligiblePolicy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "request" | "extend";
};
```
Update the component signature:
```ts
export function JitRequestModal({ policy, open, onOpenChange, mode = "request" }: Props) {
```
Replace the `ModalHeader` with mode-aware copy:
```tsx
        <ModalHeader
          icon={<Clock3Icon size={18} />}
          title={`${mode === "extend" ? "Extend" : "Request"}: ${policy.name}`}
          description={
            mode === "extend"
              ? "Request more time. Your current access continues uninterrupted until this is approved."
              : "Request temporary access. It expires automatically when the time is up."
          }
          color="netbird"
        />
```
Replace the submit button label:
```tsx
            <Button variant="primary" disabled={invalid || submitting} onClick={submit}>
              {mode === "extend" ? "Submit extension" : "Submit request"}
            </Button>
```

- [ ] **Step 2: Wire the Extend button into the request page**

In `src/app/(dashboard)/jit/request/page.tsx`:

Add imports:
```tsx
import Badge from "@components/Badge";
```
Destructure `eligiblePolicies` (already present) — no change. Add state below `selected`:
```tsx
  const [extendPolicy, setExtendPolicy] = useState<EligiblePolicy | null>(null);
```
Replace the `policy` column definition with one that tags extensions:
```tsx
    {
      id: "policy",
      header: "Policy",
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {row.original.policyName ?? "—"}
          {row.original.supersedesGrantId && (
            <span>
              <Badge variant="blue">extension</Badge>
            </span>
          )}
        </span>
      ),
    },
```
Replace the `actions` column cell so active rows offer Extend + End now:
```tsx
      cell: ({ row }) => {
        const g = row.original;
        if (g.status === "pending")
          return (
            <Button variant="secondary" size="xs" onClick={() => cancelRequest(g.id)}>
              Cancel
            </Button>
          );
        if (g.status === "active") {
          const elig = eligiblePolicies?.find((p) => p.id === g.policyId);
          const pendingExists = (myRequests ?? []).some(
            (r) => r.status === "pending" && r.policyId === g.policyId,
          );
          return (
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                size="xs"
                disabled={!elig || pendingExists}
                onClick={() => elig && setExtendPolicy(elig)}
                title={
                  !elig
                    ? "You are no longer eligible for this policy"
                    : pendingExists
                      ? "An extension is already pending"
                      : undefined
                }
              >
                Extend
              </Button>
              <Button variant="danger-outline" size="xs" onClick={() => endGrant(g.id)}>
                End now
              </Button>
            </div>
          );
        }
        return null;
      },
```
Add the extend modal next to the existing request modal (before `</PageContainer>`):
```tsx
      {extendPolicy && (
        <JitRequestModal
          policy={extendPolicy}
          mode="extend"
          open={!!extendPolicy}
          onOpenChange={(open) => {
            if (!open) setExtendPolicy(null);
          }}
        />
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/jit/modals/JitRequestModal.tsx "src/app/(dashboard)/jit/request/page.tsx"
git commit -m "feat(jit): request page Extend action and extension tag"
```

---

### Task 7: Approvals page — admin "Extend" button + extension indicator

**Files:**
- Create: `src/modules/jit/modals/JitExtendModal.tsx`
- Modify: `src/app/(dashboard)/jit/approvals/page.tsx`

**Interfaces:**
- Consumes: `useJit().extendGrant` (Task 5), `useJit().policies` (for `maxDurationMinutes`).
- Produces: `JitExtendModal` component; admin Extend on active grants; "Extension" tag on pending extension requests.

- [ ] **Step 1: Create the admin extend modal**

Create `src/modules/jit/modals/JitExtendModal.tsx`:

```tsx
"use client";

import Button from "@components/Button";
import HelpText from "@components/HelpText";
import { Input } from "@components/Input";
import { Label } from "@components/Label";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@components/modal/Modal";
import ModalHeader from "@components/modal/ModalHeader";
import { Clock3Icon } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import type { JitGrant } from "../interfaces/Jit";
import { useJit } from "../JitProvider";
import { formatDuration } from "../misc/format";

type Props = {
  grant: JitGrant;
  maxDurationMinutes: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function JitExtendModal({ grant, maxDurationMinutes, open, onOpenChange }: Props) {
  const { extendGrant } = useJit();
  const [minutes, setMinutes] = useState(String(Math.min(60, maxDurationMinutes)));
  const [submitting, setSubmitting] = useState(false);

  const value = parseInt(minutes || "0", 10);
  const invalid = !value || value < 1 || value > maxDurationMinutes;

  const submit = async () => {
    if (invalid) return;
    setSubmitting(true);
    try {
      await extendGrant(grant.id, value);
      onOpenChange(false);
    } catch {
      /* notify surfaces the error */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent maxWidthClass="max-w-md">
        <ModalHeader
          icon={<Clock3Icon size={18} />}
          title={`Extend access for ${grant.requesterEmail ?? grant.requesterUserId}`}
          description="Grant more time now. Access continues uninterrupted; the new window starts at approval."
          color="netbird"
        />
        <div className="px-8 py-6">
          <Label>New duration</Label>
          <HelpText>Up to a maximum of {formatDuration(maxDurationMinutes)}.</HelpText>
          <Input
            type="number"
            min={1}
            max={maxDurationMinutes}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            customPrefix={<Clock3Icon size={16} className="text-nb-gray-300" />}
            customSuffix="minute(s)"
            maxWidthClass="max-w-[240px]"
            error={invalid ? `Enter a value between 1 and ${maxDurationMinutes}` : undefined}
          />
        </div>
        <ModalFooter className="items-center">
          <div className="flex gap-3 w-full justify-end">
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button variant="primary" disabled={invalid || submitting} onClick={submit}>
              Extend access
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire the approvals page**

In `src/app/(dashboard)/jit/approvals/page.tsx`:

Add imports:
```tsx
import Badge from "@components/Badge";
import { JitExtendModal } from "@/modules/jit/modals/JitExtendModal";
```
Add `extendGrant` to the `useJit()` destructure:
```tsx
  const { pendingRequests, activeGrants, policies, approveRequest, denyRequest, revokeGrant, refreshAdmin, extendGrant } = useJit();
```
> Note: `extendGrant` is referenced by the modal via `useJit()`, so destructuring it here is optional — keep the destructure as-is if you prefer; do not leave an unused variable (lint will flag it). The modal handles the call.

Add state (after `policyFilter`):
```tsx
  const [extendTarget, setExtendTarget] = useState<JitGrant | null>(null);
```
In `pendingColumns`, replace the `policy` column cell to tag extensions:
```tsx
    {
      id: "policy",
      header: "Policy",
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {policyName(row.original)}
          {row.original.supersedesGrantId && <Badge variant="blue">extension</Badge>}
        </span>
      ),
    },
```
In `activeColumns`, replace the `actions` column cell to add Extend before Revoke:
```tsx
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="xs" onClick={() => setExtendTarget(row.original)}>
            Extend
          </Button>
          <Button variant="danger-outline" size="xs" onClick={() => revokeGrant(row.original.id)}>
            Revoke
          </Button>
        </div>
      ),
```
Add the modal render before the closing `</RestrictedAccess>` (after the tab/table block):
```tsx
          {extendTarget && (
            <JitExtendModal
              grant={extendTarget}
              maxDurationMinutes={
                policies?.find((p) => p.id === extendTarget.policyId)?.maxDurationMinutes ??
                extendTarget.requestedDurationMinutes
              }
              open={!!extendTarget}
              onOpenChange={(open) => {
                if (!open) setExtendTarget(null);
              }}
            />
          )}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean; `next build` completes (static export) with no errors. If `extendGrant` is destructured but unused, remove it from the destructure to satisfy lint.

- [ ] **Step 4: Commit**

```bash
git add src/modules/jit/modals/JitExtendModal.tsx "src/app/(dashboard)/jit/approvals/page.tsx"
git commit -m "feat(jit): approvals page admin Extend action and extension indicator"
```

---

### Task 8: Documentation — reverse Decision #10, ADR, glossary

**Files:**
- Modify: `docs/jit-access.md` (the no-extend behaviour decision)
- Create: `docs/adr/0004-grant-renewals-via-supersede.md`
- Modify: `CONTEXT.md` (glossary)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `docs/jit-access.md`**

Find the behaviour decision that states there is no extend / re-request after expiry (search the file for `extend`). Replace the "no extend" statement with:

```markdown
- **Extensions (renewals).** A user may request an **extension** of an active Grant; an approver approves it like any Request. Approval renews the window to `approvalTime + requestedDuration` (capped at the JIT policy's max), modelled as a new Grant that **supersedes** the prior one — membership is never dropped, so access is continuous. Renewable repeatedly (each renewal is approved). Admins/approvers can also extend an active Grant directly. There is **one undecided Request per (user, JIT policy)**: a second Request is blocked while one is pending/approved, but an extension Request is allowed while a Grant is active. See [ADR 0004](./adr/0004-grant-renewals-via-supersede.md).
```

- [ ] **Step 2: Create ADR 0004**

Create `docs/adr/0004-grant-renewals-via-supersede.md`:

```markdown
# 4. Grant renewals via supersede

Date: 2026-06-27

## Status

Accepted. Reverses the "No extend — re-request after expiry" clause of the original behaviour decisions.

## Context

A Grant had a fixed `expiresAt`; regaining access after expiry meant re-requesting, leaving an access gap, and there was no way to re-approve/extend an existing Grant. Users need to ask for more time before access lapses; admins need to grant more time without the user starting over.

Two axes were decided with the product owner:
- **Authorization:** request → approve (every Grant stays human-approved) over self-service-to-max.
- **Semantics:** renew a fresh period (`approvalTime + requested`, capped at the policy max, renewable) over a cumulative lifetime cap. The per-renewal approval is the control, not a cumulative timer.

## Decision

Model an extension as a **new Grant row** that *supersedes* the requester's active Grant for the same policy (`supersedesGrantId`). On activation the superseding Grant retires the prior one to `superseded` **without removing the backing group** (membership is binary and idempotent, so access never drops). The in-flight rule blocks a second *undecided* Request but allows an extension Request while a Grant is `active`. Admins can extend directly via a pre-approved superseding Grant.

Chosen over mutating `expiresAt` in place (pending-extension fields on the active Grant) because an extension Request flows through the existing request → approve → active machinery and Approvals queue almost untouched, and each renewal is independently auditable.

## Consequences

- There is always exactly one `active` Grant per (user, policy); scheduler/expiry/reconcile/revoke are unchanged.
- More Grant rows over time, handled by the existing terminal-grant retention cleanup.
- A new terminal status `superseded` (JIT-owned types only — no upstream edits).
- No cumulative lifetime ceiling; exposure is bounded per renewal by the policy max and by requiring approval each time.
```

- [ ] **Step 3: Update `CONTEXT.md`**

Add a glossary entry near the **Grant** definition:

```markdown
- **Extension (Renewal)** — a Request that supersedes the requester's active Grant for the same JIT policy. On approval it renews the access window (`approvalTime + requestedDuration`, capped at the policy max) by activating a new Grant that retires the prior one (`superseded`), with no membership change. Renewable repeatedly.
- **superseded** — terminal Grant status for a Grant that has been replaced by an approved renewal.
```

- [ ] **Step 4: Commit**

```bash
git add docs/jit-access.md docs/adr/0004-grant-renewals-via-supersede.md CONTEXT.md
git commit -m "docs(jit): document grant renewals (reverse no-extend decision)"
```

---

### Task 9: Integration verification in the local stack

**Files:** none (running-system verification).

This task validates the full flow against the running local NetBird CE stack (dashboard image `jit-dashboard:local`, jit-service host process on :8090). It is the final gate; no commit unless a fix is needed.

- [ ] **Step 1: Restart jit-service to apply migration v2**

Restart the host jit-service process (e.g. stop the running `node --env-file=.env --import tsx src/main.ts` and start it again from `jit-service/`). The v2 `ALTER TABLE` runs on startup against the local SQLite DB.

Verify the column exists:
Run: `sqlite3 "$(node -e "console.log(require('./jit-service/src/config.ts')?.dbPath||'')" 2>/dev/null || echo jit-service/local-netbird/data/jit.db)" "PRAGMA table_info(jit_grants);" 2>/dev/null | grep supersedes_grant_id || echo "check DB path"`
Expected: a row mentioning `supersedes_grant_id` (or locate the DB path from the service's `.env`/config and re-check).

- [ ] **Step 2: Rebuild and restart the dashboard image (Node 20)**

Run (from repo root, Node 20 active):
```bash
npm run build && docker build -f docker/Dockerfile -t jit-dashboard:local . && docker compose -f jit-service/local-netbird/docker-compose.yml up -d --force-recreate dashboard
```
Expected: build + image build succeed; the dashboard container restarts.

- [ ] **Step 3: E2E — user-requested extension (happy path)**

In the browser at `http://localhost` (admin login), using Playwright/the dev-tools driver:
1. Ensure a JIT policy exists you are eligible for; from **Request Access**, request a short duration; approve it from **Approvals → Pending**.
2. On **Request Access**, the active row shows **Extend**. Click it → the modal title reads "Extend: …"; submit a longer duration.
3. A pending **extension** row appears (tagged "extension"); the active row's Extend is now disabled ("An extension is already pending").
4. In **Approvals → Pending**, the extension request shows tagged "extension". Approve it.
5. Verify: the active grant's **Expires** moved out to ≈ now + the new duration; only **one** active grant for that policy is listed; the superseded grant is not in the active list. Access was never interrupted (the user's peer kept the backing group throughout).

Expected: all of the above hold.

- [ ] **Step 4: E2E — admin direct extend**

In **Approvals → Active grants**, click **Extend** on a grant, submit a duration ≤ max. Verify the row's **Expires** moves out and exactly one active grant remains for that (user, policy).

Expected: holds. Over-max input is rejected inline by the modal.

- [ ] **Step 5: Confirm the backend suite is green end-to-end**

Run: `cd jit-service && npm test`
Expected: all tests pass (final regression check).

---

## Self-Review

**Spec coverage** (spec → task):
- Decision 1 (request → approve) → Tasks 2, 3 (user path reuses existing approve).
- Decision 2 (renew fresh period, capped at max, repeatable) → Task 3 (`expiresAt = approvalTime + requested`), Tasks 2/4 (per-request max cap), in-flight relaxation allows repeats.
- Decision 3 (admin direct extend) → Task 4 + Task 7.
- Supersede model / `superseded` status / `supersedesGrantId` → Tasks 1, 3, 5.
- Relax in-flight (block undecided, allow while active) → Tasks 1 (`countUndecided`/`getActiveFor`), 2.
- "Extension" tagging in UI → Tasks 6, 7.
- Edge cases (target already terminal → no clobber; double-extend blocked; cancel reuses existing; eligibility revoked → disabled) → Task 3 (`status === "active"` guard), Task 2 (undecided block), existing cancel, Task 6 (`!elig` disable).
- Docs (jit-access.md #10, ADR 0004, CONTEXT.md) → Task 8.
- Tests (backend unit + flow E2E) → Tasks 1–4 (vitest), Task 9 (E2E).

**Placeholder scan:** none — every code step shows complete code; every run step shows command + expected output.

**Type consistency:** `countUndecided`/`getActiveFor`/`supersedesGrantId`/`extendByAdmin(activeGrantId, caller, durationMinutes)`/`extendGrant(id, durationMinutes)`/`ExtendRequest { durationMinutes }`/status `superseded` are named identically across backend (Tasks 1–4) and frontend (Tasks 5–7).
