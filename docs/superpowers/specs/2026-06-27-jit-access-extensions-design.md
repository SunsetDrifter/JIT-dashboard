# JIT Access — Grant Extensions (Renewals)

> Status: **Design approved** · Fork-only feature (isolated from upstream `netbirdio/dashboard`).
> Reverses Decision #10 ("No extend — re-request after expiry") in [`docs/jit-access.md`](../../jit-access.md).
> Glossary: [`/CONTEXT.md`](../../../CONTEXT.md) · Prior decisions: [`docs/adr/`](../../adr/).

## Motivation

Today a JIT **Grant** has a fixed `expiresAt = approvalTime + requestedDuration`. When it expires, the backing group is removed and the user must **re-request after expiry** — leaving an **access gap** while they wait for re-approval, and there is **no way to "re-approve" or extend an existing grant**. Users want to ask for more time before their access lapses; admins want to grant more time without making the user start over.

## Decisions (settled with the user)

1. **Authorization — request → approve.** A user *requests* an extension; an approver approves or denies it, exactly like the initial request, reusing the Approvals queue. Preserves the v1 invariant that **every grant is approved** (no auto-approve, no self-service-to-max).
2. **Semantics — renew a fresh period.** Approving an extension sets `expiresAt = approvalTime + requestedDuration`, capped per-request at the policy's `maxDurationMinutes` (the same cap as a first request). **Renewable repeatedly**, each renewal independently approved. There is **no cumulative ceiling** — the per-renewal human gate is the control.
3. **Admin direct extend — yes.** In addition to the user-requested path, an admin/approver can extend an `active` grant directly from the Approvals → Active grants tab (pick a duration ≤ max), with no pending step.

## Core insight

Backing-group membership is **binary and idempotent**: `membership.add` is a no-op when the user is already a member, and `membership.remove` already skips removal while *another* active grant still needs the group. So a renewal **never touches NetBird** — the user's peer access is **continuous** across the renewal. "Extending" is fundamentally just moving `expiresAt` forward on the single active grant.

## Architecture — "supersede" model

An extension is modelled as a **new grant row** that *supersedes* the prior active grant, rather than mutating fields on the existing one. Chosen over the alternative ("extend in place" with pending-extension fields on the active grant) because:

- An extension request **is** a `pending` row, so it flows through the **existing** request → approve → active state machine and shows up in the Approvals queue with near-zero new plumbing — lowest risk in a security-sensitive path.
- Each renewal is an **independently auditable** decision: its own requester, justification, approver, and timestamp.
- The new terminal status lives entirely in JIT-owned files → **zero upstream edits** (honors the 2-sanctioned-upstream-edits fork invariant).

Trade-off accepted: a new `superseded` status, a precise relaxation of the in-flight rule, and more rows over time (already handled by the existing retention cleanup of terminal grants).

**Invariant preserved:** there is still **exactly one `active` grant per (user, policy)** at any instant — the superseding grant — so the scheduler, expiry, reconcile, and revoke paths are unchanged.

## Lifecycle

### User-requested extension
1. On the Request page, an `active` grant row shows an **Extend** button → opens the existing request modal for that policy (duration ≤ policy max, optional justification).
2. `requestAccess` in-flight rule is relaxed: **blocked** only if a `pending` or `approved` grant exists for (user, policy); **allowed** when the only in-flight grant is `active`. When allowed on that basis, the new pending request is stamped `supersedesGrantId = <the active grant's id>`.
3. The request appears in **Approvals → Pending**, tagged **"Extension"** (UI derives this from `supersedesGrantId`).
4. On **approve**, `activate()`:
   - adds the backing group (idempotent no-op → **no access drop**),
   - sets the new grant `active` with `expiresAt = approvalTime + requestedDuration`,
   - retires the grant referenced by `supersedesGrantId` → `superseded` **only if it is still `active`** (no membership removal; the new grant holds the group). If that grant already reached a terminal state (e.g. expired while the request sat pending), it is left untouched and the new grant simply activates fresh.
5. On **deny**, the extension request → `denied`; the active grant is unaffected and expires as scheduled.

### Admin direct extend
1. **Extend** button on **Approvals → Active grants** opens a small duration modal (≤ policy max).
2. `POST /admin/grants/:id/extend { durationMinutes }` → service creates a **pre-approved** superseding grant (approver = the admin) and activates it immediately via the same `activate()` + supersede path.

## Data model changes (all JIT-owned)

- **`GrantStatus`** gains terminal value **`superseded`** — in `jit-service/src/domain/types.ts` (zod enum + interface) and `src/modules/jit/interfaces/Jit.ts`.
- **`jit_grants`** gains nullable column **`supersedes_grant_id TEXT`** (migration in `jit-service/src/db/migrations.ts`).
- **`JitGrant`** gains optional **`supersedesGrantId?: string`** (both type mirrors).

## Backend changes (`jit-service`)

- **`grantRepo.ts`** — map the new column in row⇄grant + SQL `COLS/VALS/SET`; add `getActiveFor(userId, policyId): JitGrant | null`; add an "undecided in-flight" check (`pending`/`approved` only) for the relaxed rule.
- **`grantService.ts`**
  - `requestAccess`: replace the blanket `countInFlight > 0` block with: block if an *undecided* (`pending`/`approved`) grant exists; if an `active` grant exists (and no undecided one), allow and set `supersedesGrantId`.
  - `activate()`: after the grant goes active, if it carries `supersedesGrantId` and that grant is still `active`, set the referenced grant `superseded` (timestamp + reason, **no** `membership.remove`) and append a `grant.supersede` audit entry.
  - `extendByAdmin(activeGrantId, caller, durationMinutes)`: assert caller can approve the policy; cap at `maxDurationMinutes`; create an approved superseding grant and `activate()` it.
- **`schemas/request.ts`** — `ExtendRequest = { durationMinutes: positive int }`.
- **`routes/adminRequests.ts`** — `POST /admin/grants/:id/extend` (approver-gated like approve/deny), returns the new active grant.
- Audit actions: `grant.supersede`; the admin path also emits the normal `grant.approve`/`grant.activate`.

## Frontend changes (JIT module only)

- **`interfaces/Jit.ts`** + **`misc/format.ts`** — add `superseded` to the status union and a badge style.
- **`JitProvider.tsx`** — add `extendGrant(id, durationMinutes)` (admin path → `POST /admin/grants/:id/extend`, then refresh active). The **user path needs no new method** — it reuses `requestAccess(policyId, minutes, justification)`; the backend auto-detects the supersede.
- **`request/page.tsx`** — on `active` rows, an **Extend** button that finds the matching `EligiblePolicy` (by `policyId`) and opens the existing `JitRequestModal`. Disabled with a tooltip if the user is no longer eligible for that policy. Pending rows with `supersedesGrantId` get an **"Extension"** tag and keep the existing Cancel action.
- **`approvals/page.tsx`** — Pending tab: show an **"Extension"** indicator on requests with `supersedesGrantId`. Active grants tab: an **Extend** button opening a small admin duration modal → `extendGrant`.
- **Modal** — a small `JitExtendModal` (or a `mode="admin-extend"` variant of the request modal) for the admin duration pick, capped at the policy max.

## Edge cases

- **Active grant expires before approval** → no clobber (prior grant left in its terminal state); the new grant activates fresh. A brief gap can occur — identical to today's re-request, and avoided in the happy path by approving before expiry.
- **Double extension** → blocked: a pending extension counts as an undecided in-flight grant.
- **Cancel a pending extension** → reuses the existing cancel flow; the active grant is unaffected.
- **Eligibility revoked after the grant** → Extend button disabled (no matching `EligiblePolicy`); backend still re-checks eligibility in `requestAccess`.
- **Propagation disabled** → approve already fails closed; unchanged.

## Testing

- **Backend (`grantService`):** extension request allowed while `active`, blocked while `pending`/`approved`; approve supersedes the prior active grant (old→`superseded`, **no** membership removal, new `expiresAt = now + requested`); admin direct extend supersedes immediately and is capped at max; supersede target already terminal → activates fresh without clobber; duration over max rejected.
- **Backend (reconcile/scheduler):** unchanged behavior with a `superseded` grant present (still one active per user/policy).
- **Frontend:** status badge renders `superseded`; Extend button gating; provider `extendGrant` calls the right endpoint and refreshes.
- Target ≥ 80% coverage, consistent with the rest of the service.

## Docs to update on implementation

- **`docs/jit-access.md`** — revise Decision #10 from "No extend" to the renewal model above.
- **`docs/adr/0004-grant-renewals-via-supersede.md`** — new ADR: reverses #10; records the renew-vs-cumulative-cap trade-off and the supersede-vs-in-place choice.
- **`/CONTEXT.md`** — add **Extension / Renewal** as a glossary term (a Request that supersedes the requester's active Grant for the same JIT policy).

## Out of scope (v1)

- Cumulative lifetime cap across renewals (rejected in favor of per-renewal approval).
- Self-service extension without approval.
- Notifying the user when an extension is approaching its own expiry (covered by the existing in-dashboard surfacing).
