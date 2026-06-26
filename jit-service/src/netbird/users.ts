import type { NetbirdClient } from "./client.js";
import type { NbUser } from "./types.js";

export const listUsers = (c: NetbirdClient): Promise<NbUser[]> => c.get<NbUser[]>("/users");

export async function findUserById(c: NetbirdClient, id: string): Promise<NbUser | null> {
  const users = await listUsers(c);
  return users.find((u) => u.id === id) ?? null;
}

export async function findUserByEmail(c: NetbirdClient, email: string): Promise<NbUser | null> {
  const lower = email.toLowerCase();
  const users = await listUsers(c);
  return users.find((u) => u.email?.toLowerCase() === lower) ?? null;
}

/**
 * Write a user's auto_groups, preserving role and is_blocked (mirrors the
 * dashboard's user PUT, which sends exactly {role, auto_groups, is_blocked}).
 */
export function putUserAutoGroups(
  c: NetbirdClient,
  user: NbUser,
  autoGroups: string[],
): Promise<NbUser> {
  return c.put<NbUser>(`/users/${user.id}`, {
    role: user.role,
    auto_groups: autoGroups,
    is_blocked: user.is_blocked ?? false,
  });
}
