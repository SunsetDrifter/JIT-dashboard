"use client";

import Breadcrumbs from "@components/Breadcrumbs";
import Button from "@components/Button";
import Paragraph from "@components/Paragraph";
import { DataTable } from "@components/table/DataTable";
import DataTableRefreshButton from "@components/table/DataTableRefreshButton";
import DataTableGlobalSearch from "@components/table/DataTableGlobalSearch";
import { SelectDropdown } from "@components/select/SelectDropdown";
import { RestrictedAccess } from "@components/ui/RestrictedAccess";
import { cn } from "@utils/helpers";
import type { ColumnDef } from "@tanstack/react-table";
import { ZapIcon } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { useLoggedInUser } from "@/contexts/UsersProvider";
import PageContainer from "@/layouts/PageContainer";
import type { JitGrant } from "@/modules/jit/interfaces/Jit";
import { useJit } from "@/modules/jit/JitProvider";
import { formatDateTime, formatDuration, timeRemaining } from "@/modules/jit/misc/format";

export default function JitApprovalsPage() {
  const { isOwnerOrAdmin } = useLoggedInUser();
  const { pendingRequests, activeGrants, policies, approveRequest, denyRequest, revokeGrant, refreshAdmin } = useJit();
  const [tab, setTab] = useState<"pending" | "active">("pending");
  const [search, setSearch] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");

  const requester = (g: JitGrant) => g.requesterEmail ?? g.requesterUserId;
  const policyName = (g: JitGrant) => policies?.find((p) => p.id === g.policyId)?.name ?? "—";
  const matchesPolicy = (g: JitGrant) => !policyFilter || g.policyId === policyFilter;
  const policyOptions = [
    { label: "All policies", value: "" },
    ...(policies ?? []).map((p) => ({ label: p.name, value: p.id })),
  ];

  const matchesSearch = (g: JitGrant) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (g.requesterEmail ?? "").toLowerCase().includes(q) ||
      (g.requesterUserId ?? "").toLowerCase().includes(q) ||
      (g.justification ?? "").toLowerCase().includes(q)
    );
  };

  const pendingColumns: ColumnDef<JitGrant>[] = [
    { id: "requester", header: "Requester", cell: ({ row }) => requester(row.original) },
    { id: "policy", header: "Policy", cell: ({ row }) => policyName(row.original) },
    { accessorKey: "requestedDurationMinutes", header: "Duration", cell: ({ row }) => formatDuration(row.original.requestedDurationMinutes) },
    { accessorKey: "justification", header: "Justification", cell: ({ row }) => row.original.justification || "—" },
    { accessorKey: "requestedAt", header: "Requested", cell: ({ row }) => formatDateTime(row.original.requestedAt) },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button variant="primary" size="xs" onClick={() => approveRequest(row.original.id)}>
            Approve
          </Button>
          <Button variant="secondary" size="xs" onClick={() => denyRequest(row.original.id)}>
            Deny
          </Button>
        </div>
      ),
    },
  ];

  const activeColumns: ColumnDef<JitGrant>[] = [
    { id: "requester", header: "User", cell: ({ row }) => requester(row.original) },
    { id: "policy", header: "Policy", cell: ({ row }) => policyName(row.original) },
    { accessorKey: "activatedAt", header: "Granted", cell: ({ row }) => formatDateTime(row.original.activatedAt) },
    { id: "expires", header: "Expires", cell: ({ row }) => timeRemaining(row.original.expiresAt) },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="danger-outline" size="xs" onClick={() => revokeGrant(row.original.id)}>
            Revoke
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <div className="p-default py-6">
        <Breadcrumbs>
          <Breadcrumbs.Item label="Just-in-Time Access" icon={<ZapIcon size={13} />} />
          <Breadcrumbs.Item href="/jit/approvals" label="Approvals" active />
        </Breadcrumbs>
        <h1>Approvals</h1>
        <Paragraph>Review pending access requests and manage active grants.</Paragraph>
      </div>

      <RestrictedAccess hasAccess={isOwnerOrAdmin} page="JIT Approvals">
        <div className="p-default">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex gap-2 shrink-0">
              {(["pending", "active"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "inline-flex items-center h-[42px] px-4 rounded-md text-sm capitalize whitespace-nowrap transition-colors",
                    tab === t ? "bg-netbird text-white" : "text-nb-gray-300 hover:bg-nb-gray-900",
                  )}
                >
                  {t === "pending"
                    ? `Pending${pendingRequests?.length ? ` (${pendingRequests.length})` : ""}`
                    : "Active grants"}
                </button>
              ))}
            </div>
            <DataTableRefreshButton onClick={() => void refreshAdmin()} />
            <div className="w-[220px] shrink-0">
              <SelectDropdown
                value={policyFilter}
                onChange={setPolicyFilter}
                options={policyOptions}
                placeholder="All policies"
                showSearch
                searchPlaceholder="Search policies..."
                triggerClassName="h-[42px]"
                popoverMinWidth={220}
              />
            </div>
            <DataTableGlobalSearch
              globalSearch={search}
              setGlobalSearch={setSearch}
              placeholder="Search..."
            />
          </div>

          {tab === "pending" ? (
            <DataTable
              columns={pendingColumns}
              data={(pendingRequests ?? []).filter((g) => matchesSearch(g) && matchesPolicy(g))}
              text="pending requests"
              showSearchAndFilters={false}
            />
          ) : (
            <DataTable
              columns={activeColumns}
              data={(activeGrants ?? []).filter((g) => matchesSearch(g) && matchesPolicy(g))}
              text="active grants"
              showSearchAndFilters={false}
            />
          )}
        </div>
      </RestrictedAccess>
    </PageContainer>
  );
}
