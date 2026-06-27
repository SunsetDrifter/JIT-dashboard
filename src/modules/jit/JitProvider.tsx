"use client";

import { notify } from "@components/Notification";
import React, { createContext, useContext } from "react";
import { useDialog } from "@/contexts/DialogProvider";
import { useLoggedInUser } from "@/contexts/UsersProvider";
import { useJitCall, useJitFetch } from "./hooks/useJitApi";
import type {
  CreateJitPolicyBody,
  EligiblePolicy,
  JitGrant,
  JitMe,
  JitNetworkResource,
  JitPolicy,
} from "./interfaces/Jit";

type UpdatePolicyBody = Partial<CreateJitPolicyBody> & { enabled?: boolean };

type JitContextValue = {
  me?: JitMe;
  isAdmin: boolean;
  propagationEnabled: boolean;
  policies?: JitPolicy[];
  resources?: JitNetworkResource[];
  eligiblePolicies?: EligiblePolicy[];
  myRequests?: JitGrant[];
  pendingRequests?: JitGrant[];
  activeGrants?: JitGrant[];
  isLoading: boolean;
  refreshAdmin: () => Promise<void>;
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

  const me = useJitFetch<JitMe>("/me");
  const eligible = useJitFetch<EligiblePolicy[]>("/policies/eligible");
  const mine = useJitFetch<JitGrant[]>("/requests/mine");
  const policies = useJitFetch<JitPolicy[]>("/admin/policies", isOwnerOrAdmin);
  const resources = useJitFetch<JitNetworkResource[]>("/admin/network-resources", isOwnerOrAdmin);
  const pending = useJitFetch<JitGrant[]>("/admin/requests?status=pending", isOwnerOrAdmin, 30_000);
  const active = useJitFetch<JitGrant[]>("/admin/grants/active", isOwnerOrAdmin, 30_000);

  const policyCall = useJitCall<JitPolicy>("/admin/policies");
  const requestCall = useJitCall<JitGrant>("/requests");
  const adminReqCall = useJitCall<JitGrant>("/admin/requests");
  const grantCall = useJitCall<JitGrant>("/grants");
  const adminGrantCall = useJitCall<JitGrant>("/admin/grants");

  const refreshAdmin = (): Promise<void> =>
    Promise.all([policies.mutate(), pending.mutate(), active.mutate()]).then(() => undefined);

  const run = (promise: Promise<unknown>, title: string, description: string, loadingMessage: string) => {
    notify({ title, description, loadingMessage, promise: promise as Promise<unknown> });
    return promise.then(() => undefined);
  };

  // Policy CRUD also changes what the current user is eligible to request, so
  // refresh both the admin list and the requester's eligible list.
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
      adminReqCall.post({}, `/${id}/approve`).then(() => {
        void pending.mutate();
        return active.mutate();
      }),
      "Approve request",
      "Request approved — access granted",
      "Approving…",
    );

  const denyRequest = (id: string, reason?: string) =>
    run(
      adminReqCall.post({ reason }, `/${id}/deny`).then(() => pending.mutate()),
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
      adminGrantCall.post({}, `/${id}/revoke`).then(() => active.mutate()),
      "Revoke grant",
      "Grant revoked",
      "Revoking…",
    );
  };

  const extendGrant = (id: string, durationMinutes: number) =>
    run(
      adminGrantCall.post({ durationMinutes }, `/${id}/extend`).then(() => active.mutate()),
      "Extend grant",
      "Grant extended",
      "Extending…",
    );

  const value: JitContextValue = {
    me: me.data,
    isAdmin: me.data?.isAdmin ?? isOwnerOrAdmin,
    propagationEnabled: me.data?.propagationEnabled ?? true,
    policies: policies.data,
    resources: resources.data,
    eligiblePolicies: eligible.data,
    myRequests: mine.data,
    pendingRequests: pending.data,
    activeGrants: active.data,
    isLoading: me.isLoading || mine.isLoading,
    refreshAdmin,
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
