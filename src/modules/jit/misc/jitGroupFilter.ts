import { useMemo } from "react";
import type { Middleware } from "swr";
import { JIT_GROUP_MARKER } from "./constants";

const isJitNamed = (item: unknown): boolean => {
  const name = (item as { name?: string } | null)?.name;
  return typeof name === "string" && name.startsWith(JIT_GROUP_MARKER);
};

// Shared NetBird collections we strip JIT-owned objects from. Keep this list and
// these exact keys in sync with the dashboard hooks that fetch groups/policies —
// if a call site uses a different key shape, hiding silently stops working.
const HIDDEN_COLLECTIONS = ["/groups", "/policies"];

// Normalize an SWR key to its path: keys are either the bare string path or an
// array whose first element is the path. Strip any query string so variants like
// `/groups?param=1` still match.
const keyPath = (key: unknown): string | undefined => {
  const raw = typeof key === "string" ? key : Array.isArray(key) ? key[0] : undefined;
  return typeof raw === "string" ? raw.split("?")[0] : undefined;
};

/**
 * Global SWR middleware that strips JIT-owned (marker-named) groups and
 * policies from the shared `/groups` and `/policies` responses, so they never
 * appear on the dashboard's normal pages or pickers. JIT pages read their own
 * objects from the JIT backend, so they are unaffected.
 *
 * The filtered array is memoized on the source data so its reference stays
 * stable across renders. Returning a fresh `.filter()` result every render
 * destabilizes the app-wide SWR context and breaks React's client-side
 * navigation transitions (they never commit).
 */
export const jitGroupFilter: Middleware = (useSWRNext) => (key, fetcher, config) => {
  const swr = useSWRNext(key, fetcher, config);
  const shouldFilter = HIDDEN_COLLECTIONS.includes(keyPath(key) ?? "");
  const data = swr.data;

  const filtered = useMemo(() => {
    if (shouldFilter && Array.isArray(data)) {
      return (data as unknown[]).filter((item) => !isJitNamed(item));
    }
    return data;
  }, [shouldFilter, data]);

  return filtered === data ? swr : ({ ...swr, data: filtered } as typeof swr);
};
