"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { type FormEvent, useState } from "react";

const healthSignals = [
  "gate_blocked",
  "auth_denied",
  "dam_upload",
  "spend_cap",
  "job_lag",
] as const;

type HealthSignal = (typeof healthSignals)[number];
type KnownRuleKey =
  | "health.signals"
  | "margin.floor"
  | "llm.spend_cap"
  | "portal.allowed_contacts";
type Draft =
  | { ruleKey: "health.signals"; signals: HealthSignal[] }
  | { ruleKey: "margin.floor"; floorPct: string; targetPct: string }
  | { ruleKey: "llm.spend_cap"; monthlyAed: string }
  | {
      ruleKey: "portal.allowed_contacts";
      contacts: { email: string; clientId: string }[];
    };

const inputClass =
  "w-full rounded border border-sand bg-white px-3 py-2 text-sm text-ink disabled:opacity-60";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isKnownRuleKey(ruleKey: string): ruleKey is KnownRuleKey {
  return [
    "health.signals",
    "margin.floor",
    "llm.spend_cap",
    "portal.allowed_contacts",
  ].includes(ruleKey);
}

function ruleTitle(ruleKey: string) {
  if (ruleKey === "health.signals") return "Health signals";
  if (ruleKey === "margin.floor") return "Margin thresholds";
  if (ruleKey === "llm.spend_cap") return "AI monthly spend cap";
  if (ruleKey === "portal.allowed_contacts") return "Portal contacts";
  return ruleKey;
}

function createDraft(ruleKey: KnownRuleKey, payload: Record<string, unknown>): Draft {
  if (ruleKey === "health.signals") {
    const values = Array.isArray(payload.signals) ? payload.signals : [];
    return {
      ruleKey,
      signals: healthSignals.filter((signal) => values.includes(signal)),
    };
  }
  if (ruleKey === "margin.floor")
    return {
      ruleKey,
      floorPct: String(payload.floorPct ?? ""),
      targetPct: String(payload.targetPct ?? ""),
    };
  if (ruleKey === "llm.spend_cap")
    return { ruleKey, monthlyAed: String(payload.monthlyAed ?? "") };

  const contacts = isRecord(payload.contacts) ? payload.contacts : {};
  return {
    ruleKey,
    contacts: Object.entries(contacts).map(([email, clientId]) => ({
      email,
      clientId: typeof clientId === "string" ? clientId : "",
    })),
  };
}

function payloadForDraft(draft: Draft): Record<string, unknown> {
  if (draft.ruleKey === "health.signals") return { signals: draft.signals };
  if (draft.ruleKey === "margin.floor")
    return {
      floorPct: Number(draft.floorPct),
      targetPct: Number(draft.targetPct),
    };
  if (draft.ruleKey === "llm.spend_cap")
    return { monthlyAed: Number(draft.monthlyAed) };
  return {
    contacts: Object.fromEntries(
      draft.contacts.map(({ email, clientId }) => [
        email.trim().toLowerCase(),
        clientId.trim(),
      ]),
    ),
  };
}

function ConventionSummary({
  ruleKey,
  payload,
}: {
  ruleKey: string;
  payload: Record<string, unknown>;
}) {
  if (ruleKey === "health.signals") {
    const signals = Array.isArray(payload.signals) ? payload.signals : [];
    return (
      <p className="mt-2 text-sm text-muted">
        {signals.length ? signals.join(", ") : "No health signals enabled"}
      </p>
    );
  }
  if (ruleKey === "margin.floor")
    return (
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Floor</dt>
          <dd>{String(payload.floorPct ?? "—")}%</dd>
        </div>
        <div>
          <dt className="text-muted">Target</dt>
          <dd>{String(payload.targetPct ?? "—")}%</dd>
        </div>
      </dl>
    );
  if (ruleKey === "llm.spend_cap")
    return (
      <p className="mt-2 text-sm">
        <span className="text-muted">Monthly cap: </span>
        AED {String(payload.monthlyAed ?? "—")}
      </p>
    );
  if (ruleKey === "portal.allowed_contacts") {
    const contacts = isRecord(payload.contacts) ? payload.contacts : {};
    return Object.keys(contacts).length ? (
      <ul className="mt-2 space-y-1 text-sm">
        {Object.entries(contacts).map(([email, clientId]) => (
          <li key={email}>
            <span>{email}</span>
            <span className="text-muted"> · {String(clientId)}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-2 text-sm text-muted">No portal contacts invited.</p>
    );
  }
  return (
    <p className="mt-2 text-sm text-muted">
      Managed by its dedicated configuration module.
    </p>
  );
}

function ConventionEditor({
  draft,
  setDraft,
  error,
  pending,
  onCancel,
  onSave,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="mt-4 flex flex-col gap-4" onSubmit={onSave}>
      {draft.ruleKey === "health.signals" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Enabled signals</legend>
          {healthSignals.map((signal) => (
            <label key={signal} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.signals.includes(signal)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    signals: event.target.checked
                      ? [...draft.signals, signal]
                      : draft.signals.filter((value) => value !== signal),
                  })
                }
              />
              {signal}
            </label>
          ))}
        </fieldset>
      ) : null}

      {draft.ruleKey === "margin.floor" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Floor percent</span>
            <input
              className={inputClass}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={draft.floorPct}
              onChange={(event) =>
                setDraft({ ...draft, floorPct: event.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Target percent</span>
            <input
              className={inputClass}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={draft.targetPct}
              onChange={(event) =>
                setDraft({ ...draft, targetPct: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}

      {draft.ruleKey === "llm.spend_cap" ? (
        <label className="text-sm">
          <span className="mb-1 block font-medium">Monthly cap (AED)</span>
          <input
            className={inputClass}
            type="number"
            min="0.01"
            max="1000000000"
            step="0.01"
            required
            value={draft.monthlyAed}
            onChange={(event) =>
              setDraft({ ...draft, monthlyAed: event.target.value })
            }
          />
        </label>
      ) : null}

      {draft.ruleKey === "portal.allowed_contacts" ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Invited contacts</legend>
          {draft.contacts.map((contact, index) => (
            <div
              className="grid gap-2 rounded border border-sand p-3 sm:grid-cols-[1fr_1fr_auto]"
              key={index}
            >
              <label className="text-sm">
                <span className="mb-1 block">Email</span>
                <input
                  className={inputClass}
                  type="email"
                  required
                  value={contact.email}
                  onChange={(event) => {
                    const contacts = [...draft.contacts];
                    contacts[index] = { ...contact, email: event.target.value };
                    setDraft({ ...draft, contacts });
                  }}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block">Client ID</span>
                <input
                  className={inputClass}
                  required
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  title="Enter a valid UUID"
                  value={contact.clientId}
                  onChange={(event) => {
                    const contacts = [...draft.contacts];
                    contacts[index] = {
                      ...contact,
                      clientId: event.target.value,
                    };
                    setDraft({ ...draft, contacts });
                  }}
                />
              </label>
              <Button
                className="self-end"
                type="button"
                variant="ghost"
                aria-label={`Remove ${contact.email || "contact"}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    contacts: draft.contacts.filter((_, row) => row !== index),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setDraft({
                ...draft,
                contacts: [...draft.contacts, { email: "", clientId: "" }],
              })
            }
          >
            Add contact
          </Button>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function ConventionsPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const list = trpc.conventions.list.useQuery(undefined, { retry: false });
  const upsert = trpc.conventions.upsert.useMutation({
    onSuccess: () => void utils.conventions.list.invalidate(),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = Boolean(session.data?.canEditConventions);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    try {
      await upsert.mutateAsync({
        ruleKey: draft.ruleKey,
        payload: payloadForDraft(draft),
      });
      setDraft(null);
      setError(null);
      setNotice(`${ruleTitle(draft.ruleKey)} saved and audited.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save convention");
      setNotice(null);
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Conventions</h1>
        <p className="mt-1 text-muted">
          Rules-as-data. Director (or partner) can edit; each save bumps version
          and writes an audit row.
        </p>
      </div>
      {notice ? (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-col gap-4">
        {list.isLoading ? (
          <p className="text-sm text-muted">Loading conventions…</p>
        ) : null}
        {list.error ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{list.error.message}</p>
            <Button
              className="mt-3"
              type="button"
              variant="ghost"
              onClick={() => void list.refetch()}
            >
              Retry
            </Button>
          </section>
        ) : null}
        {!list.isLoading && !list.error && list.data?.length === 0 ? (
          <p className="rounded-lg border border-sand p-4 text-sm text-muted">
            No active conventions.
          </p>
        ) : null}
        {(list.data ?? []).map((row) => {
          const editableRuleKey = isKnownRuleKey(row.ruleKey)
            ? row.ruleKey
            : null;
          const editing = draft?.ruleKey === row.ruleKey;
          const titleId = `convention-${row.ruleKey.replaceAll(".", "-")}`;
          return (
            <section
              key={row.ruleKey}
              aria-labelledby={titleId}
              data-testid={`convention-${row.ruleKey}`}
              className="rounded-lg border border-sand bg-white/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id={titleId} className="font-medium">
                    {ruleTitle(row.ruleKey)}
                  </h2>
                  <p className="text-sm text-muted">
                    {row.ruleKey} · v{row.version}
                  </p>
                </div>
                {editableRuleKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDraft(createDraft(editableRuleKey, row.payload));
                      setError(null);
                      setNotice(null);
                    }}
                    disabled={!canEdit || upsert.isPending}
                    title={
                      canEdit
                        ? `Edit ${ruleTitle(row.ruleKey)}`
                        : "Editing requires convention:edit"
                    }
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
              {editing && draft ? (
                <ConventionEditor
                  draft={draft}
                  setDraft={setDraft}
                  error={error}
                  pending={upsert.isPending}
                  onCancel={() => {
                    setDraft(null);
                    setError(null);
                  }}
                  onSave={(event) => void save(event)}
                />
              ) : (
                <ConventionSummary ruleKey={row.ruleKey} payload={row.payload} />
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
