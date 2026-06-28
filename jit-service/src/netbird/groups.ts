import type { NetbirdClient } from "./client.js";
import type { NbGroup } from "./types.js";

export const listGroups = (c: NetbirdClient): Promise<NbGroup[]> => c.get<NbGroup[]>("/groups");

export const getGroup = (c: NetbirdClient, id: string): Promise<NbGroup> =>
  c.get<NbGroup>(`/groups/${id}`);

export interface CreateGroupInput {
  name: string;
  peers?: string[];
  resources?: { id: string; type: string }[];
}

export const createGroup = (c: NetbirdClient, input: CreateGroupInput): Promise<NbGroup> =>
  c.post<NbGroup>("/groups", input);

export const updateGroup = (
  c: NetbirdClient,
  id: string,
  input: CreateGroupInput,
): Promise<NbGroup> => c.put<NbGroup>(`/groups/${id}`, input);

export const deleteGroup = (c: NetbirdClient, id: string): Promise<void> =>
  c.del<void>(`/groups/${id}`);
