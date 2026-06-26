import type { NetbirdClient } from "./client.js";
import type { NbAccountSettings, NbAccount, NbNetworkResource } from "./types.js";

export const listAccounts = (c: NetbirdClient): Promise<NbAccount[]> =>
  c.get<NbAccount[]>("/accounts");

export async function getAccountSettings(c: NetbirdClient): Promise<NbAccountSettings | null> {
  const accounts = await listAccounts(c);
  return accounts[0]?.settings ?? null;
}

export async function isGroupsPropagationEnabled(c: NetbirdClient): Promise<boolean> {
  const settings = await getAccountSettings(c);
  return settings?.groups_propagation_enabled ?? false;
}

export const listNetworkResources = (c: NetbirdClient): Promise<NbNetworkResource[]> =>
  c.get<NbNetworkResource[]>("/networks/resources");
