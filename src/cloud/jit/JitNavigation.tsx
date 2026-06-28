"use client";

import SidebarItem from "@/components/SidebarItem";
import { usePermissions } from "@/contexts/PermissionsProvider";
import { useLoggedInUser } from "@/contexts/UsersProvider";
import { ZapIcon } from "lucide-react";
import * as React from "react";

/**
 * Isolated Just-in-Time Access nav entry. Dropped once into Navigation.tsx
 * (one import + one element) — all other JIT code lives in src/modules/jit and
 * the jit-service backend.
 */
export const JitNavigation = () => {
  const { isOwnerOrAdmin } = useLoggedInUser();
  const { isRestricted } = usePermissions();

  return (
    <SidebarItem
      icon={<ZapIcon size={16} />}
      label="Just-in-Time"
      href={"/jit/request"}
      collapsible
      visible={!isRestricted}
    >
      <SidebarItem label="Request Access" isChild href={"/jit/request"} exactPathMatch visible={!isRestricted} />
      <SidebarItem label="JIT Policies" isChild href={"/jit/policies"} exactPathMatch visible={isOwnerOrAdmin} />
      <SidebarItem label="Approvals" isChild href={"/jit/approvals"} exactPathMatch visible={isOwnerOrAdmin} />
    </SidebarItem>
  );
};
