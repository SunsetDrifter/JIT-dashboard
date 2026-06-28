"use client";

import Button from "@components/Button";
import HelpText from "@components/HelpText";
import { Input } from "@components/Input";
import { Label } from "@components/Label";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@components/modal/Modal";
import ModalHeader from "@components/modal/ModalHeader";
import { Clock3Icon } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import type { JitGrant } from "../interfaces/Jit";
import { useJit } from "../JitProvider";
import { formatDuration } from "../misc/format";

type Props = {
  grant: JitGrant;
  maxDurationMinutes: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function JitExtendModal({ grant, maxDurationMinutes, open, onOpenChange }: Props) {
  const { extendGrant } = useJit();
  const [minutes, setMinutes] = useState(String(Math.min(60, maxDurationMinutes)));
  const [submitting, setSubmitting] = useState(false);

  const value = parseInt(minutes || "0", 10);
  const invalid = !value || value < 1 || value > maxDurationMinutes;

  const submit = async () => {
    if (invalid) return;
    setSubmitting(true);
    try {
      await extendGrant(grant.id, value);
      onOpenChange(false);
    } catch {
      /* notify surfaces the error */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent maxWidthClass="max-w-md">
        <ModalHeader
          icon={<Clock3Icon size={18} />}
          title={`Extend access for ${grant.requesterEmail ?? grant.requesterUserId}`}
          description="Grant more time now. Access continues uninterrupted; the new window starts at approval."
          color="netbird"
        />
        <div className="px-8 py-6">
          <Label>New duration</Label>
          <HelpText>Up to a maximum of {formatDuration(maxDurationMinutes)}.</HelpText>
          <Input
            type="number"
            min={1}
            max={maxDurationMinutes}
            data-testid="jit-extend-duration"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            customPrefix={<Clock3Icon size={16} className="text-nb-gray-300" />}
            customSuffix="minute(s)"
            maxWidthClass="max-w-[240px]"
            error={invalid ? `Enter a value between 1 and ${maxDurationMinutes}` : undefined}
          />
        </div>
        <ModalFooter className="items-center">
          <div className="flex gap-3 w-full justify-end">
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button variant="primary" data-testid="jit-extend-submit" disabled={invalid || submitting} onClick={submit}>
              Extend access
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
