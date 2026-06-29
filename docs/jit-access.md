# Just-in-Time (JIT) Access — Design

> Status: **Accepted** · Fork-only feature (isolated from upstream `netbirdio/dashboard`).
> Glossary lives in [`/CONTEXT.md`](../CONTEXT.md); key decisions in [`docs/adr/`](./adr/).

## Summary

Admins define **JIT policies** that let eligible users request **temporary, approved** access to specific NetBird network resources. An approved **Request** becomes a time-boxed **Grant**: the user is added to a JIT-owned backing group (which carries an access policy to the resources) and is automatically removed at expiry.

- Self-service request → **admin approval** → auto-expiry. Approval is always required in v1.
- **Reliable** revocation, enforced server-side even when nobody is logged in.
- Scope: the dashboard frontend + the JIT module built into the management server (fork `SunsetDrifter/netbird-JIT`). Not the NetBird client/agent. Single NetBird account.

## Architecture

JIT is implemented inside the management server fork. The combined server image exposes `/api/jit/...` using the same OIDC bearer authentication as all other `/api/` endpoints. There is no separate sidecar or companion service.

```
Browser (dashboard, static)               Management server (netbird-JIT fork)
  /jit/request   (user)  ── bearer ─▶    POST /api/jit/requests
  /jit/policies  (admin) ── bearer ─▶    JIT-policy CRUD → provisions group+policy ─▶ NetBird account store
  /jit/approvals (admin) ── bearer ─▶    approve / deny / revoke ──┐
                                          scheduler: expire + auto-deny + reconcile ─┼─▶ user auto_groups
                                          DB (policies, grants, audit) ◀─────────────┘
JIT-owned groups/policies hidden from /api/groups and /api/policies responses server-side
```

- The browser calls `/api/jit/...` with the same relative origin and OIDC bearer as all other API calls — no CSP/CORS changes, no extra configuration.
- The management server fork (`SunsetDrifter/netbird-JIT`) builds a combined image (management + embedded Dex IdP + signal + relay) via `combined/Dockerfile.multistage`.
- JIT-owned groups and policies are filtered out server-side, so they never appear on other dashboard pages. See [ADR 0002](./adr/0002-jit-owns-and-hides-netbird-objects.md) and [ADR 0005](./adr/0005-jit-in-management-server.md).

## Core mechanism

Grant = add the backing group to the user's `auto_groups`; revoke = remove it (`PUT /api/users/{id}`, read-merge-write, mirroring `src/contexts/GroupProvider.tsx`). This propagates to the user's existing connected peers within seconds, no re-login — **gated by `Account.settings.groups_propagation_enabled`** (`src/interfaces/Account.ts:21`, default on). JWT/IdP group sync only reconciles JWT-issued memberships, so the API-issued backing group survives (`Group.issued`).

**Hard invariant:** JIT only ever mutates the single **API-issued** backing group. It must **never** create, modify, or change membership of `INTEGRATION` (IdP) or `JWT` groups. Those may be used *read-only* for eligibility/approver criteria.

## Behaviour decisions

- **JIT owns the group AND the NetBird policy.** Admins pick target resources in the JIT page; JIT provisions a dedicated, marker-tagged, **JIT-exclusive** API group + a NetBird policy, and **hides both** from all other dashboard pages and pickers server-side. See [ADR 0002](./adr/0002-jit-owns-and-hides-netbird-objects.md).
- **Eligibility:** per-policy list of user groups (any type incl. IdP/JWT, read-only) allowed to request; evaluated by intersecting the requester's `auto_groups`.
- **Clock:** `expires_at = approvalTime + requestedDuration`.
- **Request lifecycle:** pending Requests auto-deny after a TTL (default 24h); one in-flight Request per (user, policy); users can cancel a pending Request and end their own active Grant early; admins can revoke any Grant.
- **Extensions (renewals).** A user may request an **extension** of an active Grant; an approver approves it like any Request. Approval renews the window to `approvalTime + requestedDuration` (capped at the JIT policy's max), modelled as a new Grant that **supersedes** the prior one — membership is never dropped, so access is continuous. Renewable repeatedly (each renewal is approved). Admins/approvers can also extend an active Grant directly; a direct extend atomically claims the active Grant (`active → superseded`) before creating the renewal, so two concurrent extends can't both produce an active Grant, and a renewal that fails to apply removes access and retries (**fail-closed**) rather than leaving the prior Grant in place. There is **one undecided Request per (user, JIT policy)**: a second Request is blocked while one is pending/approved, but an extension Request is allowed while a Grant is active. See [ADR 0004](./adr/0004-grant-renewals-via-supersede.md).
- **Durability:** periodic reconcile makes each backing group's membership equal {active Grants}; expiry **fails closed**; a startup guard prevents accidental mass-removal on an empty/unmounted DB. See [ADR 0003](./adr/0003-reconcile-fail-closed-durability.md).
- **Notifications:** in-dashboard only (pending badge + Approvals queue) in v1.

## Backend (management server fork)

**Data model:** `jit_policies` (`backing_group_id`, `netbird_policy_id`, `target_resource_ids[]`, `traffic`, `max_duration_minutes`, `requestable_by`, `approver_criteria`, `pending_ttl_minutes`, `enabled`, …); `jit_grants` (lifecycle row: `status` pending→approved→active→expired/denied/revoked/cancelled/failed/superseded, `expires_at`, timestamps, `last_error`); `jit_audit_log` (append-only).

**API** (`/api/jit`, bare JSON, OIDC bearer): `GET /healthz`; user `GET /jit/policies/eligible`, `POST /jit/requests`, `GET /jit/requests/mine`, `POST /jit/requests/:id/cancel`, `POST /jit/grants/:id/end`; admin `*/jit/policies[...]`, `GET /jit/requests?status=pending`, `POST /jit/requests/:id/approve|deny`, `GET /jit/grants/active`, `POST /jit/grants/:id/revoke`, `POST /jit/grants/:id/extend`.

**Auth:** the management server's native OIDC middleware; role resolved server-side from the NetBird account; fail closed on ambiguity. **Scheduler:** expire, auto-deny pending, reconcile, retry; crash-safe. **Security:** idempotent revoke that never fails open, rate limiting, audit log. Every Grant status change flows through a single grant-lifecycle transition (legal-edge table + atomic compare-and-set + derived audit).

## Frontend (new isolated files)

`src/app/(dashboard)/jit/{layout,page,request,policies,approvals}`; `src/modules/jit/**` (`JitProvider`, `useJitApi` + read hooks, modals, tables, `interfaces/Jit.ts`); `src/cloud/jit/JitNavigation.tsx`. Backend client wraps `useFetchApi`/`useApiCall` targeting `/api/jit/...` (same origin, same API layer as all other dashboard calls). Admin pages gated on `isOwnerOrAdmin`; request page open to authenticated users. Reuses dashboard primitives (`SelectDropdown`, `PeerGroupSelector`, `DataTable`, `useExpirationState`/`convertToSeconds`, `UserNameCell`).

## Minimal upstream touches (additive)

1. `src/layouts/Navigation.tsx` — +2 lines (`<JitNavigation/>`).

Everything else is new isolated files. No `api.tsx`/config edits (same-origin relative base). JIT objects are hidden server-side; no client-side SWR filter is needed.

## Verification

Backend unit/integration (provisioning, grant state machine, injected-clock expiry, pending auto-deny, reconcile incl. empty-DB guard, JWT/identity, fail-closed, NetBird stub). Local stack (`docker compose -f local-stack/docker-compose.yml up -d`): create JIT policy (verify group+policy absent from dashboard pages/pickers) → request → approve → resource reachable within seconds → auto-removed at 1-min expiry → revoke/end-early → propagation-off approve fails → stray member reconciled away. Frontend typecheck + Node-20 build.

## Risks / edge cases

Propagation setting off (guarded); never touch IdP/JWT groups (API-only invariant + guards); lost/empty DB (reconcile fail-closed + startup guard + backups); drift (reconcile); revoke never fails open (retry until confirmed); marker-based hiding is name-dependent (JIT owns the names); JIT-policy delete cascades (revoke → delete policy → delete group); `PUT /api/users` sends the full object (preserve `role`/`is_blocked`).
