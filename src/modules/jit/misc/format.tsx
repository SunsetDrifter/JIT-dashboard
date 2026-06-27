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
  superseded: "gray",
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
  // >= 1 day: round to the nearest hour, then split into days + hours so the
  // unit never flips (e.g. 1500m → "1d 1h", not "25h").
  const totalHours = Math.round(minutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

export function timeRemaining(expiresAt?: string): string {
  return expiresAt ? dayjs(expiresAt).fromNow() : "—";
}

export function formatDateTime(iso?: string): string {
  return iso ? dayjs(iso).format("MMM D, YYYY HH:mm") : "—";
}
