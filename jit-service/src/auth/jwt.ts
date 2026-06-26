import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError, ErrorCodes } from "../lib/errors.js";

export interface VerifiedClaims {
  sub: string;
  email?: string;
  raw: JWTPayload;
}

export interface JwtVerifierOptions {
  authority: string; // issuer base, no trailing slash
  audience: string;
  /** Inject a key set directly (tests / pre-fetched JWKS); skips discovery. */
  jwks?: JWTVerifyGetKey;
  /** Override the JWKS URI; otherwise discovered from the authority. */
  jwksUri?: string;
  fetchImpl?: typeof fetch;
}

export async function discoverJwksUri(
  authority: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `${authority}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new AppError("jwks_discovery_failed", `OIDC discovery failed: ${(e as Error).message}`, 503);
  }
  if (!res.ok) {
    throw new AppError("jwks_discovery_failed", `OIDC discovery failed (${res.status})`, 503);
  }
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new AppError("jwks_discovery_failed", "OIDC discovery document has no jwks_uri", 503);
  }
  return doc.jwks_uri;
}

/** Verifies OIDC access tokens against the IdP's JWKS (issuer + audience checked). */
export class JwtVerifier {
  private keyFn?: JWTVerifyGetKey;

  constructor(private readonly opts: JwtVerifierOptions) {
    if (opts.jwks) this.keyFn = opts.jwks;
  }

  private async getKeyFn(): Promise<JWTVerifyGetKey> {
    if (this.keyFn) return this.keyFn;
    const uri = this.opts.jwksUri ?? (await discoverJwksUri(this.opts.authority, this.opts.fetchImpl));
    this.keyFn = createRemoteJWKSet(new URL(uri));
    return this.keyFn;
  }

  async verify(token: string): Promise<VerifiedClaims> {
    const keyFn = await this.getKeyFn();
    try {
      const { payload } = await jwtVerify(token, keyFn, {
        issuer: [this.opts.authority, `${this.opts.authority}/`],
        audience: this.opts.audience,
      });
      if (!payload.sub) {
        throw new AppError(ErrorCodes.UNAUTHENTICATED, "token missing sub claim", 401);
      }
      const email = typeof payload.email === "string" ? payload.email : undefined;
      return { sub: payload.sub, email, raw: payload };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(ErrorCodes.UNAUTHENTICATED, `invalid token: ${(e as Error).message}`, 401);
    }
  }
}
