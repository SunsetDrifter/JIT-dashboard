"use client";

import { Input } from "@components/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/Select";
import { convertToSeconds, type TimeUnit } from "@hooks/useTimeFormatter";
import { CalendarClock } from "lucide-react";
import * as React from "react";

/** Units offered by JIT duration inputs (smallest → largest). */
export const JIT_DURATION_UNITS: TimeUnit[] = ["minutes", "hours", "days"];

const MINUTES_PER_UNIT: Record<TimeUnit, number> = {
  seconds: 1 / 60,
  minutes: 1,
  hours: 60,
  days: 1440,
};

const UNIT_LABEL: Record<string, string> = {
  seconds: "Seconds",
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

/** A whole-minute value → the largest unit that represents it without a fraction. */
export function minutesToDuration(
  minutes: number,
  units: TimeUnit[] = JIT_DURATION_UNITS,
): { amount: string; unit: TimeUnit } {
  const ascending = [...units].sort((a, b) => MINUTES_PER_UNIT[a] - MINUTES_PER_UNIT[b]);
  for (let i = ascending.length - 1; i >= 0; i--) {
    const unit = ascending[i];
    const per = MINUTES_PER_UNIT[unit];
    if (minutes >= per && minutes % per === 0) return { amount: String(minutes / per), unit };
  }
  return { amount: String(minutes), unit: ascending[0] };
}

/** An (amount, unit) pair → whole minutes (mirrors the Settings convertToSeconds path). */
export function durationToMinutes(amount: string, unit: TimeUnit): number {
  return Math.round(convertToSeconds(amount, unit) / 60);
}

type Props = {
  amount: string;
  unit: TimeUnit;
  onAmountChange: (amount: string) => void;
  onUnitChange: (unit: TimeUnit) => void;
  units?: TimeUnit[];
  min?: number;
  disabled?: boolean;
  error?: string;
  dataTestId?: string;
};

/**
 * Number + unit (Minutes/Hours/Days) duration picker, mirroring the
 * Settings → Authentication → Session Expiration control. The parent owns the
 * amount + unit state and converts to minutes via durationToMinutes() on submit.
 */
export function JitDurationInput({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
  units = JIT_DURATION_UNITS,
  min = 1,
  disabled,
  error,
  dataTestId,
}: Props) {
  // Largest unit first, matching the Session Expiration dropdown order.
  const ordered = [...units].sort((a, b) => MINUTES_PER_UNIT[b] - MINUTES_PER_UNIT[a]);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-3 max-w-[360px]">
        <Input
          type="number"
          min={min}
          className="w-full"
          maxWidthClass="min-w-[100px]"
          value={amount}
          disabled={disabled}
          data-testid={dataTestId}
          onChange={(e) => onAmountChange(e.target.value)}
        />
        <Select value={unit} disabled={disabled} onValueChange={(v) => onUnitChange(v as TimeUnit)}>
          <SelectTrigger className="w-full" data-testid={dataTestId ? `${dataTestId}-unit` : undefined}>
            <div className="flex items-center gap-3">
              <CalendarClock size={15} className="text-nb-gray-300" />
              <SelectValue placeholder="Select unit..." />
            </div>
          </SelectTrigger>
          <SelectContent>
            {ordered.map((u) => (
              <SelectItem key={u} value={u}>
                {UNIT_LABEL[u] ?? u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
