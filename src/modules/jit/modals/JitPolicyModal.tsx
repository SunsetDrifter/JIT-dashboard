"use client";

import Button from "@components/Button";
import FancyToggleSwitch from "@components/FancyToggleSwitch";
import HelpText from "@components/HelpText";
import { Input } from "@components/Input";
import { Label } from "@components/Label";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@components/modal/Modal";
import ModalHeader from "@components/modal/ModalHeader";
import { PeerGroupSelector } from "@components/PeerGroupSelector";
import { Textarea } from "@components/Textarea";
import { cn } from "@utils/helpers";
import { CheckIcon, Clock3Icon, ServerIcon, ShieldCheckIcon } from "lucide-react";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useGroups } from "@/contexts/GroupsProvider";
import type { Group } from "@/interfaces/Group";
import type { CreateJitPolicyBody, JitPolicy } from "../interfaces/Jit";
import { useJit } from "../JitProvider";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: JitPolicy; // present = edit
};

export function JitPolicyModal({ open, onOpenChange, policy }: Props) {
  const { resources, createPolicy, updatePolicy } = useJit();
  const { groups } = useGroups();
  const isEdit = !!policy;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [maxMinutes, setMaxMinutes] = useState("240");
  const [restrictRequesters, setRestrictRequesters] = useState(false);
  const [requesterGroups, setRequesterGroups] = useState<Group[]>([]);
  const [restrictApprovers, setRestrictApprovers] = useState(false);
  const [approverGroups, setApproverGroups] = useState<Group[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const resolveGroups = (ids: string[]): Group[] =>
    (groups ?? []).filter((g) => g.id && ids.includes(g.id));

  // (Re)initialise when the modal opens.
  useEffect(() => {
    if (!open) return;
    setName(policy?.name ?? "");
    setDescription(policy?.description ?? "");
    setResourceIds(policy?.targetResourceIds ?? []);
    setMaxMinutes(String(policy?.maxDurationMinutes ?? 240));
    const rb = policy?.requestableBy;
    setRestrictRequesters(rb?.mode === "groups");
    setRequesterGroups(rb?.mode === "groups" ? resolveGroups(rb.groupIds) : []);
    const ac = policy?.approverCriteria;
    setRestrictApprovers(ac?.mode === "groups");
    setApproverGroups(ac?.mode === "groups" ? resolveGroups(ac.groupIds) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, policy]);

  const max = parseInt(maxMinutes || "0", 10);
  const invalid = useMemo(() => {
    if (name.trim().length === 0) return true;
    if (resourceIds.length === 0) return true;
    if (!max || max < 1) return true;
    if (restrictRequesters && requesterGroups.length === 0) return true;
    if (restrictApprovers && approverGroups.length === 0) return true;
    return false;
  }, [name, resourceIds, max, restrictRequesters, requesterGroups, restrictApprovers, approverGroups]);

  const toggleResource = (id: string) =>
    setResourceIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const submit = async () => {
    if (invalid) return;
    const body: CreateJitPolicyBody = {
      name: name.trim(),
      description: description.trim() || undefined,
      targetResourceIds: resourceIds,
      maxDurationMinutes: max,
      requestableBy:
        restrictRequesters && requesterGroups.length
          ? { mode: "groups", groupIds: requesterGroups.map((g) => g.id as string) }
          : { mode: "all" },
      approverCriteria:
        restrictApprovers && approverGroups.length
          ? { mode: "groups", groupIds: approverGroups.map((g) => g.id as string) }
          : { mode: "any_admin" },
    };
    setSubmitting(true);
    try {
      if (isEdit && policy) await updatePolicy(policy.id, body);
      else await createPolicy(body);
      onOpenChange(false);
    } catch {
      /* notify surfaces the error */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent maxWidthClass="max-w-2xl">
        <ModalHeader
          icon={<ShieldCheckIcon size={18} />}
          title={isEdit ? "Edit JIT policy" : "Create JIT policy"}
          description="Define temporary access to network resources. JIT provisions a hidden backing group and access policy."
          color="netbird"
        />
        <div className="px-8 py-6 flex flex-col gap-6 max-h-[65vh] overflow-y-auto">
          <div>
            <Label>Name</Label>
            <Input placeholder="e.g. Prod database (break-glass)" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label>Description <span className="text-nb-gray-400">(optional)</span></Label>
            <Textarea placeholder="What this grants and when to use it" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div>
            <Label>Network resources</Label>
            <HelpText>Select the resources this access grants.</HelpText>
            <div className="flex flex-col gap-1.5 mt-1">
              {(resources ?? []).map((r) => {
                const selected = resourceIds.includes(r.id);
                return (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => toggleResource(r.id)}
                    className={cn(
                      "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border-netbird bg-netbird/10 text-netbird"
                        : "border-nb-gray-800 hover:border-nb-gray-700 text-nb-gray-200",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <ServerIcon size={14} /> {r.name}
                      {r.address ? <span className="text-nb-gray-400">({r.address})</span> : null}
                    </span>
                    {selected ? <CheckIcon size={15} /> : null}
                  </button>
                );
              })}
              {(resources ?? []).length === 0 && (
                <HelpText>No network resources found. Create some in Networks first.</HelpText>
              )}
            </div>
          </div>

          <div>
            <Label>Maximum duration</Label>
            <HelpText>The longest a user may request access for.</HelpText>
            <Input
              type="number"
              min={1}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(e.target.value)}
              customPrefix={<Clock3Icon size={16} className="text-nb-gray-300" />}
              customSuffix="minute(s)"
              maxWidthClass="max-w-[240px]"
            />
          </div>

          <FancyToggleSwitch
            value={restrictRequesters}
            onChange={setRestrictRequesters}
            label="Restrict who can request"
            helpText="Off: anyone may request. On: only members of the chosen user groups (IdP groups allowed)."
          >
            {restrictRequesters && (
              <div className="mt-3">
                <PeerGroupSelector values={requesterGroups} onChange={setRequesterGroups} hideAllGroup={true} />
              </div>
            )}
          </FancyToggleSwitch>

          <FancyToggleSwitch
            value={restrictApprovers}
            onChange={setRestrictApprovers}
            label="Restrict approvers to specific groups"
            helpText="Off: any admin/owner can approve. On: also members of the chosen groups."
          >
            {restrictApprovers && (
              <div className="mt-3">
                <PeerGroupSelector values={approverGroups} onChange={setApproverGroups} hideAllGroup={true} />
              </div>
            )}
          </FancyToggleSwitch>
        </div>
        <ModalFooter className="items-center">
          <div className="flex gap-3 w-full justify-end">
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button variant="primary" disabled={invalid || submitting} onClick={submit}>
              {isEdit ? "Save changes" : "Create JIT policy"}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
