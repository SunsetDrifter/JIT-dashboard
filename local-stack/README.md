# Local stack

HTTP-only NetBird JIT fork for local development and testing. Runs the fork's
combined management server (`jit-netbird-server:local`), the JIT-enabled
dashboard (`jit-dashboard:local`), and nginx on port 80.

## Build and run

**1. Build the combined management server** (in the `netbird-JIT` repo):

```bash
docker build -f combined/Dockerfile.multistage -t jit-netbird-server:local .
```

**2. Build the dashboard** (Node 20 required — Node 24 breaks the client-side router):

```bash
# From the JIT-dashboard repo root:
docker run --rm -v "$PWD":/app -v /app/node_modules -w /app \
  -e APP_ENV=production node:20-bookworm bash -lc "npm ci && npm run build"
docker build -f docker/Dockerfile -t jit-dashboard:local .
```

**3. Start the stack:**

```bash
docker compose -f local-stack/docker-compose.yml up -d
```

**4. Browse to** http://localhost

## Notes

- SQLite data is stored in the `nb_data` Docker volume.
- JIT endpoints are served under `/api/jit/` by the combined management server
  (same origin as `/api/` — no separate proxy or sidecar needed).
- To pick up dashboard source changes: rebuild the dashboard image (step 2) then
  `docker compose -f local-stack/docker-compose.yml up -d --force-recreate dashboard nginx`.
