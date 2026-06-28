"use client";

import Button from "@components/Button";
import HelpText from "@components/HelpText";
import { Input } from "@components/Input";
import { Label } from "@components/Label";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@components/modal/Modal";
import ModalHeader from "@components/modal/ModalHeader";
import { Textarea } from "@components/Textarea";
import { Clock3Icon } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import type { EligiblePolicy } from "../interfaces/Jit";
import { useJit } from "../JitProvider";
import { formatDuration } from "../misc/format";

type Props = {
  policy: EligiblePolicy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "request" | "extend";
};

export function JitRequestModal({ policy, open, onOpenChange, mode = "request" }: Props) {
  const { requestAccess } = useJit();
  const [minutes, setMinutes] = useState(String(Math.min(60, policy.maxDurationMinutes)));
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const value = parseInt(minutes || "0", 10);
  const invalid = !value || value < 1 || value > policy.maxDurationMinutes;

  const submit = async () => {
    if (invalid) return;
    setSubmitting(true);
    try {
      await requestAccess(policy.id, value, justification.trim() || undefined);
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
          title={`${mode === "extend" ? "Extend" : "Request"}: ${policy.name}`}
          description={
            mode === "extend"
              ? "Request more time. Your current access continues uninterrupted until this is approved."
              : "Request temporary access. It expires automatically when the time is up."
          }
          color="netbird"
        />
        <div className="px-8 py-6 flex flex-col gap-5">
          <div>
            <Label>Duration</Label>
            <HelpText>Up to a maximum of {formatDuration(policy.maxDurationMinutes)}.</HelpText>
            <Input
              type="number"
              min={1}
              max={policy.maxDurationMinutes}
              data-testid="jit-request-duration"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              customPrefix={<Clock3Icon size={16} className="text-nb-gray-300" />}
              customSuffix="minute(s)"
              maxWidthClass="max-w-[240px]"
              error={invalid ? `Enter a value between 1 and ${policy.maxDurationMinutes}` : undefined}
            />
          </div>
          <div>
            <Label>
              Justification <span className="text-nb-gray-400">(optional)</span>
            </Label>
            <Textarea
              placeholder="Why do you need this access?"
              data-testid="jit-request-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <ModalFooter className="items-center">
          <div className="flex gap-3 w-full justify-end">
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button variant="primary" data-testid="jit-request-submit" disabled={invalid || submitting} onClick={submit}>
              {mode === "extend" ? "Submit extension" : "Submit request"}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
