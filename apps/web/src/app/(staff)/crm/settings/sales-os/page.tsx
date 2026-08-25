"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";

export default function SalesOsSettingsPage() {
  const utils = trpc.useUtils();
  const settings = trpc.salesOs.settings.get.useQuery();
  const digest = trpc.salesOs.digest.useQuery();
  const suppression = trpc.salesOs.suppression.list.useQuery();
  const proposals = trpc.salesOs.evolve.list.useQuery();
  const save = trpc.salesOs.settings.save.useMutation({
    onSuccess: () => void utils.salesOs.settings.invalidate(),
  });
  const addSuppression = trpc.salesOs.suppression.add.useMutation({
    onSuccess: () => void utils.salesOs.suppression.invalidate(),
  });
  const propose = trpc.salesOs.evolve.propose.useMutation({
    onSuccess: () => void utils.salesOs.evolve.invalidate(),
  });
  const apply = trpc.salesOs.evolve.accept.useMutation({
    onSuccess: () => {
      void utils.salesOs.evolve.invalidate();
      void utils.salesOs.settings.invalidate();
    },
  });
  const reject = trpc.salesOs.evolve.reject.useMutation({
    onSuccess: () => void utils.salesOs.evolve.invalidate(),
  });
  const importSg = trpc.salesOs.importSalesGrowth.useMutation();
  const intent = trpc.salesOs.intentCsv.useMutation();
  const [dnc, setDnc] = useState("");
  const [csv, setCsv] = useState("");
  const [json, setJson] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const s = settings.data?.settings;

  return (
    <main data-testid="sales-os-settings">
      <CrmPageHeader
        title="Sales OS"
        description="Replaces the Claude Sales & Growth slash commands. SOPs, caps, suppression, evolve, and historical import."
      />

      {settings.data ? (
        <p className="text-xs text-[var(--muted)] mb-4">
          Seeded from {settings.data.source.title} ({settings.data.source.version},{" "}
          {settings.data.source.date}). Sector today: {settings.data.sectorToday}.
        </p>
      ) : null}

      {digest.data ? (
        <div className="grid gap-2 md:grid-cols-4 mb-4">
          <div className="crm-metric">
            <span className="crm-metric-label">Gate 1 queue</span>
            <strong>{digest.data.researchedWaiting}</strong>
          </div>
          <div className="crm-metric">
            <span className="crm-metric-label">Gate 2 queue</span>
            <strong>{digest.data.contactsWaiting}</strong>
          </div>
          <div className="crm-metric">
            <span className="crm-metric-label">Coverage</span>
            <strong>{digest.data.coverage.coverageX.toFixed(1)}×</strong>
            <small>target {digest.data.coverage.targetX}×</small>
          </div>
          <div className="crm-metric">
            <span className="crm-metric-label">Stalled deals</span>
            <strong>{digest.data.stalled.length}</strong>
          </div>
        </div>
      ) : null}

      <section className="crm-panel mb-4">
        <div className="crm-panel-head">
          <h3>Caps + kill switch</h3>
        </div>
        <div className="crm-panel-body crm-form-grid">
          <label className="crm-field">
            Email / day
            <input
              className="crm-input"
              type="number"
              defaultValue={s?.caps.emailPerDay}
              data-testid="sales-os-email-cap"
              onBlur={(e) =>
                save.mutate({ caps: { emailPerDay: Number(e.target.value) } })
              }
            />
          </label>
          <label className="crm-field">
            LinkedIn assists / week
            <input
              className="crm-input"
              type="number"
              defaultValue={s?.caps.linkedinConnectsPerWeek}
              onBlur={(e) =>
                save.mutate({
                  caps: { linkedinConnectsPerWeek: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="crm-field">
            Apollo contacts / month
            <input
              className="crm-input"
              type="number"
              defaultValue={s?.caps.apolloContactsPerMonth}
              onBlur={(e) =>
                save.mutate({
                  caps: { apolloContactsPerMonth: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="crm-check-row">
            <input
              type="checkbox"
              checked={s?.caps.pauseAllOutreach ?? false}
              data-testid="sales-os-pause"
              onChange={(e) =>
                save.mutate({ caps: { pauseAllOutreach: e.target.checked } })
              }
            />
            Pause all outreach
          </label>
        </div>
      </section>

      <section className="crm-panel mb-4">
        <div className="crm-panel-head">
          <h3>No-go + suppression</h3>
        </div>
        <div className="crm-panel-body">
          <p className="text-sm mb-2">{s?.icp.noGo.join(" · ")}</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!dnc.includes("@")) return;
              addSuppression.mutate({ email: dnc, reason: "dnc" });
              setDnc("");
            }}
          >
            <input
              className="crm-input"
              placeholder="Add DNC email"
              value={dnc}
              onChange={(e) => setDnc(e.target.value)}
            />
            <CrmBtn type="submit">Add</CrmBtn>
          </form>
          <ul className="mt-3 text-sm">
            {(suppression.data ?? []).slice(0, 20).map((row) => (
              <li key={row.id}>
                {row.email ?? row.domain} · {row.reason}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="crm-panel mb-4">
        <div className="crm-panel-head">
          <h3>Reflect / evolve</h3>
          <CrmBtn onClick={() => propose.mutate({})}>Propose weekly changes</CrmBtn>
        </div>
        <div className="crm-panel-body">
          {(proposals.data ?? []).length === 0 ? (
            <CrmEmpty title="No proposals" hint="Run propose after a week of outcomes." />
          ) : (
            (proposals.data ?? []).map((p) => (
              <article key={p.id} className="crm-approval-mini">
                <CrmTag kind={p.state === "proposed" ? "warn" : "info"}>{p.state}</CrmTag>
                <p>{p.summary}</p>
                {p.state === "proposed" ? (
                  <div className="crm-approval-actions">
                    <CrmBtn variant="primary" onClick={() => apply.mutate({ id: p.id })}>
                      Apply
                    </CrmBtn>
                    <CrmBtn onClick={() => reject.mutate({ id: p.id })}>Reject</CrmBtn>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="crm-split">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <h3>Apollo intent CSV</h3>
          </div>
          <div className="crm-panel-body">
            <textarea
              className="crm-textarea"
              data-testid="sales-os-intent-csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="company,domain,intent,employees"
            />
            <CrmBtn
              className="mt-2"
              onClick={() =>
                intent.mutateAsync({ csv }).then((r) =>
                  setNote(`Intent: ${r.created.length} created, ${r.skipped.length} skipped`),
                )
              }
            >
              Import intent leads
            </CrmBtn>
          </div>
        </div>
        <aside className="crm-panel">
          <div className="crm-panel-head">
            <h3>June dashboard.db import</h3>
          </div>
          <div className="crm-panel-body">
            <p className="text-sm mb-2">
              Paste the JSON export from <code>parseSalesGrowthExport</code>. Dry-run
              first, then apply. Lineage keeps re-imports idempotent.
            </p>
            <textarea
              className="crm-textarea"
              data-testid="sales-os-import-json"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='{"companies":[],"contacts":[],...}'
            />
            <div className="crm-approval-actions mt-2">
              <CrmBtn
                onClick={() => {
                  try {
                    const data = JSON.parse(json);
                    importSg
                      .mutateAsync({ data, apply: false })
                      .then((r) =>
                        setNote(
                          `Dry run: imported ${r.report.totals.imported} / skipped ${r.report.totals.skipped}`,
                        ),
                      );
                  } catch (err) {
                    setNote(err instanceof Error ? err.message : "Invalid JSON");
                  }
                }}
              >
                Dry run
              </CrmBtn>
              <CrmBtn
                variant="primary"
                onClick={() => {
                  const data = JSON.parse(json);
                  importSg
                    .mutateAsync({ data, apply: true })
                    .then((r) =>
                      setNote(
                        `Applied: imported ${r.report.totals.imported} / skipped ${r.report.totals.skipped}`,
                      ),
                    );
                }}
              >
                Apply import
              </CrmBtn>
            </div>
          </div>
        </aside>
      </section>

      {note ? <p className="crm-note mt-4">{note}</p> : null}

      <section className="crm-panel mt-4">
        <div className="crm-panel-head">
          <h3>Cutover</h3>
        </div>
        <div className="crm-panel-body text-sm space-y-2">
          <p>
            Parallel-run this CRM module beside Claude Code for two weeks, then
            archive (do not delete) Vercel project <code>hrmny-sales-growth</code>.
            Asana “Lead Pipeline 2026” is no longer the deal system of record.
          </p>
          <p>
            Connect from Settings → Connections: Google Workspace, Apollo, Hunter,
            NeverBounce, OpenRouter. Do not connect LinkedIn MCP / Playwright.
          </p>
          <p>
            SPF / DKIM / DMARC on hrmny.co must be live before the first mailbox
            send. See docs/SALES-GROWTH-CUTOVER.md.
          </p>
        </div>
      </section>
    </main>
  );
}
