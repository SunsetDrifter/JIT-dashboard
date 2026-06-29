# JIT lives in the management server

Supersedes [0001](0001-companion-backend-for-jit.md).

## Context

[ADR 0001](0001-companion-backend-for-jit.md) introduced a companion backend (`jit-service/`, Node/TS/Fastify/SQLite) because the original fork was a static-export dashboard with no server component. That was the right call at the time: the static dashboard cannot hold a service token, schedule expiry, or perform privileged group mutations, and a sidecar was the fastest path to a working system.

The constraint no longer holds. JIT is now implemented as a module inside the NetBird management server fork (`SunsetDrifter/netbird-JIT`). The management server already has:

- the account store and OIDC authentication middleware that JIT needs,
- a scheduler runtime,
- the `PUT /api/users/{id}` and group/policy APIs that JIT calls (now callable in-process),
- a combined build target (`combined/Dockerfile.multistage`) that produces a single container image (management + embedded Dex IdP + signal + relay).

Keeping the sidecar alongside this would mean two separate runtimes, two sets of secrets to manage, a Nginx proxy block (`/jit-api/`) to maintain, and a Node 22+ host process that cannot share the management server's in-process state. None of that overhead is justified when the same functionality is available in-process.

## Decision

Re-platform JIT into the management server fork and retire the companion backend.

- JIT endpoints are served natively at `/api/jit/...` using the management server's existing OIDC middleware.
- The browser calls `/api/jit/...` with the same origin and bearer token as all other `/api/` calls — no CSP/CORS changes, no `/jit-api/` proxy block.
- JIT-owned groups and policies are filtered out of `/api/groups` and `/api/policies` responses **server-side**, removing the need for the client-side SWR middleware (`jitGroupFilter`) and the `DashboardLayout` edit.
- The local demo stack is updated (`local-stack/`) to use the combined management server image (`jit-netbird-server:local`) and the dashboard image, with no host-process sidecar.
- The `jit-service/` directory is deleted; the root sidecar `docker-compose.yml` is removed.

## Consequences

- **One combined image.** The management server fork builds a single container that includes JIT, so there is nothing extra to deploy.
- **Upstream edits shrink from two to one.** The `DashboardLayout.tsx` `<SWRConfig>` edit is reverted; only `Navigation.tsx` (the `<JitNavigation/>` mount) remains as a sanctioned upstream touch.
- **The dashboard JIT module calls `/api/jit/...`** using the same `useFetchApi`/`useApiCall` layer as all other dashboard API calls. No custom origin or envelope stripping is needed.
- **Server-side hiding replaces client-side filtering.** The marker-tagged backing groups and policies are never returned by the API, so no SWR middleware is needed and the hiding is not bypassable from the browser.
- **The sidecar's standalone test suite (`vitest`) is gone.** Backend logic tests live in the management server fork. Frontend verification remains `tsc --noEmit` + Node-20 `npm run build`.
- **Historical ADR 0001 is preserved** as a record of the original decision and the reasoning that applied at the time.
