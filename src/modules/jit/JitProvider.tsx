"use client";

import { notify } from "@components/Notification";
import React, { createContext, useContext, useMemo } from "react";
import { useDialog } from "@/contexts/DialogProvider";
import { useLoggedInUser } from "@/contexts/UsersProvider";
import { useAccount } from "@/modules/account/useAccount";
import useFetchApi from "@utils/api";
import type { NetworkResource } from "@/interfaces/Network";
import type { Policy } from "@/interfaces/Policy";
import { useJitCall, useJitFetch } from "./hooks/useJitApi";
import type {
  CreateJitPolicyBody,
  EligiblePolicy,
  JitGrant,
  JitNetworkResource,
  JitPolicy,
} from "./interfaces/Jit";

type UpdatePolicyBody = Partial<CreateJitPolicyBody> & { enabled?: boolean };

type JitContextValue = {
  isAdmin: boolean;
  // undefined = unknown (account still loading); only `false` means propagation is off.
  propagationEnabled?: boolean;
  // True when the JIT API is unreachable.
  serviceUnavailable: boolean;
  policies?: JitPolicy[];
  resources?: JitNetworkResource[];
  // Access Control policies an admin can base a mirror-type JIT policy on.
  accessPolicies?: Policy[];
  eligiblePolicies?: EligiblePolicy[];
  myRequests?: JitGrant[];
  pendingRequests?: JitGrant[];
  activeGrants?: JitGrant[];
  isLoading: boolean;
  refreshAdmin: () => Promise<void>;
  refreshMine: () => Promise<void>;
  createPolicy: (body: CreateJitPolicyBody) => Promise<void>;
  updatePolicy: (id: string, body: UpdatePolicyBody) => Promise<void>;
  deletePolicy: (id: string, name: string) => Promise<void>;
  requestAccess: (policyId: string, durationMinutes: number, justification?: string) => Promise<void>;
  cancelRequest: (id: string) => Promise<void>;
  endGrant: (id: string) => Promise<void>;
  approveRequest: (id: string) => Promise<void>;
  denyRequest: (id: string, reason?: string) => Promise<void>;
  revokeGrant: (id: string) => Promise<void>;
  extendGrant: (id: string, durationMinutes: number) => Promise<void>;
};

const JitContext = createContext<JitContextValue | null>(null);

export function JitProvider({ children }: { children: React.ReactNode }) {
  const { isOwnerOrAdmin } = useLoggedInUser();
  const { confirm } = useDialog();

  // Native account settings — source of propagationEnabled.
  const account = useAccount();
  const propagationEnabled = account?.settings.groups_propagation_enabled;

  // Native network resources replaces the dropped /admin/network-resources endpoint.
  const { data: rawResources } = useFetchApi<NetworkResource[]>(
    "/networks/resources",
    true,
    true,
    isOwnerOrAdmin,
  );

  // Access Control policies — candidate sources for mirror-type JIT policies.
  // JIT-owned policies are already filtered out of /policies server-side.
  const { data: accessPolicies } = useFetchApi<Policy[]>(
    "/policies",
    true,
    true,
    isOwnerOrAdmin,
  );

  // JIT endpoints — all now on native /api/jit/...
  const eligible = useJitFetch<EligiblePolicy[]>("/jit/policies/eligible");
  const mine = useJitFetch<JitGrant[]>("/jit/requests/mine");
  const policies = useJitFetch<JitPolicy[]>("/jit/policies", isOwnerOrAdmin);
  const pending = useJitFetch<JitGrant[]>("/jit/requests?status=pending", isOwnerOrAdmin, 30_000);
  const active = useJitFetch<JitGrant[]>("/jit/grants/active", isOwnerOrAdmin, 30_000);

  const policyCall = useJitCall<JitPolicy>("/jit/policies");
  const requestCall = useJitCall<JitGrant>("/jit/requests");
  const grantCall = useJitCall<JitGrant>("/jit/grants");

  // serviceUnavailable: signal a JIT API problem if the eligible-policies
  // fetch errors (it runs for all users, so it's the best canary).
  const serviceUnavailable = Boolean(eligible.error);

  const refreshAdmin = (): Promise<void> =>
    Promise.all([policies.mutate(), pending.mutate(), active.mutate()]).then(() => undefined);

  const refreshMine = (): Promise<void> =>
    Promise.all([eligible.mutate(), mine.mutate()]).then(() => undefined);

  const run = (promise: Promise<unknown>, title: string, description: string, loadingMessage: string) => {
    notify({ title, description, loadingMessage, promise: promise as Promise<unknown> });
    return promise.then(() => undefined);
  };

  const refreshPolicies = () => {
    void eligible.mutate();
    return policies.mutate();
  };

  const createPolicy = (body: CreateJitPolicyBody) =>
    run(
      policyCall.post(body).then(refreshPolicies),
      "Create JIT policy",
      `JIT policy '${body.name}' created`,
      "Creating JIT policy…",
    );

  const updatePolicy = (id: string, body: UpdatePolicyBody) =>
    run(
      policyCall.put(body, `/${id}`).then(refreshPolicies),
      "Update JIT policy",
      "JIT policy updated",
      "Updating…",
    );

  const deletePolicy = async (id: string, name: string) => {
    const choice = await confirm({
      title: `Delete '${name}'?`,
      description:
        "This deletes the JIT policy and its backing group + access policy, and revokes any active grants. This cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      type: "danger",
    });
    if (!choice) return;
    await run(
      policyCall.del(`/${id}`).then(refreshPolicies),
      "Delete JIT policy",
      `'${name}' deleted`,
      "Deleting…",
    );
  };

  const requestAccess = (policyId: string, durationMinutes: number, justification?: string) =>
    run(
      requestCall.post({ policyId, durationMinutes, justification }).then(() => mine.mutate()),
      "Request access",
      "Your access request was submitted",
      "Submitting request…",
    );

  const cancelRequest = async (id: string) => {
    const choice = await confirm({
      title: "Cancel this request?",
      description: "Your pending request will be withdrawn.",
      confirmText: "Cancel request",
      cancelText: "Keep",
      type: "warning",
    });
    if (!choice) return;
    await run(
      requestCall.post({}, `/${id}/cancel`).then(() => mine.mutate()),
      "Cancel request",
      "Request cancelled",
      "Cancelling…",
    );
  };

  const endGrant = async (id: string) => {
    const choice = await confirm({
      title: "End access now?",
      description: "Your access will be removed immediately.",
      confirmText: "End access",
      cancelText: "Keep",
      type: "warning",
    });
    if (!choice) return;
    await run(
      grantCall.post({}, `/${id}/end`).then(() => {
        void mine.mutate();
        return active.mutate();
      }),
      "End access",
      "Access ended",
      "Ending access…",
    );
  };

  const approveRequest = (id: string) =>
    run(
      requestCall.post({}, `/${id}/approve`).then(() => {
        void pending.mutate();
        return active.mutate();
      }),
      "Approve request",
      "Request approved — access granted",
      "Approving…",
    );

  const denyRequest = (id: string, reason?: string) =>
    run(
      requestCall.post({ reason }, `/${id}/deny`).then(() => pending.mutate()),
      "Deny request",
      "Request denied",
      "Denying…",
    );

  const revokeGrant = async (id: string) => {
    const choice = await confirm({
      title: "Revoke this grant?",
      description: "The user's access will be removed immediately.",
      confirmText: "Revoke",
      cancelText: "Cancel",
      type: "danger",
    });
    if (!choice) return;
    await run(
      grantCall.post({}, `/${id}/revoke`).then(() => active.mutate()),
      "Revoke grant",
      "Grant revoked",
      "Revoking…",
    );
  };

  const extendGrant = (id: string, durationMinutes: number) =>
    run(
      grantCall.post({ durationMinutes }, `/${id}/extend`).then(() => active.mutate()),
      "Extend grant",
      "Grant extended",
      "Extending…",
    );

  // Memoised resources so the modal's useMemo deps stay stable.
  const resources = useMemo(() => rawResources, [rawResources]);

  const value: JitContextValue = {
    isAdmin: isOwnerOrAdmin,
    propagationEnabled,
    serviceUnavailable,
    policies: policies.data,
    resources,
    accessPolicies,
    eligiblePolicies: eligible.data,
    myRequests: mine.data,
    pendingRequests: pending.data,
    activeGrants: active.data,
    isLoading: mine.isLoading,
    refreshAdmin,
    refreshMine,
    createPolicy,
    updatePolicy,
    deletePolicy,
    requestAccess,
    cancelRequest,
    endGrant,
    approveRequest,
    denyRequest,
    revokeGrant,
    extendGrant,
  };

  return <JitContext.Provider value={value}>{children}</JitContext.Provider>;
}

export const useJit = (): JitContextValue => {
  const ctx = useContext(JitContext);
  if (!ctx) throw new Error("useJit must be used within a JitProvider");
  return ctx;
};
