"use client";

import Badge from "@components/Badge";
import Breadcrumbs from "@components/Breadcrumbs";
import Button from "@components/Button";
import Paragraph from "@components/Paragraph";
import { DataTable } from "@components/table/DataTable";
import DataTableRefreshButton from "@components/table/DataTableRefreshButton";
import DataTableGlobalSearch from "@components/table/DataTableGlobalSearch";
import { SelectDropdown } from "@components/select/SelectDropdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/Tabs";
import { RestrictedAccess } from "@components/ui/RestrictedAccess";
import type { ColumnDef } from "@tanstack/react-table";
import { ClockIcon, ShieldCheckIcon, ZapIcon } from "lucide-react";
import * as React from "react";
import { useMemo, useState } from "react";
import useFetchApi from "@utils/api";
import useUrlTab from "@/hooks/useUrlTab";
import { useLoggedInUser } from "@/contexts/UsersProvider";
import PageContainer from "@/layouts/PageContainer";
import { User } from "@/interfaces/User";
import type { JitGrant } from "@/modules/jit/interfaces/Jit";
import { useJit } from "@/modules/jit/JitProvider";
import { JitExtendModal } from "@/modules/jit/modals/JitExtendModal";
import { formatDateTime, formatDuration, timeRemaining } from "@/modules/jit/misc/format";
import UserNameCell from "@/modules/users/table-cells/UserNameCell";

export default function JitApprovalsPage() {
  const { isOwnerOrAdmin } = useLoggedInUser();
  const { pendingRequests, activeGrants, policies, approveRequest, denyRequest, revokeGrant, refreshAdmin } = useJit();
  const [tab, setTab] = useUrlTab(["pending", "active"], "pending");
  const [search, setSearch] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");
  const [extendTarget, setExtendTarget] = useState<JitGrant | null>(null);

  const { data: users } = useFetchApi<User[]>("/users?service_user=false");

  const usersById = useMemo<Map<string, User>>(() => {
    if (!users) return new Map();
    return new Map(users.map((u) => [u.id, u]));
  }, [users]);

  const requester = (g: JitGrant) => g.requesterEmail ?? g.requesterUserId;
  const policyName = (g: JitGrant) => g.policyName ?? policies?.find((p) => p.id === g.policyId)?.name ?? "—";
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
    {
      id: "policy",
      header: "Policy",
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {policyName(row.original)}
          {row.original.supersedesGrantId && <Badge variant="blue" className="capitalize">extension</Badge>}
        </span>
      ),
    },
    { accessorKey: "requestedDurationMinutes", header: "Duration", cell: ({ row }) => formatDuration(row.original.requestedDurationMinutes) },
    { accessorKey: "justification", header: "Justification", cell: ({ row }) => row.original.justification || "—" },
    { accessorKey: "requestedAt", header: "Requested", cell: ({ row }) => formatDateTime(row.original.requestedAt) },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button variant="primary" size="xs" data-testid="jit-approve" onClick={() => approveRequest(row.original.id)}>
            Approve
          </Button>
          <Button variant="secondary" size="xs" data-testid="jit-deny" onClick={() => denyRequest(row.original.id)}>
            Deny
          </Button>
        </div>
      ),
    },
  ];

  const activeColumns: ColumnDef<JitGrant>[] = [
    {
      id: "requester",
      header: "User",
      cell: ({ row }) => {
        const user = usersById.get(row.original.requesterUserId);
        if (user) return <UserNameCell user={user} />;
        return <span>{row.original.requesterEmail ?? row.original.requesterUserId}</span>;
      },
    },
    { id: "policy", header: "Policy", cell: ({ row }) => policyName(row.original) },
    { accessorKey: "activatedAt", header: "Granted", cell: ({ row }) => formatDateTime(row.original.activatedAt) },
    { id: "expires", header: "Expires", cell: ({ row }) => timeRemaining(row.original.expiresAt) },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="xs" data-testid="jit-grant-extend" onClick={() => setExtendTarget(row.original)}>
            Extend
          </Button>
          <Button variant="danger-outline" size="xs" data-testid="jit-revoke" onClick={() => revokeGrant(row.original.id)}>
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
        <Tabs
          defaultValue={tab}
          value={tab}
          onValueChange={setTab}
          className="pb-0 mb-0"
        >
          <TabsList justify="start" className="px-8">
            <TabsTrigger value="pending" data-testid="jit-tab-pending">
              <ClockIcon size={14} />
              {`Pending${pendingRequests?.length ? ` (${pendingRequests.length})` : ""}`}
            </TabsTrigger>
            <TabsTrigger value="active" data-testid="jit-tab-active">
              <ShieldCheckIcon size={14} />
              Active grants
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-3 px-8 mt-4 mb-4">
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

          <TabsContent value="pending" className="px-8 pb-8">
            <DataTable
              columns={pendingColumns}
              data={(pendingRequests ?? []).filter((g) => matchesSearch(g) && matchesPolicy(g))}
              text="pending requests"
              showSearchAndFilters={false}
            />
          </TabsContent>
          <TabsContent value="active" className="px-8 pb-8">
            <DataTable
              columns={activeColumns}
              data={(activeGrants ?? []).filter((g) => matchesSearch(g) && matchesPolicy(g))}
              text="active grants"
              showSearchAndFilters={false}
            />
          </TabsContent>
        </Tabs>
        {extendTarget && (
          <JitExtendModal
            grant={extendTarget}
            maxDurationMinutes={
              policies?.find((p) => p.id === extendTarget.policyId)?.maxDurationMinutes ??
              extendTarget.requestedDurationMinutes
            }
            open={!!extendTarget}
            onOpenChange={(open) => {
              if (!open) setExtendTarget(null);
            }}
          />
        )}
      </RestrictedAccess>
    </PageContainer>
  );
}
