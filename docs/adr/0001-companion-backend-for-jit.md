# Companion backend service for JIT access

The dashboard is a static export (`output: "export"`) with no server, and all NetBird calls use the logged-in user's OIDC token (a regular user lacks `users.update`/`groups.update`). Reliable time-based revocation needs a scheduler, and self-service grants need privileged group mutations — neither is possible in a static SPA — so JIT is implemented as a small, isolated companion backend (`jit-service/`, Node/TS/Fastify/SQLite) that holds a NetBird service token and runs the expiry scheduler.

## Consequences

- A new deployable accompanies the dashboard (own image + root `docker-compose.yml`), served same-origin behind Nginx at `/jit-api/` so the browser stays within CSP `connect-src 'self'`.
- The service token is effectively account-admin; the container must be network-isolated and the token kept as a validated secret.
