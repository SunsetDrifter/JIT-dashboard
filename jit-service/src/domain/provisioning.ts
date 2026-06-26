import { AppError, ErrorCodes } from "../lib/errors.js";
import type { NetbirdClient } from "../netbird/client.js";
import { createGroup, deleteGroup, getGroup } from "../netbird/groups.js";
import { createPolicy, deletePolicy, updatePolicy } from "../netbird/policies.js";
import type { NbPolicy } from "../netbird/types.js";
import type { JitPolicy, Traffic } from "./types.js";

/** Marker-prefixed name so the dashboard SWR filter can hide JIT objects. */
export const markerName = (marker: string, name: string): string => `${marker}${name}`;

/** Guard the HARD INVARIANT: JIT only ever mutates API-issued groups. */
export async function assertApiGroup(nb: NetbirdClient, groupId: string): Promise<void> {
  const group = await getGroup(nb, groupId);
  if (group.issued && group.issued !== "api") {
    throw new AppError(
      ErrorCodes.CONFLICT,
      `Backing group ${groupId} is ${group.issued}-issued; JIT only manages API groups`,
      409,
    );
  }
}

export interface BackingSpec {
  name: string;
  backingGroupId: string;
  targetResourceIds: string[];
  traffic: Traffic;
}

/** Build the NetBird access policy: one rule per resource, source = backing group. */
export function buildNbPolicy(marker: string, spec: BackingSpec): NbPolicy {
  return {
    name: markerName(marker, spec.name),
    description: "Managed by JIT — do not edit",
    enabled: true,
    rules: spec.targetResourceIds.map((rid, i) => ({
      name: markerName(marker, `${spec.name}-${i}`),
      description: "Managed by JIT",
      enabled: true,
      sources: [spec.backingGroupId],
      destinationResource: { id: rid },
      bidirectional: false,
      action: "accept",
      protocol: spec.traffic.protocol,
      ...(spec.traffic.ports ? { ports: spec.traffic.ports } : {}),
    })),
  };
}

export interface ProvisionResult {
  backingGroupId: string;
  netbirdPolicyId: string;
}

/** Create the marker-tagged backing group + access policy. Rolls back the group on policy failure. */
export async function provisionBacking(
  nb: NetbirdClient,
  marker: string,
  spec: { name: string; targetResourceIds: string[]; traffic: Traffic },
): Promise<ProvisionResult> {
  const group = await createGroup(nb, { name: markerName(marker, spec.name) });
  try {
    const policy = await createPolicy(
      nb,
      buildNbPolicy(marker, { ...spec, backingGroupId: group.id }),
    );
    if (!policy.id) {
      throw new AppError(ErrorCodes.NETBIRD_UNAVAILABLE, "NetBird policy create returned no id", 502);
    }
    return { backingGroupId: group.id, netbirdPolicyId: policy.id };
  } catch (e) {
    await deleteGroup(nb, group.id).catch(() => undefined); // best-effort rollback
    throw e;
  }
}

/** Re-sync the NetBird policy (e.g. resources/traffic/name changed). */
export async function updateBackingPolicy(
  nb: NetbirdClient,
  marker: string,
  policy: JitPolicy,
): Promise<void> {
  if (!policy.backingGroupId || !policy.netbirdPolicyId) return;
  await updatePolicy(
    nb,
    policy.netbirdPolicyId,
    buildNbPolicy(marker, {
      name: policy.name,
      backingGroupId: policy.backingGroupId,
      targetResourceIds: policy.targetResourceIds,
      traffic: policy.traffic,
    }),
  );
}

/** Delete the access policy then the backing group (best-effort, idempotent on 404). */
export async function deprovisionBacking(nb: NetbirdClient, policy: JitPolicy): Promise<void> {
  const swallow404 = (e: unknown) => {
    if (e instanceof AppError && e.code === ErrorCodes.NOT_FOUND) return;
    throw e;
  };
  if (policy.netbirdPolicyId) await deletePolicy(nb, policy.netbirdPolicyId).catch(swallow404);
  if (policy.backingGroupId) await deleteGroup(nb, policy.backingGroupId).catch(swallow404);
}
