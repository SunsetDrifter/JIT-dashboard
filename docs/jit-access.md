# Just-in-Time (JIT) Access — Design

> Status: **Accepted** · Fork-only feature (isolated from upstream `netbirdio/dashboard`).
> Glossary lives in [`/CONTEXT.md`](../CONTEXT.md); key decisions in [`docs/adr/`](./adr/).

## Summary

Admins define **JIT policies** that let eligible users request **temporary, approved** access to specific NetBird network resources. An approved **Request** becomes a time-boxed **Grant**: the user is added to a JIT-owned backing group (which carries an access policy to the resources) and is automatically removed at expiry.

- Self-service request → **admin approval** → auto-expiry. Approval is always required in v1.
- **Reliable** revocation, enforced server-side even when nobody is logged in.
- Scope: the dashboard + a small companion backend. Not the NetBird client/agent. Single NetBird account.

## Why a companion backend

The dashboard is a **static export** (`next.config.js` → `output: "export"`, served by Nginx; no API routes/server). And every browser→NetBird call uses the *logged-in user's* OIDC token — a regular user lacks `users.update`/`groups.update`, so cannot add themselves to a group. Reliable expiry needs a scheduler; self-service needs privileged mutations. Both require a server component holding a NetBird **service token**. See [ADR 0001](./adr/0001-companion-backend-for-jit.md).

## Core mechanism

Grant = add the backing group to the user's `auto_groups`; revoke = remove it (`PUT /api/users/{id}`, read-merge-write, mirroring `src/contexts/GroupProvider.tsx`). This propagates to the user's existing connected peers within seconds, no re-login — **gated by `Account.settings.groups_propagation_enabled`** (`src/interfaces/Account.ts:21`, default on). JWT/IdP group sync only reconciles JWT-issued memberships, so the API-issued backing group survives (`Group.issued`).

**Hard invariant:** JIT only ever mutates the single **API-issued** backing group. It must **never** create, modify, or change membership of `INTEGRATION` (IdP) or `JWT` groups. Those may be used *read-only* for eligibility/approver criteria.

## Architecture

```
Browser (dashboard, static)              Companion backend (jit-service, new)        NetBird Mgmt API
  /jit/request   (user)  ── bearer ─▶    POST /jit-api/v1/requests                    (service token)
  /jit/policies  (admin) ── bearer ─▶    JIT-policy CRUD → provisions group+policy ─▶  POST /api/groups,/api/policies
  /jit/approvals (admin) ── bearer ─▶    approve / deny / revoke ──┐
                                          scheduler: expire + auto-deny + reconcile ─┼─▶ PUT /api/users/{id} (auto_groups)
                                          SQLite (policies, grants, audit) ◀─────────┘
DashboardLayout <SWRConfig use:[jitFilter]> ─ strips marker-tagged /groups & /policies from every other page
```

- Deployed **same-origin** behind Nginx (`location /jit-api/`); browser uses a **relative** base → CSP `connect-src 'self'`, no CSP/CORS edits, no backend-URL config plumbing.
- Browser→backend reuses the existing API layer with `{ origin }` (precedent: `src/cloud/cloud-hooks/useAuthService.ts`) — `src/utils/api.tsx` untouched.
- Stack: Node 20 + TS + Fastify + better-sqlite3 + jose + zod + pino. Own Docker image; root `docker-compose.yml` (dashboard + jit-service + volume).

## Behaviour decisions

- **JIT owns the group AND the NetBird policy.** Admins pick target resources in the JIT page; JIT provisions a dedicated, marker-tagged, **JIT-exclusive** API group + a NetBird policy, and **hides both** from all other dashboard pages via one SWR middleware. See [ADR 0002](./adr/0002-jit-owns-and-hides-netbird-objects.md).
- **Eligibility:** per-policy list of user groups (any type incl. IdP/JWT, read-only) allowed to request; evaluated by intersecting the requester's `auto_groups`.
- **Clock:** `expires_at = approvalTime + requestedDuration`.
- **Request lifecycle:** pending Requests auto-deny after a TTL (default 24h); one in-flight Request per (user, policy); no extend (re-request); users can cancel a pending Request and end their own active Grant early; admins can revoke any Grant.
- **Durability:** periodic reconcile makes each backing group's membership equal {active Grants}; expiry **fails closed**; a startup guard prevents accidental mass-removal on an empty/unmounted DB. See [ADR 0003](./adr/0003-reconcile-fail-closed-durability.md).
- **Notifications:** in-dashboard only (pending badge + Approvals queue) in v1.

## Backend (`jit-service/`)

**Data model (SQLite, WAL):** `jit_policies` (`backing_group_id`, `netbird_policy_id`, `target_resource_ids[]`, `traffic`, `max_duration_minutes`, `requestable_by`, `approver_criteria`, `pending_ttl_minutes`, `enabled`, …); `jit_grants` (lifecycle row: `status` pending→approved→active→expired/denied/revoked/cancelled/failed, `expires_at`, timestamps, `last_error`); `jit_audit_log` (append-only).

**API** (`/jit-api/v1`, envelope `{success,data?,error?,meta?}`, bearer except `/healthz`): `GET /healthz`, `GET /me`; user `GET /policies/eligible`, `POST /requests`, `GET /requests/mine`, `POST /requests/:id/cancel`, `POST /grants/:id/end`; admin `*/admin/policies[...]`, `GET /admin/requests`, `POST /admin/requests/:id/approve|deny`, `GET /admin/grants/active`, `POST /admin/grants/:id/revoke`, `GET /admin/audit`.

**Auth:** verify forwarded OIDC JWT (`jose`, issuer/audience = dashboard's `AUTH_AUTHORITY`/`AUTH_AUDIENCE`); resolve NetBird user+role via the service token (role from NetBird, never the JWT); fail closed on ambiguity. **Scheduler:** expire, auto-deny pending, reconcile, retry; crash-safe (state in SQLite). **Security:** service-token secret validated at startup (capability probe), per-user async mutex, idempotent revoke that never fails open, rate limiting, audit log.

## Frontend (new isolated files)

`src/app/(dashboard)/jit/{layout,page,request,policies,approvals}`; `src/modules/jit/**` (`JitProvider`, `useJitApi` + read hooks, modals, tables, `interfaces/Jit.ts` + zod, `misc/jitGroupFilter`); `src/cloud/jit/JitNavigation.tsx`. Backend client wraps `useFetchApi`/`useApiCall` with `{ origin: "/jit-api/v1", key: "jit" }`. Admin pages gated on `isOwnerOrAdmin`; request page open to authenticated users. Reuses `ReverseProxiesProvider`, `setup-keys/*`, `PeerGroupSelector`, the `reverse-proxy/services` page shell.

## Minimal upstream touches (additive)

1. `src/layouts/Navigation.tsx` — +2 lines (`<JitNavigation/>`).
2. `src/layouts/DashboardLayout.tsx` — wrap subtree in `<SWRConfig value={{ use:[jitGroupFilter] }}>` (~3 lines).
3. `docker/default.conf` — `location /jit-api/` reverse-proxy.
4. New root `docker-compose.yml`.

Everything else is new isolated files. No `api.tsx`/config edits (same-origin relative base).

## Verification

Backend unit/integration (provisioning, grant state machine, injected-clock expiry, pending auto-deny, reconcile incl. empty-DB guard, JWT/identity, fail-closed, NetBird stub). Manual dev `docker-compose up`: create JIT policy (verify group+policy exist in NetBird API but absent from dashboard pages/pickers) → request → approve → resource reachable within seconds → auto-removed at 1-min expiry → revoke/end-early → propagation-off approve fails → stray member reconciled away. Frontend unit + provider integration + Playwright E2E. 80%+ coverage.

## Risks / edge cases

Propagation setting off (guarded); never touch IdP/JWT groups (API-only invariant + guards); lost/empty DB (reconcile fail-closed + startup guard + backups); drift (reconcile); revoke never fails open (retry until confirmed); marker-based hiding is name-dependent (JIT owns the names); service token is effectively admin (network-isolate); JIT-policy delete cascades (revoke → delete policy → delete group); `PUT /api/users` sends the full object (preserve `role`/`is_blocked`).
