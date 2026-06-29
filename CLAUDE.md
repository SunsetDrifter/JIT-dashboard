# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A fork of **`netbirdio/dashboard`** (Next.js static-export UI for NetBird) that adds a **Just-in-Time (JIT) Access** feature. The JIT feature is why this fork exists — almost all work happens in it.

The dashboard is the upstream Next.js app (`output: "export"`, served by Nginx, **no server/API routes**). React + Tailwind + SWR; auth via OIDC (`@axa-fr/react-oidc`).

JIT is built into the management server. The companion backend (`jit-service/`) has been retired. JIT endpoints are served natively at `/api/jit/` by `SunsetDrifter/netbird-JIT` (a fork of the NetBird server), so the full local stack is one combined image plus the dashboard.

Read `/CONTEXT.md` (domain glossary) and `docs/jit-access.md` (full design) before non-trivial JIT work, and use the glossary terms exactly (JIT policy, Request, Grant, Extension, backing group, transition).

## Fork isolation (read this first)

To stay mergeable with upstream, **all JIT code lives in dedicated paths and upstream files are left alone**:

- JIT code: `src/modules/jit/**`, `src/app/(dashboard)/jit/**`, `src/cloud/jit/JitNavigation.tsx`, plus docs (`CONTEXT.md`, `docs/jit-access.md`, `docs/adr/*`) and the local stack under `local-stack/`.
- **Only one upstream source file is edited** (additive): `src/layouts/Navigation.tsx` (mounts `<JitNavigation/>`). Plus the Nginx config in `local-stack/` and a root `docker-compose.yml`.
- **Do not edit other upstream files.** JIT code freely *imports* upstream components/hooks (read-only reuse) — that's fine; editing them is not.

## Commands

### Dashboard (frontend, from repo root)
- `npm run dev` — Next dev server on :3000. Note: this does **not** proxy `/api/jit`, so JIT pages won't have a working backend here — use the local stack below for real JIT behavior.
- `npm run build` — static export to `out/`. **Must build under Node 20** for the deployed image: Node 24 produces a broken client-side router.
- `npm run lint` — `next lint`.
- `npx tsc --noEmit` — typecheck. **There is no frontend unit-test runner** (frontend `npm test` is Playwright E2E and needs a test env via `npm run test:setup`). Verify frontend/JIT UI changes with `tsc --noEmit` + a build.

### Local end-to-end stack

See `local-stack/README.md` for the full procedure. Summary:

**1. Build the combined management server** (in the `netbird-JIT` repo):
```bash
docker build -f combined/Dockerfile.multistage -t jit-netbird-server:local .
```

**2. Build the dashboard** (Node 20 required):
```bash
docker run --rm -v "$PWD":/app -v /app/node_modules -w /app \
  -e APP_ENV=production node:20-bookworm bash -lc "npm ci && npm run build"
docker build -f docker/Dockerfile -t jit-dashboard:local .
```

**3. Start the stack:**
```bash
docker compose -f local-stack/docker-compose.yml up -d
```

To pick up dashboard source changes: rebuild the dashboard image (step 2) then `docker compose -f local-stack/docker-compose.yml up -d --force-recreate dashboard nginx`.

## Architecture (the JIT feature)

**JIT in the management server.** JIT endpoints are served natively at `/api/jit/` by the management server fork (`SunsetDrifter/netbird-JIT`). The fork builds a combined image (management + embedded Dex IdP + signal + relay) via `combined/Dockerfile.multistage`. There is no separate sidecar or service to deploy.

**Core mechanism + hard invariant.** A Grant = adding a JIT-owned **backing group** to the user's `auto_groups` (`PUT /api/users/{id}`, read-merge-write — must send the *full* user object, preserving `role`/`is_blocked`); revoke = removing it. **JIT only ever mutates the single API-issued backing group; it must never create/modify/touch membership of IdP (`INTEGRATION`) or `JWT` groups** (those are read-only for eligibility/approver criteria). Propagation to peers is gated by `Account.settings.groups_propagation_enabled`.

**Grant lifecycle is a single seam.** Every status change (`pending → approved → active → expired/revoked/superseded`, plus `denied/cancelled/failed`) is governed by the management server's grant-lifecycle module, which holds the legal-edge table, performs an atomic compare-and-set, and derives the audit action from the edge. Don't mutate grant status anywhere else.

**Extensions = supersede.** Renewing an active Grant creates a *new* Grant that retires the prior one to `superseded` **without dropping the backing-group membership**, so access is continuous. Admin direct-extend atomically claims `active → superseded` before creating the renewal (no double-active), and a renewal that fails to apply removes access and retries (**fail-closed**).

**Durability.** A scheduler in the management server expires Grants, auto-denies stale pending Requests, **reconciles** each backing group's membership to exactly {users with an active Grant}, and retries failures. Expiry/revoke fail closed; a startup guard refuses mass-removal against an empty/unmigrated DB.

**Hidden objects.** JIT provisions a marker-tagged, JIT-exclusive group **and** a NetBird access policy per JIT policy. The management server strips those marker-tagged items from `/api/groups` and `/api/policies` responses server-side, so they never appear on other dashboard pages or pickers.

**Auth.** The management server uses its native OIDC middleware for `/api/jit` — the browser sends the same OIDC bearer token as for all other `/api/` calls. Role is resolved server-side from the NetBird account; fail closed on ambiguity.

**Frontend module.** Pages: `src/app/(dashboard)/jit/{request,policies,approvals}`. `src/modules/jit/JitProvider.tsx` is the single context holding all SWR read hooks + mutations; `src/modules/jit/hooks/useJitApi` wraps the dashboard's `useFetchApi`/`useApiCall` targeting `/api/jit/...` (same origin, same API layer). `src/modules/jit/interfaces/Jit.ts` mirrors the backend contract — keep in sync with the management server fork. Admin pages are gated on `isOwnerOrAdmin` (the backend re-authorizes regardless).

**Data model.** Stored in the management server's database (SQLite in local dev, Postgres in production). Tables: `jit_policies`, `jit_grants` (one lifecycle row each), `jit_audit_log` (append-only). Schema migrations are managed by the management server fork.

## Conventions & gotchas

- **Frontend build = Node 20** (see above).
- Reuse existing dashboard primitives for JIT UI (e.g. `SelectDropdown`, `PeerGroupSelector`, `DataTable`, `useExpirationState`/`convertToSeconds`, the Team-Users `UserNameCell`) rather than rebuilding them.
- **Git/PRs:** `origin` is the fork **`SunsetDrifter/JIT-dashboard`**; `upstream` is `netbirdio/dashboard`. `gh` resolves to **upstream** by default — always pin: `gh pr create --repo SunsetDrifter/JIT-dashboard --base main --head <branch> ...`. Never open a PR against upstream.

## Where to read more

- `/CONTEXT.md` — domain glossary (authoritative terminology).
- `docs/jit-access.md` — full JIT design.
- `local-stack/README.md` — local build and run instructions.
- `docs/adr/` — 0001 companion backend (superseded) · 0002 JIT owns & hides NetBird objects · 0003 reconcile/fail-closed durability · 0004 grant renewals via supersede · 0005 JIT in the management server.
