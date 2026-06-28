# jit-service

Companion backend for the NetBird dashboard **Just-in-Time access** fork. It holds a NetBird service token, provisions/owns the marker-tagged backing group + access policy for each JIT policy, stores requests/grants/audit in SQLite, and runs a scheduler that reliably revokes access at expiry. Fully isolated from upstream — see [`../docs/jit-access.md`](../docs/jit-access.md) and the ADRs in [`../docs/adr/`](../docs/adr/).

## Run

```bash
npm install
cp .env.example .env   # fill in the values below
npm run dev            # tsx watch
npm test               # vitest
npm run typecheck      # tsc --noEmit
```

## Configuration

| Env | Required | Notes |
| --- | --- | --- |
| `NETBIRD_MGMT_API_ENDPOINT` | yes | Same value the dashboard uses; calls hit `<endpoint>/api`. |
| `NETBIRD_SERVICE_TOKEN` / `_FILE` | yes (one) | Admin-role service-user PAT. Prefer the `_FILE` (Docker secret) form. |
| `AUTH_AUTHORITY`, `AUTH_AUDIENCE` | yes | Same OIDC values as the dashboard (used to verify forwarded tokens). |
| `JIT_DB_PATH` | no | Default `/data/jit.db` (mount a persistent, backed-up volume). |
| `JIT_GROUP_MARKER` | no | Name prefix for JIT-owned groups/policies (default `jit:`). Must match the dashboard filter. |
| `JIT_ALLOWED_ORIGINS` | no | CSV of CORS origins; empty when served same-origin. |
| `JIT_SWEEP_INTERVAL_SEC`, `JIT_PENDING_TTL_MINUTES`, `JIT_GRANT_RETENTION_DAYS`, `JIT_RECONCILE_ENABLED` | no | Scheduler/retention tuning. |

## Prerequisites & deploy

- **Account setting `groups_propagation_enabled` must be ON** (default). The service warns at startup if off, and **refuses to approve** while off (grants wouldn't reach peers).
- The service token is effectively account-admin (NetBird PATs inherit the service user's role) — **network-isolate the container** and keep the token a secret.
- **Same-origin (recommended):** front the dashboard and this service with one proxy (see `deploy/proxy.conf` and the root `docker-compose.yml`) so the browser calls `/jit-api/*` within CSP `connect-src 'self'` — no CSP/CORS changes, no upstream edits.
- **Separate origin (alternative):** host this service on its own domain, set `JIT_ALLOWED_ORIGINS`, and add the origin to the dashboard CSP via the existing `NETBIRD_CSP` env (no code edit).

## API (`/jit-api/v1`)

Envelope: `{ success, data?, error?, meta? }`. Bearer (the caller's OIDC token) required except `/healthz`.

- `GET /healthz`, `GET /v1/me`
- User: `GET /v1/policies/eligible`, `POST /v1/requests`, `GET /v1/requests/mine`, `POST /v1/requests/:id/cancel`, `POST /v1/grants/:id/end`
- Admin: `… /v1/admin/policies[...]`, `GET /v1/admin/requests`, `POST /v1/admin/requests/:id/{approve,deny}`, `GET /v1/admin/grants/active`, `POST /v1/admin/grants/:id/revoke`, `GET /v1/admin/audit`
