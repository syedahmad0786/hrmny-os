"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  STAGES,
  createCrmSeed,
  formatAed,
  formatLane,
  formatRelative,
  initials,
  type DeskDeal,
} from "@/lib/crm-seed";

const TABS = [
  "pipeline",
  "deals",
  "companies",
  "contacts",
  "activities",
  "tasks",
  "outreach",
  "inbound",
  "seams",
  "quote",
] as const;

type Tab = (typeof TABS)[number];

const TAB_META: Record<Tab, [string, string]> = {
  pipeline: ["Pipeline", "Move opportunities through guarded stages."],
  deals: ["Deals", "Sortable commercial view of every opportunity."],
  companies: ["Companies", "One account record from prospect to client."],
  contacts: ["Contacts", "People linked to companies, deals and activity."],
  activities: ["Activity timeline", "Calls, meetings, emails and stage changes."],
  tasks: ["Sales tasks", "Follow-ups kept separate from production work."],
  outreach: ["Outreach drafts", "Human approval before any Gmail action."],
  inbound: ["Inbound leads", "Review interest before creating a deal."],
  seams: ["Email + calendar", "Connection status — never a fake inbox clone."],
  quote: ["Commercial panel", "Quote and guarded margin for the active deal."],
};

export function CrmApp() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [seed] = useState(() => createCrmSeed());
  const [deals, setDeals] = useState(seed.deals);
  const [tasks, setTasks] = useState(seed.tasks);
  const [activities, setActivities] = useState(seed.activities);
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [inboundCompany, setInboundCompany] = useState("");
  const [inboundEmail, setInboundEmail] = useState("");
  const [quoteDealId, setQuoteDealId] = useState(seed.deals[4]?.id ?? seed.deals[0]?.id ?? "");

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter(
      (d) =>
        d.company.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        d.lane.includes(q),
    );
  }, [deals, search]);

  function moveDeal(id: string, stage: string) {
    setDeals((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, stage, updatedAt: new Date().toISOString() }
          : d,
      ),
    );
    const deal = deals.find((d) => d.id === id);
    if (deal) {
      setActivities((prev) => [
        {
          id: `a-${Date.now()}`,
          type: "stage_change",
          subject: `Stage changed · ${deal.company}`,
          body: `Moved to ${stage.replace(/_/g, " ")}.`,
          dealId: id,
          companyId: deal.companyId,
          occurredAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  }

  function addDeal(companyName: string, lane = "relationship_led") {
    const id = `d-${Date.now()}`;
    const companyId = `c-${Date.now()}`;
    const deal: DeskDeal = {
      id,
      stage: "discover",
      name: "New opportunity",
      company: companyName,
      companyId,
      value: 0,
      temp: null,
      lane,
      owner: "AM",
      buaf: 0,
      emailVerified: false,
      updatedAt: new Date().toISOString(),
    };
    setDeals((prev) => [deal, ...prev]);
    setTab("pipeline");
  }

  const quoteDeal = deals.find((d) => d.id === quoteDealId) ?? deals[0];
  const [title, desc] = TAB_META[tab];

  return (
    <div className="desk-shell" style={{ minHeight: "100vh" }}>
      <aside className="desk-sidebar">
        <Link href="/" className="desk-brand">
          <span className="desk-brand-mark">
            <span>h</span>
          </span>
          hrmny <small>OS</small>
        </Link>
        <div className="desk-side-context">
          <span>Workspace</span>
          <strong>Creative Harmony</strong>
        </div>
        <p className="desk-nav-label">Operate</p>
        <nav className="desk-nav" aria-label="Primary">
          <Link href="/" className="desk-nav-btn">
            <span className="desk-nav-index">01</span>
            <span>Home</span>
            <span />
          </Link>
          <span className="desk-nav-btn active">
            <span className="desk-nav-index">02</span>
            <span>CRM</span>
            <span className="desk-nav-count">{deals.length}</span>
          </span>
          <Link href="/portal" className="desk-nav-btn">
            <span className="desk-nav-index">03</span>
            <span>Portal</span>
            <span />
          </Link>
        </nav>
        <div className="desk-sidebar-foot">
          <div className="desk-side-meta">
            Live desk · seeded from CRM memory
            <br />
            Full API: apps/web local :3000
          </div>
        </div>
      </aside>

      <div className="desk-workspace">
        <header className="desk-topbar">
          <div>
            <p className="text-[10px]" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>
              Staff desk
            </p>
            <p style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 }}>
              CRM redesign · live on Vercel
            </p>
          </div>
          <Link href="/" className="crm-btn" style={{ marginLeft: "auto" }}>
            ← Build desk
          </Link>
        </header>

        <div className="desk-content">
          <div className="crm-page">
            <header className="crm-page-header">
              <div>
                <p className="crm-eyebrow">CRM · Team only</p>
                <h1>{title}</h1>
                <p>{desc}</p>
              </div>
              {(tab === "pipeline" || tab === "deals") && (
                <div className="crm-header-actions">
                  <button
                    type="button"
                    className="crm-btn primary"
                    onClick={() => addDeal(`Prospect ${deals.length + 1}`)}
                  >
                    ＋ Create deal
                  </button>
                </div>
              )}
            </header>

            <nav className="crm-subnav" aria-label="CRM sections">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={tab === t ? "active" : undefined}
                  onClick={() => setTab(t)}
                  style={{
                    flex: "0 0 auto",
                    padding: "9px 12px",
                    border: 0,
                    borderRadius: 9,
                    background: tab === t ? "var(--ink)" : "transparent",
                    color: tab === t ? "var(--paper)" : "var(--muted)",
                    cursor: "pointer",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {TAB_META[t][0].split(" ")[0] === "Activity"
                    ? "Activities"
                    : TAB_META[t][0].split(" · ")[0]}
                </button>
              ))}
            </nav>

            {(tab === "pipeline" || tab === "deals") && (
              <div className="crm-filterbar">
                <input
                  placeholder="Search deals or companies"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="crm-view-switch">
                  <button
                    type="button"
                    className={tab === "pipeline" ? "active" : undefined}
                    onClick={() => setTab("pipeline")}
                  >
                    Board
                  </button>
                  <button
                    type="button"
                    className={tab === "deals" ? "active" : undefined}
                    onClick={() => setTab("deals")}
                  >
                    List
                  </button>
                </div>
              </div>
            )}

            {tab === "pipeline" && (
              <div className="crm-board-wrap">
                <div className="crm-board">
                  {STAGES.map((stage) => {
                    const col = filteredDeals.filter((d) => d.stage === stage.key);
                    return (
                      <section
                        key={stage.key}
                        className={`crm-column${dragOver === stage.key ? " drag-over" : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(stage.key);
                        }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = dragId ?? e.dataTransfer.getData("text/deal-id");
                          setDragOver(null);
                          if (id) moveDeal(id, stage.key);
                          setDragId(null);
                        }}
                      >
                        <div className="crm-column-head">
                          <strong>{stage.label}</strong>
                          <span>{col.length}</span>
                        </div>
                        {col.map((d) => (
                          <article
                            key={d.id}
                            className="crm-deal-card"
                            draggable
                            onDragStart={(e) => {
                              setDragId(d.id);
                              e.dataTransfer.setData("text/deal-id", d.id);
                            }}
                            onClick={() => {
                              setQuoteDealId(d.id);
                              setTab("quote");
                            }}
                          >
                            <div className="crm-deal-top">
                              <span className={`crm-temp-dot ${d.temp ?? ""}`} />
                              <span className={`crm-tag ${d.temp === "hot" ? "danger" : d.temp === "warm" ? "ochre" : "info"}`}>
                                {d.temp ?? "unset"}
                              </span>
                            </div>
                            <h4>{d.name}</h4>
                            <span className="company">{d.company}</span>
                            <div className="crm-deal-value">{formatAed(d.value)}</div>
                            <div className="crm-deal-meta">
                              <span>{formatLane(d.lane)}</span>
                              <span className="crm-initials">{d.owner}</span>
                            </div>
                            <div className="crm-deal-meta" style={{ border: 0, paddingTop: 7 }}>
                              <span>Updated {formatRelative(d.updatedAt)}</span>
                              <span>Open →</span>
                            </div>
                          </article>
                        ))}
                        {col.length === 0 && (
                          <div style={{ padding: "22px 8px", color: "var(--muted)", fontSize: 10, textAlign: "center" }}>
                            Drop a deal here
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "deals" && (
              <div className="crm-table-shell">
                <div className="crm-table-scroll">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Deal</th>
                        <th>Stage</th>
                        <th>BUAF</th>
                        <th>Lane</th>
                        <th>Value</th>
                        <th>Email</th>
                        <th>Owner</th>
                        <th>Next step</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDeals.map((d) => (
                        <tr
                          key={d.id}
                          onClick={() => {
                            setQuoteDealId(d.id);
                            setTab("quote");
                          }}
                        >
                          <td>
                            <div className="crm-company-cell">
                              <span className="crm-company-logo">{initials(d.company)}</span>
                              <span>
                                <strong>{d.name}</strong>
                                <small>{d.company}</small>
                              </span>
                            </div>
                          </td>
                          <td><span className="crm-tag info">{d.stage.replace(/_/g, " ")}</span></td>
                          <td>{d.buaf} / 4</td>
                          <td>{formatLane(d.lane)}</td>
                          <td><strong>{formatAed(d.value)}</strong></td>
                          <td>
                            <span className={`crm-tag ${d.emailVerified ? "success" : "warn"}`}>
                              {d.emailVerified ? "Verified" : "Unverified"}
                            </span>
                          </td>
                          <td><span className="crm-initials">{d.owner}</span></td>
                          <td>Updated {formatRelative(d.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crm-table-foot">{filteredDeals.length} deals · live desk seed</div>
              </div>
            )}

            {tab === "companies" && (
              <div className="crm-table-shell">
                <div className="crm-table-scroll">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Sector</th>
                        <th>Market</th>
                        <th>Website</th>
                        <th>Relationship</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seed.companies.map((c) => {
                        const linked = deals.filter((d) => d.companyId === c.id);
                        const open = linked.filter((d) => !["close", "handover_pack"].includes(d.stage) || d.value > 0);
                        return (
                          <tr key={c.id}>
                            <td>
                              <div className="crm-company-cell">
                                <span className="crm-company-logo">{initials(c.name)}</span>
                                <span>
                                  <strong>{c.name}</strong>
                                  <small>{c.notes ?? "—"}</small>
                                </span>
                              </div>
                            </td>
                            <td>{c.sector}</td>
                            <td>{c.market}</td>
                            <td>{c.website ? "Site" : "—"}</td>
                            <td>{open.length ? `${open.length} open deal${open.length === 1 ? "" : "s"}` : "No open deals"}</td>
                            <td>
                              <span className={`crm-tag ${open.length ? "ochre" : "info"}`}>
                                {open.length ? "In pipeline" : "Prospect"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="crm-table-foot">{seed.companies.length} company records</div>
              </div>
            )}

            {tab === "contacts" && (
              <div className="crm-table-shell">
                <div className="crm-table-scroll">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Company</th>
                        <th>Title</th>
                        <th>Email</th>
                        <th>Enrichment</th>
                        <th>Deals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seed.contacts.map((c) => {
                        const company = seed.companies.find((x) => x.id === c.companyId);
                        const dealCount = deals.filter((d) => d.companyId === c.companyId).length;
                        return (
                          <tr key={c.id}>
                            <td>
                              <div className="crm-company-cell">
                                <span className="crm-initials">{initials(c.name)}</span>
                                <strong>{c.name}</strong>
                              </div>
                            </td>
                            <td>{company?.name ?? "—"}</td>
                            <td>{c.title}</td>
                            <td>{c.email}</td>
                            <td>
                              <span className={`crm-tag ${c.emailVerified ? "success" : "warn"}`}>
                                {c.emailVerified ? "Verified" : "Unverified"}
                              </span>
                            </td>
                            <td>{dealCount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="crm-table-foot">{seed.contacts.length} people</div>
              </div>
            )}

            {tab === "activities" && (
              <section className="crm-split">
                <div className="crm-panel">
                  <div className="crm-panel-head">
                    <div>
                      <h3>Activity stream</h3>
                      <p>Global timeline · newest first</p>
                    </div>
                  </div>
                  <div className="crm-panel-body">
                    <div className="crm-composer">
                      <span className="crm-initials">LB</span>
                      <input
                        placeholder="Log a note, call or meeting…"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        type="button"
                        className="crm-btn primary"
                        disabled={!note.trim()}
                        onClick={() => {
                          setActivities((prev) => [
                            {
                              id: `a-${Date.now()}`,
                              type: "note",
                              subject: note.trim(),
                              body: "Logged from CRM desk",
                              dealId: null,
                              companyId: null,
                              occurredAt: new Date().toISOString(),
                            },
                            ...prev,
                          ]);
                          setNote("");
                        }}
                      >
                        Log
                      </button>
                    </div>
                    <div className="crm-timeline">
                      {activities.map((a) => (
                        <div key={a.id} className="crm-timeline-item">
                          <span className="crm-timeline-dot" />
                          <div>
                            <h4>{a.subject}</h4>
                            <p>{a.body}</p>
                          </div>
                          <time>{formatRelative(a.occurredAt)}</time>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <aside className="crm-panel">
                  <div className="crm-panel-head"><h3>Activity mix</h3></div>
                  <div className="crm-panel-body">
                    <div className="crm-metric">
                      <span className="crm-metric-label">Loaded</span>
                      <strong>{activities.length}</strong>
                      <small>Across desk CRM records</small>
                    </div>
                  </div>
                </aside>
              </section>
            )}

            {tab === "tasks" && (
              <div className="crm-table-shell">
                <div className="crm-table-scroll">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Company</th>
                        <th>Status</th>
                        <th>Due</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td><strong>{t.title}</strong></td>
                          <td>{seed.companies.find((c) => c.id === t.companyId)?.name ?? "—"}</td>
                          <td><span className="crm-tag ochre">{t.status.replace(/_/g, " ")}</span></td>
                          <td>{t.dueDate ?? "—"}</td>
                          <td>
                            {t.status !== "done" && (
                              <button
                                type="button"
                                className="crm-btn ghost"
                                onClick={() =>
                                  setTasks((prev) =>
                                    prev.map((x) =>
                                      x.id === t.id ? { ...x, status: "done" } : x,
                                    ),
                                  )
                                }
                              >
                                Mark done
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "outreach" && (
              <section className="crm-split">
                <div className="crm-panel">
                  <div className="crm-panel-head">
                    <div>
                      <h3>Human approval queue</h3>
                      <p>No unattended auto-send</p>
                    </div>
                    <span className="crm-tag success">Kill switch armed</span>
                  </div>
                  <div className="crm-panel-body crm-approval-stack">
                    {[
                      ["Gmail draft", "JW Marriott Marquis Dubai", "A sharper launch for the next chapter"],
                      ["LinkedIn copy", "Emaar Hospitality Group", "Connection note for Omar"],
                    ].map(([ch, co, sub]) => (
                      <article key={sub} className="crm-approval-mini">
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="crm-tag ochre">{ch}</span>
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>{co}</span>
                        </div>
                        <h4>{sub}</h4>
                        <p>AI draft awaiting partner/AM approval before Gmail send.</p>
                        <div className="crm-approval-actions">
                          <button type="button" className="crm-btn primary">Approve draft</button>
                          <button type="button" className="crm-btn">Reject</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
                <aside className="crm-panel">
                  <div className="crm-panel-head"><h3>Channel rules</h3></div>
                  <div className="crm-panel-body">
                    <div className="crm-checklist">
                      <div className="crm-check-row">Gmail <span><span className="crm-tag warn">Approval required</span></span></div>
                      <div className="crm-check-row">LinkedIn <span><span className="crm-tag info">Copy only</span></span></div>
                      <div className="crm-check-row">Auto-send <span><span className="crm-tag danger">Disabled</span></span></div>
                    </div>
                  </div>
                </aside>
              </section>
            )}

            {tab === "inbound" && (
              <section className="crm-split">
                <div className="crm-panel">
                  <div className="crm-panel-head">
                    <div>
                      <h3>Capture lead</h3>
                      <p>Creates a discover-stage deal on this desk</p>
                    </div>
                  </div>
                  <div className="crm-panel-body">
                    <div className="crm-form-grid">
                      <div className="crm-field">
                        <label>Company</label>
                        <input className="crm-input" value={inboundCompany} onChange={(e) => setInboundCompany(e.target.value)} />
                      </div>
                      <div className="crm-field">
                        <label>Email</label>
                        <input className="crm-input" value={inboundEmail} onChange={(e) => setInboundEmail(e.target.value)} />
                      </div>
                      <div className="crm-field wide">
                        <button
                          type="button"
                          className="crm-btn primary"
                          disabled={!inboundCompany.trim()}
                          onClick={() => {
                            addDeal(inboundCompany.trim(), "relationship_led");
                            setInboundCompany("");
                            setInboundEmail("");
                          }}
                        >
                          Review + create deal
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <aside className="crm-panel">
                  <div className="crm-panel-head"><h3>Discover queue</h3></div>
                  <div className="crm-panel-body">
                    <div className="crm-checklist">
                      {deals.filter((d) => d.stage === "discover").map((d) => (
                        <div key={d.id} className="crm-check-row">
                          <strong>{d.company}</strong>
                          <span className="crm-tag info">{d.lane.replace(/_/g, " ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </section>
            )}

            {tab === "seams" && (
              <div className="crm-cards">
                {[
                  ["GM", "Gmail", "Connected", "Primary outbound channel"],
                  ["CA", "Google Calendar", "Connected", "Two-way meeting visibility"],
                  ["LI", "LinkedIn", "Draft only", "Copy-draft, manual paste in V1"],
                ].map(([mark, title, status, copy]) => (
                  <article key={title} className="crm-object-card">
                    <div className="crm-object-top">
                      <span className="crm-company-logo">{mark}</span>
                      <span className={`crm-tag ${status === "Connected" ? "success" : "info"}`}>{status}</span>
                    </div>
                    <h3>{title}</h3>
                    <p>{copy}. hrmny keeps the seam explicit instead of cloning the external product.</p>
                    <div className="crm-object-foot">
                      <span>Desk status</span>
                      <span style={{ color: "var(--ochre-dark)" }}>Open →</span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {tab === "quote" && quoteDeal && (
              <section className="crm-split">
                <div className="crm-panel">
                  <div className="crm-panel-head">
                    <div>
                      <h3>Quote · {quoteDeal.company}</h3>
                      <p>{quoteDeal.name} · {quoteDeal.stage}</p>
                    </div>
                    <span className="crm-tag">Live</span>
                  </div>
                  <div className="crm-panel-body">
                    <div className="crm-field" style={{ marginBottom: 14 }}>
                      <label>Active deal</label>
                      <select
                        className="crm-select"
                        value={quoteDeal.id}
                        onChange={(e) => setQuoteDealId(e.target.value)}
                      >
                        {deals.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.company} · {d.stage}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="crm-table-shell">
                      <div className="crm-table-scroll">
                        <table className="crm-table">
                          <thead>
                            <tr>
                              <th>Line item</th>
                              <th>Qty</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Quoted opportunity</td>
                              <td>1</td>
                              <td><strong>{formatAed(quoteDeal.value)}</strong></td>
                            </tr>
                            <tr>
                              <td>Vendor handling fee</td>
                              <td>20%</td>
                              <td><strong>{formatAed(Math.round(quoteDeal.value * 0.04))}</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
                <aside className="crm-panel">
                  <div className="crm-panel-head"><h3>Commercial controls</h3></div>
                  <div className="crm-panel-body">
                    <div className="crm-metric">
                      <span className="crm-metric-label">Quote total</span>
                      <strong>{formatAed(quoteDeal.value)}</strong>
                      <small>BUAF {quoteDeal.buaf} / 4 · email {quoteDeal.emailVerified ? "verified" : "open"}</small>
                    </div>
                    <div className="crm-note" style={{ marginTop: 12 }}>
                      Margin fields stay redacted on the public desk until apps/web role session is linked.
                    </div>
                  </div>
                </aside>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
