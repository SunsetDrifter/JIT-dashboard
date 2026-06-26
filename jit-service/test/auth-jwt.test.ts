import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { describe, expect, it } from "vitest";
import { JwtVerifier } from "../src/auth/jwt.js";

const AUTH = "https://idp.example.com";
const AUD = "netbird";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "k1";
  jwk.alg = "ES256";
  const jwks = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, jwks };
}

function sign(
  privateKey: KeyLike,
  over: { aud?: string; exp?: string | number; email?: string } = {},
) {
  return new SignJWT({ email: over.email ?? "a@b.com" })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(AUTH)
    .setSubject("sub-1")
    .setIssuedAt()
    .setAudience(over.aud ?? AUD)
    .setExpirationTime(over.exp ?? "5m")
    .sign(privateKey);
}

const verifier = (jwks: JWTVerifyGetKey) => new JwtVerifier({ authority: AUTH, audience: AUD, jwks });

describe("JwtVerifier", () => {
  it("verifies a valid token and extracts claims", async () => {
    const { privateKey, jwks } = await setup();
    const claims = await verifier(jwks).verify(await sign(privateKey));
    expect(claims.sub).toBe("sub-1");
    expect(claims.email).toBe("a@b.com");
  });

  it("rejects a wrong audience", async () => {
    const { privateKey, jwks } = await setup();
    const token = await sign(privateKey, { aud: "other" });
    await expect(verifier(jwks).verify(token)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await setup();
    const token = await sign(privateKey, { exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifier(jwks).verify(token)).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
