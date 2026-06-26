"use client";

import Breadcrumbs from "@components/Breadcrumbs";
import Button from "@components/Button";
import { Callout } from "@components/Callout";
import Paragraph from "@components/Paragraph";
import { DataTable } from "@components/table/DataTable";
import { RestrictedAccess } from "@components/ui/RestrictedAccess";
import type { ColumnDef } from "@tanstack/react-table";
import { PlusCircleIcon, ShieldCheckIcon, ZapIcon } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { useLoggedInUser } from "@/contexts/UsersProvider";
import PageContainer from "@/layouts/PageContainer";
import type { JitPolicy } from "@/modules/jit/interfaces/Jit";
import { useJit } from "@/modules/jit/JitProvider";
import { JitPolicyModal } from "@/modules/jit/modals/JitPolicyModal";
import { formatDuration } from "@/modules/jit/misc/format";

export default function JitPoliciesPage() {
  const { isOwnerOrAdmin } = useLoggedInUser();
  const { policies, propagationEnabled, deletePolicy } = useJit();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<JitPolicy | undefined>(undefined);

  const openCreate = () => {
    setEditing(undefined);
    setOpen(true);
  };
  const openEdit = (p: JitPolicy) => {
    setEditing(p);
    setOpen(true);
  };

  const columns: ColumnDef<JitPolicy>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "resources", header: "Resources", cell: ({ row }) => `${row.original.targetResourceIds.length}` },
    { id: "max", header: "Max duration", cell: ({ row }) => formatDuration(row.original.maxDurationMinutes) },
    {
      id: "eligibility",
      header: "Who can request",
      cell: ({ row }) =>
        row.original.requestableBy.mode === "all"
          ? "Anyone"
          : `${row.original.requestableBy.groupIds.length} group(s)`,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="xs" onClick={() => openEdit(row.original)}>
            Edit
          </Button>
          <Button variant="danger-outline" size="xs" onClick={() => deletePolicy(row.original.id, row.original.name)}>
            Delete
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
          <Breadcrumbs.Item href="/jit/policies" label="JIT Policies" active />
        </Breadcrumbs>
        <h1>JIT Policies</h1>
        <Paragraph>Define classes of temporary access. Each policy owns a hidden backing group + access policy.</Paragraph>
        {!propagationEnabled && (
          <Callout variant="warning" className="max-w-2xl mt-4">
            User-group propagation is disabled in account settings — JIT grants won&apos;t reach peers until you enable{" "}
            <code>groups_propagation_enabled</code>.
          </Callout>
        )}
      </div>

      <RestrictedAccess hasAccess={isOwnerOrAdmin} page="JIT Policies">
        <div className="p-default flex justify-end mb-3">
          <Button variant="primary" size="sm" onClick={openCreate}>
            <PlusCircleIcon size={16} />
            Create JIT policy
          </Button>
        </div>
        <div className="p-default">
          <DataTable
            columns={columns}
            data={policies ?? []}
            text="JIT policies"
            getStartedCard={
              <div className="text-center py-10 text-nb-gray-400 flex flex-col items-center gap-2">
                <ShieldCheckIcon size={28} />
                <span>No JIT policies yet. Create one to offer temporary access.</span>
              </div>
            }
          />
        </div>
      </RestrictedAccess>

      <JitPolicyModal open={open} onOpenChange={setOpen} policy={editing} />
    </PageContainer>
  );
}
