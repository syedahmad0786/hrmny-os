"use client";

import Link from "next/link";
import { useState } from "react";
import { DemoReadinessPanel } from "@/components/demo-readiness-panel";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";
import { trpc } from "@/lib/trpc";

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
  const importSalesGrowth = trpc.salesOs.importSalesGrowth.useMutation();
  const importIntent = trpc.salesOs.intentCsv.useMutation();
  const [dnc, setDnc] = useState("");
  const [csv, setCsv] = useState("");
  const [json, setJson] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const current = settings.data?.settings;

  return (
    <main data-testid="sales-os-settings" className="growth-settings">
      <Link href="/crm/hunt" className="growth-text-link">
        ← Back to Sales Growth
      </Link>
      <CrmPageHeader
        title="Sales Growth settings"
        description="Operating limits, suppression, connection diagnostics, and governed learning. Daily selling work stays on the Sales Growth page."
      />

      {digest.data ? (
        <div className="grid gap-2 md:grid-cols-4 mb-4">
          <div className="crm-metric">
            <span className="crm-metric-label">Companies to review</span>
            <strong>{digest.data.researchedWaiting}</strong>
          </div>
          <div className="crm-metric">
            <span className="crm-metric-label">People to review</span>
            <strong>{digest.data.contactsWaiting}</strong>
          </div>
          <div className="crm-metric">
            <span className="crm-metric-label">Pipeline coverage</span>
            <strong>{digest.data.coverage.coverageX.toFixed(1)}×</strong>
            <small>target {digest.data.coverage.targetX}×</small>
          </div>
          <div className="crm-metric">
            <span className="crm-metric-label">Needs attention</span>
            <strong>{digest.data.stalled.length}</strong>
          </div>
        </div>
      ) : null}

      <section className="crm-panel mb-4">
        <div className="crm-panel-head">
          <div>
            <h3>Operating limits</h3>
            <p>Hard ceilings keep the team in control.</p>
          </div>
        </div>
        <div className="crm-panel-body crm-form-grid">
          <label className="crm-field">
            Approved emails per day
            <input
              className="crm-input"
              type="number"
              defaultValue={current?.caps.emailPerDay}
              data-testid="sales-os-email-cap"
              onBlur={(event) =>
                save.mutate({
                  caps: { emailPerDay: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="crm-field">
            LinkedIn assists per week
            <input
              className="crm-input"
              type="number"
              defaultValue={current?.caps.linkedinConnectsPerWeek}
              onBlur={(event) =>
                save.mutate({
                  caps: { linkedinConnectsPerWeek: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="crm-field">
            Apollo enrichments per month
            <input
              className="crm-input"
              type="number"
              defaultValue={current?.caps.apolloContactsPerMonth}
              onBlur={(event) =>
                save.mutate({
                  caps: { apolloContactsPerMonth: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="crm-check-row">
            <input
              type="checkbox"
              checked={current?.caps.pauseAllOutreach ?? false}
              data-testid="sales-os-pause"
              onChange={(event) =>
                save.mutate({
                  caps: { pauseAllOutreach: event.target.checked },
                })
              }
            />
            Pause all outreach
          </label>
        </div>
      </section>

      <details className="growth-settings-detail">
        <summary>
          Connection diagnostics
          <span>Open when a provider needs attention</span>
        </summary>
        <div className="growth-settings-detail-body">
          <DemoReadinessPanel testIdPrefix="sales-os" />
          <p>
            Apollo People Search is a 0-credit read. The production connection
            test permits one People Match only; phone, personal-email, and both
            waterfall options are disabled. Gmail and LinkedIn remain human-send
            workflows—nothing here sends automatically.
          </p>
          <Link
            href="/settings/connections#conn-google_workspace"
            className="growth-text-link"
          >
            Google Workspace connection →
          </Link>
        </div>
      </details>

      <details className="growth-settings-detail">
        <summary>
          Compliance and suppression
          <span>Do-not-contact and no-go controls</span>
        </summary>
        <div className="growth-settings-detail-body">
          <p>{current?.icp.noGo.join(" · ")}</p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!dnc.includes("@")) return;
              addSuppression.mutate({ email: dnc, reason: "dnc" });
              setDnc("");
            }}
          >
            <input
              className="crm-input"
              placeholder="Add do-not-contact email"
              value={dnc}
              onChange={(event) => setDnc(event.target.value)}
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
      </details>

      <details className="growth-settings-detail">
        <summary>
          Weekly learning
          <span>Proposals never apply themselves</span>
        </summary>
        <div className="growth-settings-detail-body">
          <CrmBtn onClick={() => propose.mutate({})}>
            Propose weekly changes
          </CrmBtn>
          <div className="crm-approval-stack mt-3">
            {(proposals.data ?? []).length === 0 ? (
              <CrmEmpty
                title="No proposals"
                hint="Review after a week of outcomes."
              />
            ) : (
              (proposals.data ?? []).map((proposal) => (
                <article key={proposal.id} className="crm-approval-mini">
                  <CrmTag
                    kind={proposal.state === "proposed" ? "warn" : "info"}
                  >
                    {proposal.state}
                  </CrmTag>
                  <p>{proposal.summary}</p>
                  {proposal.state === "proposed" ? (
                    <div className="crm-approval-actions">
                      <CrmBtn
                        variant="primary"
                        onClick={() => apply.mutate({ id: proposal.id })}
                      >
                        Apply
                      </CrmBtn>
                      <CrmBtn
                        onClick={() => reject.mutate({ id: proposal.id })}
                      >
                        Reject
                      </CrmBtn>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </details>

      <details className="growth-settings-detail">
        <summary>
          Data imports and cutover
          <span>Administrative tools</span>
        </summary>
        <div className="growth-settings-detail-body">
          <div className="crm-split">
            <div className="crm-panel">
              <div className="crm-panel-head">
                <h3>Apollo intent CSV</h3>
              </div>
              <div className="crm-panel-body">
                <textarea
                  className="crm-textarea"
                  data-testid="sales-os-intent-csv"
                  value={csv}
                  onChange={(event) => setCsv(event.target.value)}
                  placeholder="company,domain,intent,employees"
                />
                <CrmBtn
                  className="mt-2"
                  onClick={() =>
                    importIntent
                      .mutateAsync({ csv })
                      .then((response) =>
                        setNote(
                          `Intent: ${response.created.length} created, ${response.skipped.length} skipped`,
                        ),
                      )
                  }
                >
                  Import intent leads
                </CrmBtn>
              </div>
            </div>
            <aside className="crm-panel">
              <div className="crm-panel-head">
                <h3>Historical JSON import</h3>
              </div>
              <div className="crm-panel-body">
                <p>
                  Dry-run first. Lineage keeps accepted re-imports idempotent.
                </p>
                <textarea
                  className="crm-textarea"
                  data-testid="sales-os-import-json"
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  placeholder='{"companies":[],"contacts":[]}'
                />
                <div className="crm-approval-actions mt-2">
                  <CrmBtn
                    onClick={() => {
                      try {
                        const data = JSON.parse(json);
                        importSalesGrowth
                          .mutateAsync({ data, apply: false })
                          .then((response) =>
                            setNote(
                              `Dry run: imported ${response.report.totals.imported} / skipped ${response.report.totals.skipped}`,
                            ),
                          );
                      } catch (error) {
                        setNote(
                          error instanceof Error
                            ? error.message
                            : "Invalid JSON",
                        );
                      }
                    }}
                  >
                    Dry run
                  </CrmBtn>
                  <CrmBtn
                    variant="primary"
                    onClick={() => {
                      try {
                        const data = JSON.parse(json);
                        importSalesGrowth
                          .mutateAsync({ data, apply: true })
                          .then((response) =>
                            setNote(
                              `Applied: imported ${response.report.totals.imported} / skipped ${response.report.totals.skipped}`,
                            ),
                          );
                      } catch (error) {
                        setNote(
                          error instanceof Error
                            ? error.message
                            : "Invalid JSON",
                        );
                      }
                    }}
                  >
                    Apply import
                  </CrmBtn>
                </div>
              </div>
            </aside>
          </div>
          <p>
            Supabase PostgreSQL remains the CRM source of truth. Legacy exports
            are imported with dry-run and lineage; legacy projects are not
            deleted by this screen.
          </p>
          <p>
            Source contract: {settings.data?.source.title ?? "Sales Growth SOP"}
            {settings.data
              ? ` · ${settings.data.source.version} · sector today ${settings.data.sectorToday}`
              : ""}
          </p>
        </div>
      </details>

      {note ? <p className="crm-note mt-4">{note}</p> : null}
    </main>
  );
}
