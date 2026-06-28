import type { NetbirdClient } from "./client.js";
import type { NbPolicy } from "./types.js";

export const createPolicy = (c: NetbirdClient, policy: NbPolicy): Promise<NbPolicy> =>
  c.post<NbPolicy>("/policies", policy);

export const getPolicy = (c: NetbirdClient, id: string): Promise<NbPolicy> =>
  c.get<NbPolicy>(`/policies/${id}`);

export const updatePolicy = (c: NetbirdClient, id: string, policy: NbPolicy): Promise<NbPolicy> =>
  c.put<NbPolicy>(`/policies/${id}`, policy);

export const deletePolicy = (c: NetbirdClient, id: string): Promise<void> =>
  c.del<void>(`/policies/${id}`);
