"use client";

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

  const columns: ColumnDef<JitGrant>[] = [
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
            <Button variant="secondary" size="xs" onClick={() => cancelRequest(g.id)}>
              Cancel
            </Button>
          );
        if (g.status === "active")
          return (
            <Button variant="danger-outline" size="xs" onClick={() => endGrant(g.id)}>
              End now
            </Button>
          );
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {eligiblePolicies.map((p) => (
                <div key={p.id} className="rounded-md border border-nb-gray-800 p-4 flex flex-col gap-3 bg-nb-gray-940">
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
                  <Button variant="primary" size="sm" onClick={() => setSelected(p)}>
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
    </PageContainer>
  );
}
