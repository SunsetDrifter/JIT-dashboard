# JIT end-to-end tests

Purpose-built Playwright tests for the Just-in-Time access feature. They drive
the **real** UI → `jit-service` → NetBird, so they need the local JIT stack
running (they are intentionally **not** part of the upstream `e2e/` suite, which
targets a Zitadel env on `:1337`).

## Prerequisites

1. **Local NetBird stack up** (dashboard + OSS server + nginx):
   ```bash
   cd jit-service/local-netbird && docker compose up -d
   ```
   The dashboard is then served at `http://localhost`.

2. **`jit-service` running as a host process on :8090** (nginx proxies
   `/jit-api/` → `host.docker.internal:8090`). Self-approval must be on so a
   single admin login can both request and approve:
   ```bash
   cd jit-service
   NETBIRD_MGMT_API_ENDPOINT=http://localhost \
   NETBIRD_SERVICE_TOKEN=<admin-PAT> \
   AUTH_AUTHORITY=http://localhost/oauth2 \
   AUTH_AUDIENCE=netbird-dashboard \
   JIT_LISTEN_PORT=8090 \
   JIT_ALLOW_SELF_APPROVAL=true \
   npm start
   ```

3. **A network resource** the policies can target. The tests select one whose
   name matches `/jit-test-res/` — adjust the `RESOURCE` constant in the specs if
   yours differs.

4. **Playwright browser**: `npx playwright install chromium`.

## Running

Credentials come from the environment (never commit them):

```bash
JIT_E2E_USER='you@example.com' \
JIT_E2E_PASSWORD='••••••••' \
npx playwright test --config=e2e/jit/jit.config.ts
```

Optional: `JIT_E2E_BASE_URL` (defaults to `http://localhost`).

Report: `npx playwright show-report e2e/jit/report`.

## What's covered

- `jit-lifecycle.spec.ts` — create policy → request → approve → active grant →
  revoke → delete policy (the full happy path).
- `jit-policies.spec.ts` — create-form validation, creation + summary, search
  filtering, editing the max duration, deletion.

The `setup` project logs in once and saves the session to `.auth/` (gitignored).
