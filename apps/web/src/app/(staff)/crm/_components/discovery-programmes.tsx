"use client";

import { useEffect, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { CrmBtn, CrmEmpty, CrmTag } from "@/components/crm/ui";
import { CRM_MARKETS } from "@/lib/crm-markets";
import { previewDiscoverySchedule } from "@/lib/discovery-schedule";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/root";
import type {
  DiscoveryResearchNav,
  DiscoveryView,
} from "./discovery-research-nav";

type DiscoveryInput = inferRouterInputs<AppRouter>["salesOs"]["discovery"];
type ProgrammeDetail =
  inferRouterOutputs<AppRouter>["salesOs"]["discovery"]["programmes"]["get"];
type ProgrammeConfig =
  inferRouterOutputs<AppRouter>["salesOs"]["discovery"]["programmes"]["get"]["draft"]["config"];
type SourceDraft = NonNullable<
  DiscoveryInput["programmes"]["create"]["sources"]
>[number];

type Editor = {
  config: ProgrammeConfig;
  sources: SourceDraft[];
};

const list = <T extends string>(value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as T[];

const joined = (value: string[]) => value.join(", ");

const lines = <T extends string>(value: string) =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean) as T[];

const joinedLines = (value: string[], readable = false) =>
  value.map((item) => (readable ? humanize(item) : item)).join("\n");

const weekdays = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

const rotationWeekdays = weekdays.filter(
  (day) => day.value >= 1 && day.value <= 5,
);

const acquisitionLanes = [
  { value: "industry_scanning", label: "Industry scanning" },
  { value: "apollo_intent", label: "Apollo intent" },
  { value: "relationship_led", label: "Relationship-led introductions" },
] as const;

const connectionToolkitsByAdapter: Record<string, readonly string[]> = {
  apollo_api: ["apollo"],
  authorised_csv_upload: ["apollo"],
  licensed_search: ["linkedin", "composio:linkedin"],
  licensed_or_announcement: ["linkedin", "composio:linkedin"],
  authenticated_portal: ["tejari"],
};

const humanize = (value: string) => value.replaceAll("_", " ");

const formatDubai = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

function sourceTag(kind: string) {
  if (kind === "blocked" || kind === "error") return "danger" as const;
  if (kind === "candidate" || kind === "unverified") return "warn" as const;
  if (kind === "connected" || kind === "verified") return "success" as const;
  return "info" as const;
}

type DiscoveryProgrammesProps = {
  programmeId?: string | null;
  onNavigate?: (
    next: Partial<DiscoveryResearchNav> & { view?: DiscoveryView },
  ) => void;
};

export function DiscoveryProgrammes({
  programmeId = null,
  onNavigate,
}: DiscoveryProgrammesProps) {
  const utils = trpc.useUtils();
  const access = trpc.salesOs.access.useQuery();
  const connections = trpc.connections.list.useQuery({ scope: "staff" });
  const employees = trpc.work.members.listEmployees.useQuery();
  const manifest = trpc.salesOs.discovery.manifest.useQuery();
  const programmes = trpc.salesOs.discovery.programmes.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(programmeId);
  const [loadedProgrammeId, setLoadedProgrammeId] = useState<string | null>(
    null,
  );
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const selected = trpc.salesOs.discovery.programmes.get.useQuery(
    { programmeId: selectedId ?? "" },
    { enabled: Boolean(selectedId) },
  );
  useEffect(() => setSelectedId(programmeId), [programmeId]);
  const selectProgramme = (id: string | null) => {
    setSelectedId(id);
    onNavigate?.({ view: "programmes", programmeId: id });
  };
  const [editor, setEditor] = useState<Editor | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const hydrate = (programme: ProgrammeDetail) => {
    setEditor({
      config: programme.draft.config,
      sources: programme.draft.sources.map((source) => ({
        sourceKey: source.sourceKey,
        enabled: source.enabled,
        required: source.required,
        accountReferenceId: source.accountReferenceId,
        configuration: source.configuration,
      })),
    });
    setLoadedProgrammeId(programme.id);
    setLoadedVersion(programme.version);
    setIsDirty(false);
  };

  const resetToManifest = () => {
    if (!manifest.data) return;
    setSelectedId(null);
    setLoadedProgrammeId(null);
    setLoadedVersion(null);
    setIsDirty(true);
    setEditor({
      config: manifest.data.config,
      sources: manifest.data.sources.map((source) => ({
        sourceKey: source.sourceKey,
        enabled: source.enabled,
        required: source.required,
        accountReferenceId: source.accountReferenceId,
        configuration: source.configuration,
      })),
    });
    setNote("New draft prepared from the reviewed source manifest.");
  };

  useEffect(() => {
    if (!selected.data) return;
    if (selected.data.id !== loadedProgrammeId) hydrate(selected.data);
  }, [loadedProgrammeId, selected.data]);

  const refresh = async (programmeId?: string) => {
    await Promise.all([
      utils.salesOs.discovery.programmes.list.invalidate(),
      ...(programmeId
        ? [utils.salesOs.discovery.programmes.get.invalidate({ programmeId })]
        : []),
    ]);
  };

  const conflict = (error: { message: string }) => {
    setHasConflict(error.message.includes("PROGRAMME_VERSION_CONFLICT"));
    setNote(
      error.message.includes("PROGRAMME_VERSION_CONFLICT")
        ? "This programme changed elsewhere. Your unsaved changes remain here; reload the latest version before saving again."
        : error.message,
    );
  };

  const create = trpc.salesOs.discovery.programmes.create.useMutation({
    onSuccess: (programme) => {
      selectProgramme(programme.id);
      hydrate(programme);
      setNote(
        `Draft saved as version ${programme.draftVersion}. It does not start research.`,
      );
      void refresh(programme.id);
    },
    onError: conflict,
  });
  const saveDraft = trpc.salesOs.discovery.programmes.saveDraft.useMutation({
    onSuccess: (programme) => {
      hydrate(programme);
      setNote(
        `Draft saved as version ${programme.draftVersion}. It does not start research.`,
      );
      void refresh(programme.id);
    },
    onError: conflict,
  });
  const publish = trpc.salesOs.discovery.programmes.publish.useMutation({
    onSuccess: (programme) => {
      hydrate(programme);
      setNote(
        `Published version ${programme.publishedVersion}. ${programme.executionEnabled ? "Collectors can start from published criteria." : "Execution is not wired yet."}`,
      );
      void refresh(programme.id);
    },
    onError: conflict,
  });
  const pause = trpc.salesOs.discovery.programmes.pause.useMutation({
    onSuccess: (programme) => {
      hydrate(programme);
      setNote(
        `Programme paused at version ${programme.version}. No collector was started.`,
      );
      void refresh(programme.id);
    },
    onError: conflict,
  });
  const requestRun = trpc.salesOs.discovery.programmes.requestRun.useMutation({
    onSuccess: (result) => {
      setNote(
        `Run ${result.status}. ${detail?.executionEnabled ? "Collection can start." : "Collectors stay off until execution is enabled."}`,
      );
      void utils.salesOs.discovery.runs.invalidate();
      void utils.salesOs.discovery.programmes.invalidate();
      onNavigate?.({
        view: "runs",
        programmeId: detail?.id ?? selectedId,
        runId: result.runId,
      });
    },
    onError: (error) => setNote(error.message),
  });

  const busy =
    create.isPending ||
    saveDraft.isPending ||
    publish.isPending ||
    pause.isPending ||
    requestRun.isPending;
  const detail = selected.data;
  const canEdit = access.data?.canOperate === true;
  const canPublish = access.data?.canAdmin === true;
  const sources = detail?.draft.sources ?? manifest.data?.sources ?? [];
  const ownedConnections = (connections.data ?? []).filter(
    (connection) => connection.connectionAccountId,
  );
  const schedulePreview = (() => {
    if (!editor)
      return detail?.schedulePreview ?? manifest.data?.schedulePreview ?? [];
    try {
      return previewDiscoverySchedule(editor.config.schedule, new Date());
    } catch {
      return [];
    }
  })();

  const updateConfig = <K extends keyof ProgrammeConfig>(
    key: K,
    value: ProgrammeConfig[K],
  ) => {
    setIsDirty(true);
    setEditor((current) =>
      current
        ? { ...current, config: { ...current.config, [key]: value } }
        : current,
    );
  };

  const updateSource = (sourceKey: string, patch: Partial<SourceDraft>) => {
    setIsDirty(true);
    setEditor((current) =>
      current
        ? {
            ...current,
            sources: current.sources.map((source) =>
              source.sourceKey === sourceKey ? { ...source, ...patch } : source,
            ),
          }
        : current,
    );
  };

  const updateSourceConfiguration = (
    sourceKey: string,
    key: "url" | "feedUrl" | "notes",
    value: string,
  ) => {
    setIsDirty(true);
    setEditor((current) =>
      current
        ? {
            ...current,
            sources: current.sources.map((source) =>
              source.sourceKey === sourceKey
                ? {
                    ...source,
                    configuration: {
                      ...source.configuration,
                      [key]: value || undefined,
                    },
                  }
                : source,
            ),
          }
        : current,
    );
  };

  const updateWeekdays = (weekday: number, checked: boolean) => {
    if (!editor) return;
    const nextWeekdays = checked
      ? [...editor.config.schedule.weekdays, weekday].sort((a, b) => a - b)
      : editor.config.schedule.weekdays.filter((day) => day !== weekday);
    updateConfig("schedule", {
      ...editor.config.schedule,
      weekdays: nextWeekdays,
    });
  };

  const updateOwner = (ownerEmployeeId: string) => {
    setIsDirty(true);
    setEditor((current) =>
      current
        ? {
            ...current,
            config: {
              ...current.config,
              ownerEmployeeId,
              reviewerEmployeeIds: current.config.reviewerEmployeeIds.filter(
                (employeeId) => employeeId !== ownerEmployeeId,
              ),
            },
          }
        : current,
    );
  };

  const updateRotation = (
    index: number,
    patch: Partial<ProgrammeConfig["rotation"][number]>,
  ) => {
    if (!editor) return;
    updateConfig(
      "rotation",
      editor.config.rotation.map((rotation, rotationIndex) =>
        rotationIndex === index ? { ...rotation, ...patch } : rotation,
      ),
    );
  };

  const save = () => {
    if (!editor) return;
    if (detail && loadedVersion !== null) {
      saveDraft.mutate({
        programmeId: detail.id,
        expectedVersion: loadedVersion,
        ...editor,
      });
      return;
    }
    create.mutate(editor);
  };

  return (
    <section className="crm-panel mb-5" data-testid="discovery-programmes">
      <div className="crm-panel-head flex-wrap justify-between gap-3">
        <div>
          <h3>Research programmes & sources</h3>
          <p>
            Saved criteria are versioned. Publishing records configuration only;
            it does not start research.
          </p>
        </div>
        <CrmBtn
          onClick={resetToManifest}
          data-testid="discovery-new-programme"
          disabled={!manifest.data || busy || !canEdit}
        >
          New programme
        </CrmBtn>
      </div>
      <div className="crm-panel-body space-y-4">
        {manifest.error ? (
          <p role="alert">
            Programme setup could not load: {manifest.error.message}
          </p>
        ) : null}
        {access.data && !canEdit ? (
          <p className="crm-note">
            View-only access. A Sales operator can save drafts; only a Partner
            or Director can publish shared criteria.
          </p>
        ) : null}
        <div
          className="crm-approval-stack"
          aria-label="Saved research programmes"
        >
          {programmes.data?.length === 0 ? (
            <CrmEmpty
              title="No saved programmes"
              hint="Start from the reviewed HRMNY source manifest."
            />
          ) : null}
          {programmes.data?.map((programme) => (
            <button
              key={programme.id}
              type="button"
              className={`crm-approval-mini text-left ${selectedId === programme.id ? "is-focused" : ""}`}
              data-testid={`discovery-programme-${programme.id}`}
              onClick={() => {
                setNote(null);
                setHasConflict(false);
                setIsDirty(false);
                setLoadedProgrammeId(null);
                setLoadedVersion(null);
                selectProgramme(programme.id);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <strong>{programme.name}</strong>
                <CrmTag
                  kind={
                    programme.state === "active"
                      ? "success"
                      : programme.state === "paused"
                        ? "warn"
                        : "info"
                  }
                >
                  {programme.state === "active" && !programme.executionEnabled
                    ? "Published criteria"
                    : humanize(programme.state)}
                </CrmTag>
              </div>
              <p>{programme.purpose}</p>
              <p className="mt-2">
                Draft v{programme.draftVersion} · Published{" "}
                {programme.publishedVersion
                  ? `v${programme.publishedVersion}`
                  : "never"}{" "}
                · {programme.blockedSourceCount} source blocker
                {programme.blockedSourceCount === 1 ? "" : "s"}
                {programme.nextDueAt
                  ? ` · Next due ${formatDubai(programme.nextDueAt)}`
                  : ""}
              </p>
            </button>
          ))}
        </div>

        {!editor && manifest.isLoading ? (
          <p className="text-sm text-[var(--muted)]">
            Loading the reviewed source manifest…
          </p>
        ) : null}
        {editor ? (
          <form
            className="space-y-4 border-t border-[var(--line)] pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold">
                  {detail ? "Edit programme draft" : "New programme draft"}
                </h4>
                <p className="text-sm text-[var(--muted)]">
                  {detail
                    ? `Saved revision ${detail.version}. Changes take effect after publishing.`
                    : "Save your first draft."}
                </p>
              </div>
              {detail ? (
                <CrmTag kind="info">Draft v{detail.draftVersion}</CrmTag>
              ) : null}
            </div>
            <div className="crm-form-grid">
              <label className="crm-field">
                Name
                <input
                  className="crm-input"
                  data-testid="discovery-programme-name"
                  required
                  maxLength={180}
                  value={editor.config.name}
                  onChange={(event) => updateConfig("name", event.target.value)}
                />
              </label>
              <label className="crm-field">
                Purpose
                <input
                  className="crm-input"
                  required
                  maxLength={1000}
                  value={editor.config.purpose}
                  onChange={(event) =>
                    updateConfig("purpose", event.target.value)
                  }
                />
              </label>
              <fieldset className="crm-field">
                <legend>Markets</legend>
                <div className="flex flex-wrap gap-3">
                  {CRM_MARKETS.map((market) => (
                    <label key={market} className="text-sm">
                      <input
                        type="checkbox"
                        checked={editor.config.markets.includes(market)}
                        disabled={
                          !canEdit ||
                          (editor.config.markets.length === 1 &&
                            editor.config.markets.includes(market))
                        }
                        onChange={(event) =>
                          updateConfig(
                            "markets",
                            event.target.checked
                              ? [...editor.config.markets, market]
                              : editor.config.markets.filter(
                                  (current) => current !== market,
                                ),
                          )
                        }
                      />{" "}
                      {market}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="crm-field">
                Primary sectors (comma separated)
                <input
                  className="crm-input"
                  value={joined(editor.config.primarySectors)}
                  onChange={(event) =>
                    updateConfig("primarySectors", list(event.target.value))
                  }
                />
              </label>
              <label className="crm-field wide">
                Opportunity types
                <textarea
                  className="crm-textarea"
                  aria-describedby="discovery-opportunity-types-help"
                  value={joinedLines(editor.config.opportunityTypes, true)}
                  onChange={(event) =>
                    updateConfig("opportunityTypes", lines(event.target.value))
                  }
                />
                <span
                  id="discovery-opportunity-types-help"
                  className="text-sm text-[var(--muted)]"
                >
                  One type per line, for example “agency review”.
                </span>
              </label>
              <label className="crm-field wide">
                Questions
                <textarea
                  className="crm-textarea"
                  aria-describedby="discovery-questions-help"
                  value={joinedLines(editor.config.questions)}
                  onChange={(event) =>
                    updateConfig("questions", lines(event.target.value))
                  }
                />
                <span
                  id="discovery-questions-help"
                  className="text-sm text-[var(--muted)]"
                >
                  One question per line. Commas stay part of the question.
                </span>
              </label>
              <label className="crm-field">
                News freshness (days)
                <input
                  className="crm-input"
                  type="number"
                  min={1}
                  value={editor.config.freshness.newsDays}
                  onChange={(event) =>
                    updateConfig("freshness", {
                      ...editor.config.freshness,
                      newsDays: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="crm-field">
                Job freshness (days)
                <input
                  className="crm-input"
                  type="number"
                  min={1}
                  value={editor.config.freshness.jobsDays}
                  onChange={(event) =>
                    updateConfig("freshness", {
                      ...editor.config.freshness,
                      jobsDays: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="crm-field">
                Leadership freshness (days)
                <input
                  className="crm-input"
                  type="number"
                  min={1}
                  value={editor.config.freshness.leadershipDays}
                  onChange={(event) =>
                    updateConfig("freshness", {
                      ...editor.config.freshness,
                      leadershipDays: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>

            <details>
              <summary className="cursor-pointer">
                Ownership, review and acquisition lanes
              </summary>
              <div className="crm-form-grid mt-3">
                <label className="crm-field">
                  Programme owner
                  <select
                    className="crm-select"
                    value={editor.config.ownerEmployeeId}
                    disabled={!canEdit}
                    onChange={(event) => updateOwner(event.target.value)}
                  >
                    {!employees.data?.some(
                      (employee) =>
                        employee.employeeId === editor.config.ownerEmployeeId,
                    ) ? (
                      <option value={editor.config.ownerEmployeeId}>
                        Current programme owner
                      </option>
                    ) : null}
                    {(employees.data ?? []).map((employee) => (
                      <option
                        key={employee.employeeId}
                        value={employee.employeeId}
                      >
                        {employee.displayLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="crm-field wide">
                  <legend>Reviewers</legend>
                  <p className="mb-2 text-sm text-[var(--muted)]">
                    Select up to 10 active teammates. This records review
                    responsibility; it does not grant access.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {(employees.data ?? []).map((employee) => {
                      const selectedReviewer =
                        editor.config.reviewerEmployeeIds.includes(
                          employee.employeeId,
                        );
                      const isOwner =
                        employee.employeeId === editor.config.ownerEmployeeId;
                      return (
                        <label key={employee.employeeId} className="text-sm">
                          <input
                            type="checkbox"
                            checked={selectedReviewer}
                            disabled={
                              !canEdit ||
                              isOwner ||
                              (!selectedReviewer &&
                                editor.config.reviewerEmployeeIds.length >= 10)
                            }
                            onChange={(event) =>
                              updateConfig(
                                "reviewerEmployeeIds",
                                event.target.checked
                                  ? [
                                      ...editor.config.reviewerEmployeeIds,
                                      employee.employeeId,
                                    ]
                                  : editor.config.reviewerEmployeeIds.filter(
                                      (employeeId) =>
                                        employeeId !== employee.employeeId,
                                    ),
                              )
                            }
                          />{" "}
                          {employee.displayLabel}
                          {isOwner ? " (owner)" : ""}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset className="crm-field wide">
                  <legend>Acquisition lanes</legend>
                  <div className="flex flex-wrap gap-3">
                    {acquisitionLanes.map((lane) => (
                      <label key={lane.value} className="text-sm">
                        <input
                          type="checkbox"
                          checked={editor.config.acquisitionLanes.includes(
                            lane.value,
                          )}
                          disabled={
                            !canEdit ||
                            (editor.config.acquisitionLanes.length === 1 &&
                              editor.config.acquisitionLanes.includes(
                                lane.value,
                              ))
                          }
                          onChange={(event) =>
                            updateConfig(
                              "acquisitionLanes",
                              event.target.checked
                                ? [
                                    ...editor.config.acquisitionLanes,
                                    lane.value,
                                  ]
                                : editor.config.acquisitionLanes.filter(
                                    (current) => current !== lane.value,
                                  ),
                            )
                          }
                        />{" "}
                        {lane.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </details>

            <details>
              <summary className="cursor-pointer">Advanced criteria</summary>
              <div className="crm-form-grid mt-3">
                <label className="crm-field wide">
                  Inclusion rules
                  <textarea
                    className="crm-textarea"
                    aria-describedby="discovery-inclusion-rules-help"
                    value={joinedLines(editor.config.inclusionRules)}
                    onChange={(event) =>
                      updateConfig("inclusionRules", lines(event.target.value))
                    }
                  />
                  <span
                    id="discovery-inclusion-rules-help"
                    className="text-sm text-[var(--muted)]"
                  >
                    One rule per line. Commas stay part of the rule.
                  </span>
                </label>
                <label className="crm-field wide">
                  Exclusion rules
                  <textarea
                    className="crm-textarea"
                    aria-describedby="discovery-exclusion-rules-help"
                    value={joinedLines(editor.config.exclusionRules)}
                    onChange={(event) =>
                      updateConfig("exclusionRules", lines(event.target.value))
                    }
                  />
                  <span
                    id="discovery-exclusion-rules-help"
                    className="text-sm text-[var(--muted)]"
                  >
                    One rule per line. Commas stay part of the rule.
                  </span>
                </label>
                <label className="crm-field wide">
                  Secondary sectors
                  <input
                    className="crm-input"
                    value={joined(editor.config.secondarySectors)}
                    onChange={(event) =>
                      updateConfig("secondarySectors", list(event.target.value))
                    }
                  />
                </label>
              </div>
            </details>

            <details>
              <summary className="cursor-pointer">
                Schedule, sector rotation and run limits
              </summary>
              <div className="crm-form-grid mt-3">
                <label className="crm-field">
                  Dubai start time
                  <input
                    className="crm-input"
                    type="time"
                    value={editor.config.schedule.localTime}
                    onChange={(event) =>
                      updateConfig("schedule", {
                        ...editor.config.schedule,
                        localTime: event.target.value,
                      })
                    }
                  />
                </label>
                <fieldset className="crm-field wide">
                  <legend>Run days</legend>
                  <div className="flex flex-wrap gap-3">
                    {weekdays.map((day) => (
                      <label key={day.value} className="text-sm">
                        <input
                          type="checkbox"
                          checked={editor.config.schedule.weekdays.includes(
                            day.value,
                          )}
                          disabled={
                            !canEdit ||
                            (editor.config.schedule.weekdays.length === 1 &&
                              editor.config.schedule.weekdays.includes(
                                day.value,
                              ))
                          }
                          onChange={(event) =>
                            updateWeekdays(day.value, event.target.checked)
                          }
                        />{" "}
                        {day.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="crm-field">
                  Desired companies: minimum
                  <input
                    className="crm-input"
                    type="number"
                    min={0}
                    max={200}
                    value={editor.config.limits.desiredCompaniesMin}
                    onChange={(event) =>
                      updateConfig("limits", {
                        ...editor.config.limits,
                        desiredCompaniesMin: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="crm-field">
                  Desired companies: maximum
                  <input
                    className="crm-input"
                    type="number"
                    min={1}
                    max={200}
                    value={editor.config.limits.desiredCompaniesMax}
                    onChange={(event) =>
                      updateConfig("limits", {
                        ...editor.config.limits,
                        desiredCompaniesMax: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="crm-field">
                  Desired market signals: minimum
                  <input
                    className="crm-input"
                    type="number"
                    min={0}
                    max={100}
                    value={editor.config.limits.desiredMarketSignalsMin}
                    onChange={(event) =>
                      updateConfig("limits", {
                        ...editor.config.limits,
                        desiredMarketSignalsMin: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="crm-field">
                  Desired market signals: maximum
                  <input
                    className="crm-input"
                    type="number"
                    min={0}
                    max={100}
                    value={editor.config.limits.desiredMarketSignalsMax}
                    onChange={(event) =>
                      updateConfig("limits", {
                        ...editor.config.limits,
                        desiredMarketSignalsMax: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="crm-field">
                  Maximum observations per run
                  <input
                    className="crm-input"
                    type="number"
                    min={1}
                    max={200}
                    value={editor.config.limits.maxObservations}
                    onChange={(event) =>
                      updateConfig("limits", {
                        ...editor.config.limits,
                        maxObservations: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <div className="mt-4">
                <h5 className="font-semibold">Weekday sector rotation</h5>
                <p className="mb-2 text-sm text-[var(--muted)]">
                  Rotation guides eligible weekday work. It does not run or
                  restart research.
                </p>
                <div className="crm-approval-stack">
                  {editor.config.rotation.map((rotation, index) => (
                    <div
                      key={rotation.weekday}
                      className="crm-form-grid crm-approval-mini"
                    >
                      <label className="crm-field">
                        Weekday
                        <select
                          className="crm-select"
                          value={rotation.weekday}
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateRotation(index, {
                              weekday: Number(event.target.value) as
                                1 | 2 | 3 | 4 | 5,
                            })
                          }
                        >
                          {rotationWeekdays.map((day) => (
                            <option
                              key={day.value}
                              value={day.value}
                              disabled={editor.config.rotation.some(
                                (current, currentIndex) =>
                                  currentIndex !== index &&
                                  current.weekday === day.value,
                              )}
                            >
                              {day.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="crm-field">
                        Primary sector
                        <input
                          className="crm-input"
                          value={rotation.primarySector}
                          onChange={(event) =>
                            updateRotation(index, {
                              primarySector: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="crm-field">
                        Secondary focus
                        <input
                          className="crm-input"
                          value={rotation.secondaryFocus}
                          onChange={(event) =>
                            updateRotation(index, {
                              secondaryFocus: event.target.value,
                            })
                          }
                        />
                      </label>
                      <CrmBtn
                        disabled={
                          !canEdit || editor.config.rotation.length === 1
                        }
                        onClick={() =>
                          updateConfig(
                            "rotation",
                            editor.config.rotation.filter(
                              (_, rotationIndex) => rotationIndex !== index,
                            ),
                          )
                        }
                      >
                        Remove day
                      </CrmBtn>
                    </div>
                  ))}
                </div>
                {editor.config.rotation.length < rotationWeekdays.length ? (
                  <label className="crm-field mt-3">
                    Add rotation day
                    <select
                      className="crm-select"
                      value=""
                      disabled={!canEdit}
                      onChange={(event) => {
                        const weekday = Number(event.target.value);
                        if (!weekday) return;
                        updateConfig("rotation", [
                          ...editor.config.rotation,
                          {
                            weekday: weekday as 1 | 2 | 3 | 4 | 5,
                            primarySector:
                              editor.config.primarySectors[0] ??
                              "Primary sector",
                            secondaryFocus:
                              editor.config.secondarySectors[0] ??
                              "Secondary focus",
                          },
                        ]);
                      }}
                    >
                      <option value="">Choose a weekday</option>
                      {rotationWeekdays
                        .filter(
                          (day) =>
                            !editor.config.rotation.some(
                              (rotation) => rotation.weekday === day.value,
                            ),
                        )
                        .map((day) => (
                          <option key={day.value} value={day.value}>
                            {day.label}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </details>

            <div>
              <h4 className="mb-2 font-semibold">Source manifest</h4>
              <p className="mb-3 text-sm text-[var(--muted)]">
                Connection and capability come from verified server state. All
                manifest sources are retained; disabled sources are not removed.
                Saving a change does not test or enable a collector.
              </p>
              <div className="crm-approval-stack">
                {sources.map((source) => {
                  const draft = editor.sources.find(
                    (item) => item.sourceKey === source.sourceKey,
                  );
                  const sourceFields = manifest.data?.sources.find(
                    (item) => item.sourceKey === source.sourceKey,
                  )?.configuration;
                  const compatibleConnections = ownedConnections.filter(
                    (connection) =>
                      connection.connectionAccountId &&
                      connection.status === "connected" &&
                      (connectionToolkitsByAdapter[source.adapter]?.includes(
                        connection.toolkit,
                      ) ??
                        false),
                  );
                  const selectedConnection = ownedConnections.find(
                    (connection) =>
                      connection.connectionAccountId ===
                      draft?.accountReferenceId,
                  );
                  const selectedIsUnavailable =
                    draft?.accountReferenceId &&
                    !compatibleConnections.some(
                      (connection) =>
                        connection.connectionAccountId ===
                        draft.accountReferenceId,
                    );
                  return (
                    <details
                      key={source.sourceKey}
                      className="crm-approval-mini"
                      data-testid={`discovery-source-${source.sourceKey}`}
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                        <strong>{source.displayName}</strong>
                        <span className="flex flex-wrap gap-1">
                          <CrmTag kind={sourceTag(source.capabilityState)}>
                            {humanize(source.capabilityState)}
                          </CrmTag>
                          <CrmTag kind={sourceTag(source.connectionState)}>
                            {source.connectionState === "not_required"
                              ? "No account needed"
                              : humanize(source.connectionState)}
                          </CrmTag>
                        </span>
                      </summary>
                      <p>{source.statusReason}</p>
                      <p className="mt-1">
                        Last verified:{" "}
                        {source.lastSuccessAt ?? "not yet verified"} ·
                        Execution: unavailable
                      </p>
                      {draft ? (
                        <div className="crm-approval-actions">
                          <label className="text-sm">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(event) =>
                                updateSource(source.sourceKey, {
                                  enabled: event.target.checked,
                                })
                              }
                            />{" "}
                            Include
                          </label>
                          <label className="text-sm">
                            <input
                              type="checkbox"
                              checked={draft.required}
                              disabled={!canPublish}
                              onChange={(event) =>
                                updateSource(source.sourceKey, {
                                  required: event.target.checked,
                                })
                              }
                            />{" "}
                            Required coverage (published by Partner or Director)
                          </label>
                        </div>
                      ) : null}
                      {draft && source.connectionState !== "not_required" ? (
                        <label className="crm-field mt-3">
                          Connection
                          <select
                            className="crm-select"
                            disabled={!canEdit}
                            value={draft.accountReferenceId ?? ""}
                            onChange={(event) =>
                              updateSource(source.sourceKey, {
                                accountReferenceId: event.target.value || null,
                              })
                            }
                          >
                            <option value="">Choose an owned connection</option>
                            {selectedIsUnavailable ? (
                              <option
                                value={draft.accountReferenceId ?? ""}
                                disabled
                              >
                                {selectedConnection
                                  ? `${selectedConnection.label} is unavailable`
                                  : "Previously selected connection is unavailable"}
                              </option>
                            ) : null}
                            {compatibleConnections.map((connection) => (
                              <option
                                key={connection.connectionAccountId}
                                value={connection.connectionAccountId ?? ""}
                              >
                                {connection.label} ·{" "}
                                {humanize(connection.status)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {draft && sourceFields?.url !== undefined ? (
                        <label className="crm-field mt-3">
                          Source URL
                          <input
                            className="crm-input"
                            type="url"
                            value={draft.configuration.url ?? ""}
                            onChange={(event) =>
                              updateSourceConfiguration(
                                source.sourceKey,
                                "url",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ) : null}
                      {draft && sourceFields?.feedUrl !== undefined ? (
                        <label className="crm-field mt-3">
                          Feed URL
                          <input
                            className="crm-input"
                            type="url"
                            value={draft.configuration.feedUrl ?? ""}
                            onChange={(event) =>
                              updateSourceConfiguration(
                                source.sourceKey,
                                "feedUrl",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ) : null}
                      {draft && sourceFields?.notes !== undefined ? (
                        <label className="crm-field mt-3">
                          Configuration notes
                          <textarea
                            className="crm-textarea"
                            value={draft.configuration.notes ?? ""}
                            onChange={(event) =>
                              updateSourceConfiguration(
                                source.sourceKey,
                                "notes",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ) : null}
                    </details>
                  );
                })}
              </div>
            </div>

            <div className="crm-approval-actions">
              <CrmBtn
                type="submit"
                variant="primary"
                data-testid="discovery-save-draft"
                disabled={
                  !canEdit ||
                  busy ||
                  (detail !== undefined && loadedVersion === null)
                }
              >
                {busy ? "Saving…" : "Save draft"}
              </CrmBtn>
              {detail ? (
                <CrmBtn
                  data-testid="discovery-publish-programme"
                  disabled={
                    !canPublish || busy || loadedVersion === null || isDirty
                  }
                  onClick={() =>
                    loadedVersion !== null &&
                    publish.mutate({
                      programmeId: detail.id,
                      expectedVersion: loadedVersion,
                    })
                  }
                >
                  {detail.state === "paused"
                    ? "Publish & resume criteria"
                    : "Publish shared criteria"}
                </CrmBtn>
              ) : null}
              {detail && detail.state === "active" ? (
                <CrmBtn
                  data-testid="discovery-pause-programme"
                  disabled={
                    !canPublish || busy || loadedVersion === null || isDirty
                  }
                  onClick={() =>
                    loadedVersion !== null &&
                    pause.mutate({
                      programmeId: detail.id,
                      expectedVersion: loadedVersion,
                      reason: "Paused by an authorised operator",
                    })
                  }
                >
                  Pause programme
                </CrmBtn>
              ) : null}
              {detail && detail.state === "active" ? (
                <CrmBtn
                  data-testid="discovery-queue-run-now"
                  disabled={
                    !canEdit ||
                    busy ||
                    loadedVersion === null ||
                    isDirty ||
                    detail.executionEnabled !== true
                  }
                  onClick={() =>
                    loadedVersion !== null &&
                    requestRun.mutate({
                      programmeId: detail.id,
                      expectedVersion: loadedVersion,
                      requestId: crypto.randomUUID(),
                      overlap: "defer",
                    })
                  }
                >
                  Queue run now
                </CrmBtn>
              ) : null}
              {detail ? (
                <CrmBtn
                  disabled={busy}
                  onClick={() => {
                    void selected.refetch().then((result) => {
                      if (result.data) hydrate(result.data);
                      setHasConflict(false);
                      setNote(null);
                    });
                  }}
                >
                  {hasConflict
                    ? "Discard local changes & reload"
                    : "Reload latest"}
                </CrmBtn>
              ) : null}
            </div>
            {detail && isDirty ? (
              <p className="text-sm text-[var(--muted)]">
                Unsaved changes are in this form. Save the draft before
                publishing or pausing criteria.
              </p>
            ) : null}
            {note ? (
              <p
                className="crm-note"
                data-testid="discovery-programme-note"
                role="status"
              >
                {note}
              </p>
            ) : null}
            <div className="crm-note" data-testid="discovery-execution-status">
              <strong>
                Execution status:{" "}
                {detail?.executionEnabled ? "available" : "unavailable"}.
              </strong>{" "}
              {detail?.executionEnabled
                ? "Published criteria can start collectors."
                : "Collectors and provider calls stay off."}{" "}
              {detail?.nextDueAt
                ? `Armed next Dubai slot: ${formatDubai(detail.nextDueAt)}.`
                : "No run is armed yet."}
              {schedulePreview.length ? (
                <span>
                  {" "}
                  Next configured Dubai times:{" "}
                  {schedulePreview.map(formatDubai).join(" · ")}
                </span>
              ) : null}
            </div>
            {detail && !detail.readiness.ready ? (
              <p className="text-sm text-[var(--muted)]">
                Publish blockers:{" "}
                {detail.readiness.blockers
                  .map((blocker) => blocker.message)
                  .join(" · ")}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
