import useFetchApi, { useApiCall } from "@utils/api";
import { JIT_API_BASE, JIT_SWR_KEY } from "../misc/constants";

type Envelope<T> =
  | { success: true; data: T; meta?: unknown }
  | { success: false; error: { code: string; message: string } };

/** JIT error codes are strings (the dashboard's ErrorResponse.code is a number). */
export type JitError = { code: string; message: string };

const normalize = (x: unknown): JitError => {
  const e = x as { error?: { code?: string; message?: string }; code?: string; message?: string };
  return {
    code: e?.error?.code ?? e?.code ?? "error",
    message: e?.error?.message ?? e?.message ?? "Request failed",
  };
};

/** SWR read against the JIT backend; unwraps the envelope to the inner data. */
export function useJitFetch<T>(path: string, allowFetch = true, refreshInterval?: number) {
  const res = useFetchApi<Envelope<T>>(path, true, true, allowFetch, {
    origin: JIT_API_BASE,
    key: JIT_SWR_KEY,
    refreshInterval,
  });
  const env = res.data;
  return {
    data: (env && env.success ? env.data : undefined) as T | undefined,
    isLoading: res.isLoading,
    error: res.error,
    mutate: res.mutate,
  };
}

/** Mutations against the JIT backend; resolves to inner data, rejects with a clean ErrorResponse. */
export function useJitCall<T>(path: string) {
  const call = useApiCall<Envelope<T>>(path, true, { origin: JIT_API_BASE });
  const unwrap = (p: Promise<Envelope<T>>): Promise<T> =>
    p
      .then((env) => {
        if (env && env.success) return env.data;
        throw normalize(env);
      })
      .catch((err) => Promise.reject(normalize(err)));
  return {
    post: (data: unknown, suffix = "") => unwrap(call.post(data, suffix)),
    put: (data: unknown, suffix = "") => unwrap(call.put(data, suffix)),
    del: (suffix = "") => unwrap(call.del({}, suffix)),
    get: (suffix = "") => unwrap(call.get(suffix)),
  };
}
