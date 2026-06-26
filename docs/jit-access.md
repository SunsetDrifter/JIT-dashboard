# Just-in-Time (JIT) Access — Design

> Status: **Proposed** · Fork-only feature (isolated from upstream `netbirdio/dashboard`)

## Summary

JIT Access lets administrators define **just-in-time access policies** and lets end-users request **temporary** access to specific NetBird network resources. A request grants the user time-boxed membership of a **custom NetBird group** that already carries an access policy for the target resources; when the window ends, the membership is automatically removed.

- **Access model:** self-service request → **admin approval** → auto-expiry.
- **Revocation:** **reliable** — access ends at expiry even when no one is logged in.
- **Scope:** the dashboard and a small companion backend. Not the NetBird client/agent.
- **Isolation:** all logic in new files; the only upstream `src/` change is a 2-line navigation edit.

## Background & motivation

NetBird already models everything needed for the *access* itself:

- A **group** can be granted access to network resources via an **access policy**.
- A user joins a group by updating their `auto_groups` (`PUT /api/users/{id}`) — see `src/contexts/GroupProvider.tsx` (`addUserToGroup` / `removeUserFromGroup`, read-merge-write on the user object).

What NetBird does **not** provide is **time-boxed membership** or a **request/approval workflow**. And the dashboard cannot supply them on its own because:

1. **It is a static export.** `next.config.js` sets `output: "export"`; it is served by Nginx with no API routes or server actions. There is no server-side process to revoke access on a timer.
2. **End-users cannot self-grant.** Every dashboard→NetBird call uses the *logged-in user's* OIDC token. Adding a user to a group requires `users.update` + `groups.update` (admin-only); a regular user's token is rejected.

So JIT adds exactly the missing pieces — timed membership, a scheduler, and an approval workflow — in a small **companion backend**, while reusing NetBird for the access primitive and the existing dashboard for the UI.

## Architecture

```
Browser (dashboard, static)                 Companion backend (jit-service, new)       NetBird Mgmt API
  /jit/request   (end user)  ── bearer ─▶    POST /jit-api/v1/requests
  /jit/policies  (admin)     ── bearer ─▶    admin policy CRUD
  /jit/approvals (admin)     ── bearer ─▶    approve / deny / revoke ──┐
                                              scheduler sweep  ─────────┼─ service ─▶  PUT /api/users/{id}
                                              SQLite (policies,         │   token         (auto_groups +/-)
                                              grants, audit)  ◀─────────┘
```

- The **backing group + access policy → resources** is created by the admin in NetBird's existing UI. JIT manages only **timed membership** of that group, at **user level** (`auto_groups`).
- The backend is deployed **same-origin** behind the existing Nginx (`location /jit-api/`). The browser calls a **relative** URL, covered by CSP `connect-src 'self'` — no CSP or CORS changes.
- The browser reaches the backend through the **existing** dashboard API layer (`useFetchApi` / `useApiCall` with `{ origin }`), exactly as `src/cloud/cloud-hooks/useAuthService.ts` already calls a separate service. The OIDC bearer is attached automatically; `src/utils/api.tsx` is untouched.

### Technology

| Area | Choice |
|---|---|
| Backend runtime | Node 20 + TypeScript |
| HTTP framework | Fastify |
| Storage | SQLite (`better-sqlite3`, WAL) |
| JWT verification | `jose` (remote JWKS) |
| Validation | `zod` (every boundary) |
| Logging | `pino` (+ append-only audit log) |
| Scheduler | `setInterval` sweep (state in SQLite; crash-safe) |
| Deployment | Own Docker image; root `docker-compose.yml` runs dashboard + jit-service |

## Backend (`jit-service/`)

### Data model (SQLite)

- **`jit_policies`** — `id, name, description, backing_group_id, display_resource_ids[], max_duration_minutes, requestable_by {mode:'all'|'groups', groupIds[]}, requires_approval, approver_criteria {mode:'any_admin'|'groups', groupIds[]}, enabled, created_by, created_at, updated_at`.
- **`jit_grants`** (request + grant in one lifecycle row) — `id, policy_id, requester_user_id/email, requested_duration_minutes, justification, status, approver, denial_reason, revoke_reason, group_was_preexisting, requested_at, decided_at, activated_at, expires_at, revoked_at, last_error`.
- **`jit_audit_log`** (append-only) — `at, actor, action, grant_id/policy_id, detail`.

Status lifecycle: `pending → approved → active → expired`, plus `denied`, `revoked`, `failed`. `requires_approval=false` makes `pending → approved` immediate. Indexes: `(status, expires_at)`, `(requester_user_id, status)`.

### API (envelope `{ success, data?, error?, meta? }`; `/jit-api/v1`; bearer required except `/healthz`)

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/healthz` | — | liveness |
| GET | `/me` | any auth | `{ userId, email, role, isAdmin }` |
| GET | `/policies/eligible` | self | policies the caller may request |
| POST | `/requests` | self | create request (≤ max, eligible, no dup); rate-limited |
| GET | `/requests/mine` | self | caller's requests |
| POST | `/requests/:id/cancel` | self | cancel a pending request |
| ALL | `/admin/policies[...]` | admin | policy CRUD (DELETE cascade-revokes active grants) |
| GET | `/admin/requests` | admin/approver | all requests |
| POST | `/admin/requests/:id/approve` | admin/approver | approve + apply immediately (`expires_at = now + duration`) |
| POST | `/admin/requests/:id/deny` | admin/approver | deny |
| GET | `/admin/grants/active` | admin | active grants |
| POST | `/admin/grants/:id/revoke` | admin | force-revoke now |
| GET | `/admin/audit` | admin | audit log |

### AuthN / AuthZ

1. Dashboard forwards the user's **OIDC token** (`Authorization: Bearer`).
2. Backend **verifies the JWT** (`jose`) against the OIDC authority JWKS, checking `issuer = AUTH_AUTHORITY` and `audience = AUTH_AUDIENCE` (the dashboard's own values).
3. **Resolve the NetBird user + role** via the service token (`GET /api/users`, match by email, fallback `idp_id`/`sub`), short-TTL cached. **Role is read from NetBird, never from a JWT claim.**
4. Self endpoints act only on the caller's own id (never trust a body `userId`); admin endpoints require role ∈ {admin, owner} or membership in `approver_criteria`. **Fail closed** on ambiguous identity / unreachable JWKS.

### Membership logic (mirrors `GroupProvider`)

- **Grant:** fetch user fresh → record `group_was_preexisting` → if not preexisting, `PUT /api/users/{id}` with the full user object and `auto_groups` updated to include the backing group → set `active`, `expires_at`.
- **Revoke (manual or expiry):** fetch fresh → **skip removal if `group_was_preexisting`** (never strip standing access) → **skip if another active grant still needs the group** → else PUT with the id filtered out. Idempotent (group-already-absent = success).
- **Concurrency:** per-user async mutex serializes read-modify-write. Single-instance deployment assumed.

### Scheduler

A `setInterval` sweep (default 30 s): (1) **expire** grants past `expires_at`; (2) **retry** failed applies with bounded backoff. Re-entrancy guard prevents overlap. **Crash-safe** — state in SQLite; on restart, anything past `expires_at` is revoked on the first tick. Transient NetBird failures during expiry keep retrying until removal is confirmed — access is never left open silently.

### Security & ops

Service token from env/secret, **validated at startup** (capability probe), never logged. `zod` validation, rate limiting on `POST /requests`, `helmet`, audit log on every approve/deny/grant/revoke/expire, retention cleanup of terminal rows. Document a dedicated NetBird **service user (admin role)**; network-isolate the container (PATs inherit role).

### Layout

```
jit-service/{package.json,tsconfig.json,Dockerfile,.env.example}
jit-service/src/
  server.ts  config.ts
  db/{index,migrations, repositories/{policyRepo,grantRepo,auditRepo}}.ts
  auth/{jwt,identity,guards}.ts
  netbird/{client,users,groups,networks}.ts
  domain/{policyService,grantService,lifecycle}.ts
  scheduler/worker.ts
  routes/{health,me,userRequests,adminPolicies,adminRequests,adminGrants}.ts
  schemas/  lib/{envelope,errors,mutex,logger}.ts
  test/
```

## Frontend (dashboard)

### Routes (`src/app/(dashboard)/jit/`)

- `layout.tsx` mounts `<JitProvider>` once (new file; no upstream layout edit).
- `page.tsx` → redirect to `/jit/request`.
- `request/page.tsx` — **end-user** (all authenticated users): eligible policies + request modal (duration ≤ max + justification) + "My requests" with cancel.
- `policies/page.tsx` — **admin** (`isOwnerOrAdmin`): policies table + create/edit modal.
- `approvals/page.tsx` — **admin**: tabs — *Pending* (approve/deny) and *Active grants* (revoke).

### Module layout

`src/modules/jit/**` — `JitProvider.tsx`; `hooks/{useJitApi,useJitPolicies,useJitRequests,useJitGrants,useJitEligibility}.ts`; `config/jitConfig.ts`; `modals/{JitRequestModal,JitPolicyModal,JitDenyModal}.tsx`; `table/{JitPoliciesTable,JitRequestsTable,JitGrantsTable}.tsx` + `cells/*`; `interfaces/Jit.ts` (+ zod); `misc/{constants,JitDocsLink}.tsx`.
`src/cloud/jit/JitNavigation.tsx` — the navigation entry.

### Data layer

`useJitApi.ts` wraps the existing `useFetchApi`/`useApiCall` with `{ origin: jitBackendBaseUrl, key: "jit" }` (separate SWR cache; OIDC bearer auto-attached). Mutations use `notify({ promise, ... })` (Sonner) and revalidate via `mutate(["/path","jit"])`.

### Role gating

Admin pages wrapped in `<RestrictedAccess hasAccess={isOwnerOrAdmin}>` (`useLoggedInUser()` — there is no `permission.jit` module). The request page is open to all authenticated users with a data-driven empty state. Frontend gating is UX-only; the backend re-authorizes every call. *Known item:* `DashboardLayout` hides the sidebar for `isRestricted` users — v1 targets non-restricted users.

### Reuse map

| New | Copies / composes |
|---|---|
| `JitNavigation.tsx` | `src/cloud/distributor/DistributorNavigation.tsx`, `@components/SidebarItem` |
| `JitProvider.tsx` | `src/contexts/ReverseProxiesProvider.tsx` |
| `useJitApi.ts` | `src/cloud/cloud-hooks/useAuthService.ts`, `src/utils/api.tsx` |
| modals / tables / cells | `src/modules/setup-keys/*` (duration `Input` w/ `customPrefix`/`customSuffix`), `@components/PeerGroupSelector`, `@components/UserSelector` |
| `(dashboard)/jit/**/page.tsx` | `src/app/(dashboard)/reverse-proxy/services/page.tsx` |

## Minimal upstream touches (all additive)

1. `src/layouts/Navigation.tsx` — +2 lines (import + `<JitNavigation />`). *Only `src/` code edit.*
2. `docker/default.conf` — `location /jit-api/ { proxy_pass http://jit-service:8080/; }` (same-origin; avoids CSP/CORS).
3. New `docker-compose.yml` at repo root — dashboard + jit-service + shared volume.

Net upstream `src/` diff: **2 lines**. Everything else is new isolated files or additive deploy config, so upstream merges stay clean.

## Implementation phases (TDD throughout)

1. **Backend foundation** — scaffold, config + startup validation, SQLite + migrations + repositories.
2. **NetBird client + auth** — `netbirdFetch` (retry), `getUser`/`putUserGroups`; JWT verify + identity/role resolution + guards; `/healthz`, `/me`.
3. **Policy CRUD + request/grant lifecycle + scheduler** — full state machine, `group_was_preexisting` + overlapping-grant safety, per-user mutex, crash-safe sweep.
4. **Backend hardening + deploy** — helmet, rate-limit, CORS, audit, retention; Dockerfile, compose, Nginx block.
5. **Frontend client + provider** — `jitConfig`, `interfaces/Jit.ts` (+zod), `useJitApi`, `JitProvider` + read hooks.
6. **Admin Policies page**.
7. **Admin Approvals + Active grants**.
8. **End-user Request page**.
9. **Nav injection + polish + Playwright E2E** (create → request → approve → active → expiry/revoke; role-gating).

## Verification

- **Backend:** unit (repos, read-merge-write, JWT/identity, full grant state machine, **injected-clock expiry**, restart recovery) + integration vs a NetBird stub. Confirm exact required fields of `PUT /api/users/{id}` against a dev NetBird in phase 2.
- **Manual E2E (dev):** `docker-compose up`; admin creates a JIT policy → user requests → admin approves → user gains resource access → confirm **auto-removal at expiry** (1-min duration) and **manual revoke**; confirm a pre-existing member keeps the group after expiry.
- **Frontend:** unit + provider integration (mocked api) + Playwright E2E. Target 80%+ coverage.

## Risks / edge cases

OIDC `sub` ≠ NetBird user id (resolve by email; fail closed) · role is NetBird's, not the IdP's · `group_was_preexisting` must prevent stripping standing access · overlapping grants remove only on the last expiry · lost-update on `auto_groups` → per-user mutex + fresh read · revoke must never fail open (retry until confirmed) · service token is effectively admin (network-isolate) · policy deletion cascades to active grants.
