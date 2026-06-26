import Badge from "@components/Badge";
import dayjs from "dayjs";
import * as React from "react";
import type { GrantStatus } from "../interfaces/Jit";

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;

const STATUS_VARIANT: Record<GrantStatus, BadgeVariant> = {
  pending: "yellow",
  approved: "blue",
  active: "green",
  expired: "gray",
  denied: "red",
  revoked: "red",
  cancelled: "gray",
  failed: "red",
};

export function JitStatusBadge({ status }: { status: GrantStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  const days = minutes / 1440;
  return Number.isInteger(days) ? `${days}d` : `${(minutes / 60).toFixed(0)}h`;
}

export function timeRemaining(expiresAt?: string): string {
  return expiresAt ? dayjs(expiresAt).fromNow() : "—";
}

export function formatDateTime(iso?: string): string {
  return iso ? dayjs(iso).format("MMM D, YYYY HH:mm") : "—";
}
