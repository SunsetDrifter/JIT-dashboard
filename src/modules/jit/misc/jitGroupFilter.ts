import type { Middleware } from "swr";
import { JIT_GROUP_MARKER } from "./constants";

const isJitNamed = (item: unknown): boolean => {
  const name = (item as { name?: string } | null)?.name;
  return typeof name === "string" && name.startsWith(JIT_GROUP_MARKER);
};

/**
 * Global SWR middleware that strips JIT-owned (marker-named) groups and
 * policies from the shared `/groups` and `/policies` responses, so they never
 * appear on the dashboard's normal pages or pickers. JIT pages read their own
 * objects from the JIT backend, so they are unaffected.
 */
export const jitGroupFilter: Middleware = (useSWRNext) => (key, fetcher, config) => {
  const url = typeof key === "string" ? key : Array.isArray(key) ? key[0] : undefined;
  const swr = useSWRNext(key, fetcher, config);

  if ((url === "/groups" || url === "/policies") && Array.isArray(swr.data)) {
    return {
      ...swr,
      data: (swr.data as unknown[]).filter((item) => !isJitNamed(item)),
    } as typeof swr;
  }
  return swr;
};
