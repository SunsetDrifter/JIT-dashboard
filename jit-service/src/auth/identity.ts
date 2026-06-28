import { AppError, ErrorCodes } from "../lib/errors.js";
import type { NetbirdClient } from "../netbird/client.js";
import { findUserByEmail, listUsers } from "../netbird/users.js";
import type { VerifiedClaims } from "./jwt.js";

export interface Caller {
  userId: string;
  email?: string;
  role: string;
  isAdmin: boolean;
  autoGroups: string[];
}

const ADMIN_ROLES = new Set(["admin", "owner"]);
export const isAdminRole = (role: string): boolean => ADMIN_ROLES.has(role);

/**
 * Maps verified OIDC claims to a NetBird user (role is taken from NetBird, never
 * from the token). Caches per-identity for a short TTL to avoid hammering /users.
 * Fails closed: no matching NetBird user → 403.
 */
export class IdentityResolver {
  private readonly cache = new Map<string, { caller: Caller; at: number }>();

  constructor(
    private readonly nb: NetbirdClient,
    private readonly ttlMs = 30_000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async resolve(claims: VerifiedClaims): Promise<Caller> {
    const key = claims.email?.toLowerCase() ?? claims.sub;
    const cached = this.cache.get(key);
    if (cached && this.clock() - cached.at < this.ttlMs) return cached.caller;

    let user = claims.email ? await findUserByEmail(this.nb, claims.email) : null;
    if (!user) {
      const users = await listUsers(this.nb);
      user = users.find((u) => u.idp_id && u.idp_id === claims.sub) ?? null;
    }
    if (!user) {
      throw new AppError(
        ErrorCodes.NO_NETBIRD_USER,
        "No NetBird user matches the authenticated identity",
        403,
      );
    }

    const caller: Caller = {
      userId: user.id,
      email: user.email,
      role: user.role,
      isAdmin: isAdminRole(user.role),
      autoGroups: user.auto_groups ?? [],
    };
    this.cache.set(key, { caller, at: this.clock() });
    return caller;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
