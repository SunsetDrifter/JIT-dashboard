import Badge from "@components/Badge";
import dayjs from "dayjs";
import * as React from "react";
import type { GrantStatus, JitGrant } from "../interfaces/Jit";

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
  return (
    <Badge variant={STATUS_VARIANT[status]} className="capitalize">
      {status}
    </Badge>
  );
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

/**
 * The approval outcome of a request (distinct from its current status): when it
 * was decided and whether it was approved or denied. Pending = not yet decided;
 * cancelled = withdrawn before any decision.
 */
export function JitOutcomeCell({ grant }: { grant: JitGrant }) {
  if (grant.status === "pending") return <span className="text-nb-gray-400">Awaiting decision</span>;
  if (grant.status === "cancelled") return <span className="text-nb-gray-400">Withdrawn</span>;
  const denied = grant.status === "denied";
  return (
    <span
      className="flex flex-col leading-tight"
      title={denied && grant.denialReason ? grant.denialReason : undefined}
    >
      <span className={denied ? "text-red-400" : "text-green-400"}>{denied ? "Denied" : "Approved"}</span>
      <span className="text-xs text-nb-gray-400">{formatDateTime(grant.decidedAt)}</span>
    </span>
  );
}
