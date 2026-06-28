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
- The "exactly one `active` Grant per (user, policy)" invariant is **enforced on the direct-extend path** by an atomic compare-and-set: `extendByAdmin` first transitions the target `active → superseded` and only the winner creates + activates the renewal, so two concurrent extends can't both produce an active Grant (this closed a latent double-active bug). Because the claim now precedes activation, an extend that fails mid-flight leaves the target `superseded` with no active Grant — the reconcile pass removes membership (**fail-closed**, per [ADR 0003](./0003-reconcile-fail-closed-durability.md)) and the failed-grant retry re-activates the renewal once NetBird recovers, replacing the earlier fail-*open* (prior Grant kept on extend failure).
- All Grant status changes — including supersede — now flow through one **grant-lifecycle** transition seam (legal-edge table + atomic compare-and-set + derived audit; see [`/CONTEXT.md`](../../CONTEXT.md)), so the supersede semantics above are defined in exactly one place. Extending the one-active guarantee to *every* path (reconcile, retry, the request→approve renewal) rather than just direct extend would take a `UNIQUE(policy_id, requester_user_id) WHERE status='active'` partial index; recorded as the future backstop, not currently implemented.
