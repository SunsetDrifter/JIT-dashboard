// SWR cache-key namespace so JIT requests never collide with NetBird API caches.
export const JIT_SWR_KEY = "jit";

// Must match the backend's JIT_GROUP_MARKER. JIT-owned groups/policies are named
// with this prefix; the SWR filter hides them from every other dashboard page.
export const JIT_GROUP_MARKER = "jit:";
