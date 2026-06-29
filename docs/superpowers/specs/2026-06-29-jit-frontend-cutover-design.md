# JIT frontend cutover + demoable in-server stack — design

## Context & goal

The JIT backend now lives in-process in the management-server fork (`SunsetDrifter/netbird-JIT`, PR #1), exposing `/api/jit/...` (bare JSON, the dashboard's normal OIDC bearer). This sub-project **retires the `jit-service` sidecar** and re-points the dashboard's JIT module at the native API, then stands the whole thing up locally so a **prototype demo video** can be recorded. The sidecar is being deleted outright — no need to keep it runnable.

Work lands on branch `feat/jit-frontend-cutover` in `JIT-dashboard`. Frontend stays as isolated as before (`src/modules/jit/**`, `src/app/(dashboard)/jit/**`, `src/cloud/jit/**`); upstream edits shrink from two to one (the `<SWRConfig>` edit is reverted; the `Navigation.tsx` mount stays).

## 1. Demo stack (headline deliverable)

The fork builds the **same combined `netbird-server` CE image** via `combined/Dockerfile.multistage` — management (with JIT wired into startup) + **embedded Dex IdP** + signal + relay in one container. So the demo stack is the current local stack with the image swapped.

- Build once (in `netbird-JIT`): `docker build -f combined/Dockerfile.multistage -t jit-netbird-server:local .`
- **Relocate** the local stack out of the dying sidecar dir → new top-level **`local-stack/`** (`docker-compose.yml`, `nginx.conf`, `config.yaml`, `dashboard.env`), changed minimally from `jit-service/local-netbird/`:
  - `image: netbirdio/netbird-server:latest` → `jit-netbird-server:local`
  - remove the `/jit-api/` nginx `location` block and the host-process sidecar entirely
  - keep embedded-IdP routing (`/api`, `/oauth2`, `/relay`, `/ws-proxy/` → the server), dashboard catch-all
- JIT is served natively at `/api/jit`. Embedded IdP login works; a real netbird peer can be connected to show access toggling if desired.

## 2. Frontend cutover (`src/modules/jit/**`)

**API layer** — `useJitApi.ts` + `misc/constants.ts`: call the dashboard's native API base with `/jit/...` paths (drop the custom `/jit-api/v1` origin), **remove the `{success,data,error}` envelope** (success = bare JSON returned directly), and rewrite `normalize()` for the native error shape (bare `{message, code}` + HTTP status).

**Endpoint remap** (old sidecar `/jit-api/v1/X` → new native `/api/jit/Y`), in `JitProvider.tsx`:

| Old | New |
|---|---|
| `GET /me` | **removed** → identity/role from native `useLoggedInUser`; `propagationEnabled` from `/api/accounts` `[0].settings.groups_propagation_enabled` |
| `GET /policies/eligible` | `GET /jit/policies/eligible` |
| `GET /requests/mine` | `GET /jit/requests/mine` |
| `POST /requests` · `/requests/:id/cancel` | `POST /jit/requests` · `/jit/requests/:id/cancel` |
| `POST /grants/:id/end` | `POST /jit/grants/:id/end` |
| `GET/POST /admin/policies` · `PUT/DELETE /admin/policies/:id` | `…/jit/policies` · `/jit/policies/:id` |
| `GET /admin/network-resources` | **removed** → native `/api/networks/resources` |
| `GET /admin/requests?status=pending` | `GET /jit/requests?status=pending` |
| `POST /admin/requests/:id/{approve,deny}` | `POST /jit/requests/:id/{approve,deny}` |
| `GET /admin/grants/active` | `GET /jit/grants/active` |
| `POST /admin/grants/:id/{revoke,extend}` | `POST /jit/grants/:id/{revoke,extend}` |

**Other module changes:**
- `JitPolicyModal.tsx` resource picker → native resources (dashboard `useFetchApi("/networks/resources")` / `NetworkProvider`), not the dropped JIT endpoint. Map the native `NetworkResource` shape to the picker.
- `interfaces/Jit.ts` → align with the backend's generated API shapes (camelCase, already matched). Drop `JitMe`; replace `JitNetworkResource` with the native resource type. Grant `policyName` is resolved client-side (from the policies the provider holds) since the backend omits it.
- `policies/page.tsx` (and any page reading `propagationEnabled`/identity) → read from the native sources above.
- **Remove** `src/modules/jit/misc/jitGroupFilter.ts` and its `<SWRConfig>` wiring in `src/layouts/DashboardLayout.tsx` (server hides JIT-owned groups/policies now). Keep the `Navigation.tsx` mount.

**Verify:** `npx tsc --noEmit` + a **Node-20** `npm run build`.

## 3. Delete the sidecar

After relocating the local stack: remove `jit-service/**` (src, test, deploy, local-netbird, Dockerfile, etc.), the root sidecar `docker-compose.yml`, and `jit-service/deploy/proxy.conf`. Drop any sidecar references in `package.json`/CI if present (CI already builds only the dashboard image).

## 4. Docs

Update to the in-server architecture: `CLAUDE.md` (commands + architecture: no sidecar; build the fork image; the new `local-stack/`), `docs/jit-access.md` (replace the companion-backend sections), add **ADR 0005** "JIT lives in the management server" superseding ADR 0001, and trim sidecar mentions in `/CONTEXT.md`. (`docs/just-in-time-access.md`, the earlier public-facing draft, gets its "companion service" passage corrected.)

## 5. Bring it up + make it demo-ready

Build the fork image + the cutover dashboard image, `compose up`, and walk: login (embedded IdP) → create a JIT policy → request as a user → approve as admin → grant active (backing group/policy hidden from Groups/Access-Control) → auto-expiry. Fix integration mismatches (auth audience, `/jit` mounting, `NETBIRD_MGMT_API_ENDPOINT`). Hand over a clean click-path/script to record. (Recording the video itself is the user's step.)

## Out of scope
- Recording the actual video (stack will be demo-ready).
- The deferred backend Minors (tracked on the backend branch/PR).
- Production deployment of the combined image (local demo only).

## Verification
- `tsc --noEmit` clean; Node-20 `npm run build` succeeds.
- Stack comes up; the full JIT flow works in the browser against the in-server backend; JIT objects absent from Groups/Access-Control pages.
- `grep -r jit-api` / `grep -r jit-service` shows no live references outside historical docs/ADRs.
