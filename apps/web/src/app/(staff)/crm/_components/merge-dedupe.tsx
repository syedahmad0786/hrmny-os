"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmTag } from "@/components/crm/ui";

/** W4 dedupe + merge: candidate groups, pick survivor, explicit confirm, refetch. */
export function MergeDuplicates({ kind }: { kind: "contacts" | "companies" }) {
  const utils = trpc.useUtils();
  const dedupe = trpc.crm.dedupe.candidates.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery(undefined, {
    enabled: kind === "contacts",
  });
  const companies = trpc.crm.companies.list.useQuery(undefined, {
    enabled: kind === "companies",
  });
  const mergeContacts = trpc.crm.merge.contacts.useMutation();
  const mergeCompanies = trpc.crm.merge.companies.useMutation();

  const [open, setOpen] = useState(false);
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups =
    kind === "contacts"
      ? (dedupe.data?.contacts ?? []).map((g) => ({
          key: g.key,
          ids: g.contactIds,
        }))
      : (dedupe.data?.companies ?? []).map((g) => ({
          key: g.key,
          ids: g.companyIds,
        }));

  const labelFor = (id: string): string => {
    if (kind === "contacts") {
      const c = (contacts.data ?? []).find((x) => x.contactId === id);
      if (!c) return id.slice(0, 8);
      const name = `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`;
      return c.email ? `${name} · ${c.email}` : name;
    }
    const co = (companies.data ?? []).find((x) => x.companyId === id);
    return co ? co.name : id.slice(0, 8);
  };

  const doMerge = async (group: { key: string; ids: string[] }) => {
    const survivorId = survivors[group.key] ?? group.ids[0]!;
    setMerging(true);
    setError(null);
    try {
      for (const duplicateId of group.ids.filter((id) => id !== survivorId)) {
        const res =
          kind === "contacts"
            ? await mergeContacts.mutateAsync({ survivorId, duplicateId })
            : await mergeCompanies.mutateAsync({ survivorId, duplicateId });
        if (!res.ok) throw new Error(res.reason);
      }
      setConfirming(null);
      await utils.crm.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="mb-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <CrmBtn
          variant="ghost"
          disabled={dedupe.isLoading}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {dedupe.isLoading
            ? "Duplicates…"
            : `Duplicates${groups.length > 0 ? ` · ${groups.length}` : ""}`}
        </CrmBtn>
        {dedupe.error ? (
          <small className="text-[10px] font-bold text-[var(--danger)]" role="alert">
            Could not load duplicate candidates: {dedupe.error.message}
          </small>
        ) : null}
      </div>
      {open && !dedupe.isLoading && !dedupe.error ? (
        <div className="crm-panel mt-2">
          <div className="crm-panel-head">
            <div>
              <h3>Potential duplicate {kind}</h3>
              <p>
                Pick the record to keep. Merging re-points linked records to the
                survivor and permanently deletes the duplicates.
              </p>
            </div>
          </div>
          <div className="crm-panel-body grid gap-[9px]">
            {groups.length === 0 ? (
              <p className="text-[11px] text-[var(--muted)]">
                No duplicate {kind} detected — every record has a unique{" "}
                {kind === "contacts" ? "email" : "domain or name"}.
              </p>
            ) : (
              groups.map((group) => {
                const survivorId = survivors[group.key] ?? group.ids[0]!;
                return (
                  <div key={group.key} className="crm-approval-mini">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-[11px]">{group.key}</strong>
                      <CrmTag kind="warn">{group.ids.length} records</CrmTag>
                    </div>
                    <div className="mt-2 grid gap-1">
                      {group.ids.map((id) => (
                        <label
                          key={id}
                          className="flex cursor-pointer items-center gap-2 text-[11px]"
                        >
                          <input
                            type="radio"
                            name={`survivor-${kind}-${group.key}`}
                            checked={survivorId === id}
                            disabled={merging}
                            onChange={() =>
                              setSurvivors((s) => ({ ...s, [group.key]: id }))
                            }
                          />
                          <span>{labelFor(id)}</span>
                          {survivorId === id ? (
                            <CrmTag kind="success">Keep</CrmTag>
                          ) : null}
                        </label>
                      ))}
                    </div>
                    {confirming === group.key ? (
                      <div className="crm-note" role="alertdialog">
                        Merge {group.ids.length - 1} duplicate
                        {group.ids.length - 1 === 1 ? "" : "s"} into “
                        {labelFor(survivorId)}”? Their deals, activities, notes
                        and tasks move to the survivor and the duplicate records
                        are permanently deleted. This cannot be undone.
                        <div className="crm-approval-actions">
                          <CrmBtn
                            variant="primary"
                            disabled={merging}
                            onClick={() => void doMerge(group)}
                          >
                            {merging ? "Merging…" : "Confirm merge"}
                          </CrmBtn>
                          <CrmBtn
                            disabled={merging}
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </CrmBtn>
                        </div>
                      </div>
                    ) : (
                      <div className="crm-approval-actions">
                        <CrmBtn
                          disabled={merging}
                          onClick={() => {
                            setConfirming(group.key);
                            setError(null);
                          }}
                        >
                          Merge into selected
                        </CrmBtn>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {error ? (
              <p className="text-[11px] font-bold text-[var(--danger)]" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
