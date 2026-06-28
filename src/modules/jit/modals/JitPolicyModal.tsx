"use client";

import Button from "@components/Button";
import FancyToggleSwitch from "@components/FancyToggleSwitch";
import HelpText from "@components/HelpText";
import { Input } from "@components/Input";
import { Label } from "@components/Label";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@components/modal/Modal";
import ModalHeader from "@components/modal/ModalHeader";
import { PeerGroupSelector } from "@components/PeerGroupSelector";
import { SelectDropdown } from "@components/select/SelectDropdown";
import { Textarea } from "@components/Textarea";
import { ServerIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useGroups } from "@/contexts/GroupsProvider";
import type { Group } from "@/interfaces/Group";
import type { CreateJitPolicyBody, JitPolicy } from "../interfaces/Jit";
import { useJit } from "../JitProvider";
import { JitDurationInput, durationToMinutes, minutesToDuration } from "../misc/JitDurationInput";

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
  const [maxAmount, setMaxAmount] = useState(() => minutesToDuration(240).amount);
  const [maxUnit, setMaxUnit] = useState(() => minutesToDuration(240).unit);
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
    const dur = minutesToDuration(policy?.maxDurationMinutes ?? 240);
    setMaxAmount(dur.amount);
    setMaxUnit(dur.unit);
    const rb = policy?.requestableBy;
    setRestrictRequesters(rb?.mode === "groups");
    setRequesterGroups(rb?.mode === "groups" ? resolveGroups(rb.groupIds) : []);
    const ac = policy?.approverCriteria;
    setRestrictApprovers(ac?.mode === "groups");
    setApproverGroups(ac?.mode === "groups" ? resolveGroups(ac.groupIds) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, policy]);

  const max = durationToMinutes(maxAmount, maxUnit);
  // Only groups that resolve to a real id count toward eligibility — the group
  // selector lets you type a brand-new name (no id), which is meaningless here.
  const requesterGroupIds = useMemo(
    () => requesterGroups.map((g) => g.id).filter((id): id is string => !!id),
    [requesterGroups],
  );
  const approverGroupIds = useMemo(
    () => approverGroups.map((g) => g.id).filter((id): id is string => !!id),
    [approverGroups],
  );
  // Real user groups to restrict by. The universal "All" group is excluded (it
  // isn't part of users' auto_groups, so it can't gate eligibility — "everyone"
  // is the toggle-off state); JIT's own backing groups are already hidden.
  const hasUserGroups = useMemo(() => (groups ?? []).some((g) => g.name !== "All"), [groups]);

  // Resource picker: the searchable "add" dropdown lists only unpicked resources;
  // picked ones render as removable chips below.
  const resourceOptions = useMemo(
    () =>
      (resources ?? [])
        .filter((r) => !resourceIds.includes(r.id))
        .map((r) => ({
          value: r.id,
          label: r.address ? `${r.name} (${r.address})` : r.name,
          searchValue: `${r.name} ${r.address ?? ""}`,
        })),
    [resources, resourceIds],
  );
  const selectedResources = useMemo(
    () => (resources ?? []).filter((r) => resourceIds.includes(r.id)),
    [resources, resourceIds],
  );

  const invalid = useMemo(() => {
    if (name.trim().length === 0) return true;
    if (resourceIds.length === 0) return true;
    if (!max || max < 1) return true;
    if (restrictRequesters && requesterGroupIds.length === 0) return true;
    if (restrictApprovers && approverGroupIds.length === 0) return true;
    return false;
  }, [name, resourceIds, max, restrictRequesters, requesterGroupIds, restrictApprovers, approverGroupIds]);

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
        restrictRequesters && requesterGroupIds.length
          ? { mode: "groups", groupIds: requesterGroupIds }
          : { mode: "all" },
      approverCriteria:
        restrictApprovers && approverGroupIds.length
          ? { mode: "groups", groupIds: approverGroupIds }
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
            <Input data-testid="jit-policy-name" placeholder="e.g. Prod database (break-glass)" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label>Description <span className="text-nb-gray-400">(optional)</span></Label>
            <Textarea data-testid="jit-policy-description" placeholder="What this grants and when to use it" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div>
            <Label>Network resources</Label>
            <HelpText>Search and add the resources this access grants.</HelpText>
            <div className="mt-1 flex flex-col gap-2">
              <SelectDropdown
                value=""
                onChange={(id) => toggleResource(id)}
                options={resourceOptions}
                showSearch
                placeholder="Add a network resource…"
                searchPlaceholder="Search resources…"
                data-testid="jit-resource-select"
              />
              {selectedResources.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {selectedResources.map((r) => (
                    <div
                      key={r.id}
                      data-testid="jit-resource-selected"
                      className="flex items-center justify-between rounded-md border border-nb-gray-800 bg-nb-gray-940 px-3 py-2 text-sm text-nb-gray-200"
                    >
                      <span className="flex items-center gap-2">
                        <ServerIcon size={14} /> {r.name}
                        {r.address ? <span className="text-nb-gray-400">({r.address})</span> : null}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${r.name}`}
                        data-testid="jit-resource-remove"
                        onClick={() => toggleResource(r.id)}
                        className="text-nb-gray-400 transition-colors hover:text-red-400"
                      >
                        <XIcon size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {(resources ?? []).length === 0 && (
                <HelpText>No network resources found. Create some in Networks first.</HelpText>
              )}
            </div>
          </div>

          <div>
            <Label>Maximum duration</Label>
            <HelpText>The longest a user may request access for.</HelpText>
            <JitDurationInput
              amount={maxAmount}
              unit={maxUnit}
              onAmountChange={setMaxAmount}
              onUnitChange={setMaxUnit}
              dataTestId="jit-policy-duration"
              error={max < 1 ? "Enter a duration of at least 1 minute" : undefined}
            />
          </div>

          <FancyToggleSwitch
            value={restrictRequesters}
            onChange={setRestrictRequesters}
            label="Restrict who can request"
            helpText="Off: anyone may request. On: only members of the chosen user groups — including IdP-synced groups. (JIT's own groups are never listed here.)"
          >
            {restrictRequesters && (
              <div className="mt-3">
                <PeerGroupSelector values={requesterGroups} onChange={setRequesterGroups} hideAllGroup={true} />
                {!hasUserGroups && (
                  <div className="mt-2">
                    <HelpText>
                      No user groups yet — create one under Team, or connect an identity provider. Leave this off to
                      allow everyone.
                    </HelpText>
                  </div>
                )}
              </div>
            )}
          </FancyToggleSwitch>

          <FancyToggleSwitch
            value={restrictApprovers}
            onChange={setRestrictApprovers}
            label="Restrict approvers to specific groups"
            helpText="Off: any admin/owner can approve. On: also members of the chosen user groups (IdP groups included)."
          >
            {restrictApprovers && (
              <div className="mt-3">
                <PeerGroupSelector values={approverGroups} onChange={setApproverGroups} hideAllGroup={true} />
                {!hasUserGroups && (
                  <div className="mt-2">
                    <HelpText>No user groups yet — create one under Team, or connect an identity provider.</HelpText>
                  </div>
                )}
              </div>
            )}
          </FancyToggleSwitch>
        </div>
        <ModalFooter className="items-center">
          <div className="flex gap-3 w-full justify-end">
            <ModalClose asChild>
              <Button variant="secondary" data-testid="jit-policy-cancel">Cancel</Button>
            </ModalClose>
            <Button variant="primary" data-testid="jit-policy-submit" disabled={invalid || submitting} onClick={submit}>
              {isEdit ? "Save changes" : "Create JIT policy"}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
