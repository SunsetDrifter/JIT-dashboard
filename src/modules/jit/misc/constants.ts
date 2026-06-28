// Base URL of the JIT companion backend, served same-origin behind Nginx at
// /jit-api/ (proxy strips the prefix). Reusing the dashboard API layer with
// { origin } makes calls hit `${origin}${path}` with the OIDC bearer attached.
export const JIT_API_BASE = "/jit-api/v1";

// SWR cache-key namespace so JIT requests never collide with NetBird API caches.
export const JIT_SWR_KEY = "jit";

// Must match the backend's JIT_GROUP_MARKER. JIT-owned groups/policies are named
// with this prefix; the SWR filter hides them from every other dashboard page.
export const JIT_GROUP_MARKER = "jit:";
