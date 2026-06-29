import useFetchApi, { useApiCall } from "@utils/api";
import type { ErrorResponse } from "@utils/api";
import { JIT_SWR_KEY } from "../misc/constants";

/** JIT error shape: native NetBird API returns {code, message} like the rest of /api. */
export type JitError = { code: number | string; message: string };

/**
 * Normalise whatever is thrown into a JitError.
 * Native API errors are already {code: number, message: string} (ErrorResponse).
 * Network failures or unparseable bodies fall back to a generic message.
 */
const normalize = (x: unknown): JitError => {
  const e = x as Partial<ErrorResponse>;
  return {
    code: e?.code ?? "error",
    message: e?.message ?? "Request failed",
  };
};

/** SWR read against the native /api/jit/... paths. Returns the bare response body. */
export function useJitFetch<T>(path: string, allowFetch = true, refreshInterval?: number) {
  const res = useFetchApi<T>(path, true, true, allowFetch, {
    key: JIT_SWR_KEY,
    refreshInterval,
  });
  return {
    data: res.data,
    isLoading: res.isLoading,
    error: res.error,
    mutate: res.mutate,
  };
}

/** Mutations against the native /api/jit/... paths. Resolves to the bare body or rejects with JitError. */
export function useJitCall<T>(path: string) {
  const call = useApiCall<T>(path, true);
  const wrap = (p: Promise<T>): Promise<T> =>
    p.catch((err) => Promise.reject(normalize(err)));
  return {
    post: (data: unknown, suffix = "") => wrap(call.post(data, suffix)),
    put: (data: unknown, suffix = "") => wrap(call.put(data, suffix)),
    del: (suffix = "") => wrap(call.del({}, suffix)),
    get: (suffix = "") => wrap(call.get(suffix)),
  };
}
