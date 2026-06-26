import { AppError, ErrorCodes } from "../lib/errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface NetbirdClientOptions {
  apiBase: string; // already suffixed with /api
  serviceToken: string;
  fetchImpl?: FetchLike;
  maxRetries?: number;
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Low-level NetBird Management API client. Attaches the service token,
 * retries transient failures (5xx / 429 / network) with backoff, and never
 * retries deterministic 4xx. Errors surface as AppError.
 */
export class NetbirdClient {
  private readonly apiBase: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(opts: NetbirdClientOptions) {
    this.apiBase = opts.apiBase;
    this.token = opts.serviceToken;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 200;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }
  del<T = void>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const url = this.apiBase + path;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        if (attempt <= this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw new AppError(
          ErrorCodes.NETBIRD_UNAVAILABLE,
          `NetBird ${method} ${path} failed: ${(err as Error).message}`,
          502,
        );
      }

      if (res.ok) return this.parseBody<T>(res);

      const retriable = res.status >= 500 || res.status === 429;
      if (retriable && attempt <= this.maxRetries) {
        await sleep(this.backoff(attempt));
        continue;
      }
      const detail = await this.errorDetail(res);
      if (res.status === 404) {
        throw new AppError(ErrorCodes.NOT_FOUND, `NetBird ${method} ${path}: ${detail}`, 404);
      }
      throw new AppError(
        ErrorCodes.NETBIRD_UNAVAILABLE,
        `NetBird ${method} ${path} failed (${res.status}): ${detail}`,
        502,
      );
    }
  }

  private backoff(attempt: number): number {
    const expo = this.baseDelayMs * 2 ** (attempt - 1);
    return expo + Math.floor(Math.random() * this.baseDelayMs);
  }

  private async parseBody<T>(res: Response): Promise<T> {
    const text = await res.text();
    return (text ? (JSON.parse(text) as T) : (undefined as T));
  }

  private async errorDetail(res: Response): Promise<string> {
    try {
      const text = await res.text();
      if (!text) return res.statusText || `status ${res.status}`;
      try {
        const json = JSON.parse(text) as { message?: string };
        return json.message ?? text;
      } catch {
        return text;
      }
    } catch {
      return res.statusText || `status ${res.status}`;
    }
  }
}
