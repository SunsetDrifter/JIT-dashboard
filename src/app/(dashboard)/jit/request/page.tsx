"use client";

import Badge from "@components/Badge";
import Breadcrumbs from "@components/Breadcrumbs";
import Button from "@components/Button";
import { Callout } from "@components/Callout";
import Paragraph from "@components/Paragraph";
import { DataTable } from "@components/table/DataTable";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock3Icon, ServerIcon, ZapIcon } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import PageContainer from "@/layouts/PageContainer";
import type { EligiblePolicy, JitGrant } from "@/modules/jit/interfaces/Jit";
import { useJit } from "@/modules/jit/JitProvider";
import { JitRequestModal } from "@/modules/jit/modals/JitRequestModal";
import { formatDateTime, formatDuration, JitStatusBadge, timeRemaining } from "@/modules/jit/misc/format";

export default function JitRequestPage() {
  const { eligiblePolicies, myRequests, cancelRequest, endGrant } = useJit();
  const [selected, setSelected] = useState<EligiblePolicy | null>(null);
  const [extendPolicy, setExtendPolicy] = useState<EligiblePolicy | null>(null);

  const columns: ColumnDef<JitGrant>[] = [
    {
      id: "policy",
      header: "Policy",
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {row.original.policyName ?? "—"}
          {row.original.supersedesGrantId && (
            <span>
              <Badge variant="blue">extension</Badge>
            </span>
          )}
        </span>
      ),
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <JitStatusBadge status={row.original.status} /> },
    { accessorKey: "requestedDurationMinutes", header: "Duration", cell: ({ row }) => formatDuration(row.original.requestedDurationMinutes) },
    { accessorKey: "requestedAt", header: "Requested", cell: ({ row }) => formatDateTime(row.original.requestedAt) },
    {
      id: "expires",
      header: "Expires",
      cell: ({ row }) => (row.original.status === "active" ? timeRemaining(row.original.expiresAt) : "—"),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const g = row.original;
        if (g.status === "pending")
          return (
            <Button variant="secondary" size="xs" data-testid="jit-request-cancel" onClick={() => cancelRequest(g.id)}>
              Cancel
            </Button>
          );
        if (g.status === "active") {
          const elig = eligiblePolicies?.find((p) => p.id === g.policyId);
          const pendingExists = (myRequests ?? []).some(
            (r) => r.status === "pending" && r.policyId === g.policyId,
          );
          return (
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                size="xs"
                data-testid="jit-grant-extend"
                disabled={!elig || pendingExists}
                onClick={() => elig && setExtendPolicy(elig)}
                title={
                  !elig
                    ? "You are no longer eligible for this policy"
                    : pendingExists
                      ? "An extension is already pending"
                      : undefined
                }
              >
                Extend
              </Button>
              <Button variant="danger-outline" size="xs" data-testid="jit-grant-end" onClick={() => endGrant(g.id)}>
                End now
              </Button>
            </div>
          );
        }
        return null;
      },
    },
  ];

  return (
    <PageContainer>
      <div className="p-default py-6">
        <Breadcrumbs>
          <Breadcrumbs.Item label="Just-in-Time Access" icon={<ZapIcon size={13} />} />
          <Breadcrumbs.Item href="/jit/request" label="Request Access" active />
        </Breadcrumbs>
        <h1>Request Access</h1>
        <Paragraph>Request temporary, time-boxed access to network resources. Access expires automatically.</Paragraph>
      </div>

      <div className="p-default flex flex-col gap-8 pb-10">
        <section>
          <h2 className="text-base font-medium mb-3">Available access</h2>
          {eligiblePolicies && eligiblePolicies.length > 0 ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(16rem,20rem))]">
              {eligiblePolicies.map((p) => (
                <div key={p.id} data-testid="jit-available-policy" className="rounded-md border border-nb-gray-800 p-4 flex flex-col gap-3 bg-nb-gray-940">
                  <div>
                    <div className="font-medium text-nb-gray-100">{p.name}</div>
                    {p.description && <div className="text-sm text-nb-gray-400 mt-1">{p.description}</div>}
                  </div>
                  <div className="text-xs text-nb-gray-400 flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <ServerIcon size={13} /> {p.targetResourceIds.length} resource(s)
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock3Icon size={13} /> up to {formatDuration(p.maxDurationMinutes)}
                    </span>
                  </div>
                  <Button variant="primary" size="sm" data-testid="jit-request-open" onClick={() => setSelected(p)}>
                    Request
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Callout variant="info" className="max-w-xl">
              You have no Just-in-Time access available. Ask an administrator to grant you eligibility.
            </Callout>
          )}
        </section>

        <section>
          <h2 className="text-base font-medium mb-3">My requests</h2>
          <DataTable columns={columns} data={myRequests ?? []} text="requests" />
        </section>
      </div>

      {selected && (
        <JitRequestModal
          policy={selected}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      )}
      {extendPolicy && (
        <JitRequestModal
          policy={extendPolicy}
          mode="extend"
          open={!!extendPolicy}
          onOpenChange={(open) => {
            if (!open) setExtendPolicy(null);
          }}
        />
      )}
    </PageContainer>
  );
}
