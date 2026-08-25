# Sales & Growth → CRM cutover

**Replaces:** Claude Code CLI + Vercel `hrmny-sales-growth` (Ayham’s Sales & Growth loop)  
**Lives in:** hrmny OS CRM (`/crm/hunt`, `/crm/research`, `/crm/outreach`, `/crm/settings/sales-os`)  
**Rule:** AI proposes; the gate disposes. No autonomous send.

The Windows Claude project and Drive zip were not mounted at implementation time.
SOP defaults are seeded from *hrmny Sales & Growth System — Complete Documentation*
v3.0 (2026-02-27). Staff edit them in Sales OS; `/evolve` proposes diffs.

---

## Parallel run (two weeks)

1. Keep Claude Code + `https://hrmny-sales-growth.vercel.app` **read-only for new
   work** after the CRM module is used daily. Do not delete the Vercel project —
   archive it after the parallel window.
2. Run both for two weeks. New research, enrich, drafts, and sends happen only
   in the CRM. Claude is a fallback if a gate is blocked.
3. Import June `dashboard.db` / JSON via **CRM → Sales OS → June dashboard.db
   import** (dry-run first). Lineage keeps re-imports idempotent
   (`runSalesGrowthImport`).
4. After two clean weeks: archive (not delete) Vercel `hrmny-sales-growth`.
   Freeze the Claude project SOPs; the CRM settings row is the system of record.

## What is not the deal system of record

- **Asana “Lead Pipeline 2026”** — stop using it for stages. Work/Asana stays
  for delivery, not sales.
- **Google Sheets outreach tracker** — replaced by `outreach_items`.
- **Gmail Apps Script 30-min poller** — replaced by Workspace reply ingest on
  `/crm/settings/sales-os` and `salesOs.replies.ingest`.

## Connections (Settings → Connections)

Required before first live mailbox send:

| Connection | Purpose |
|---|---|
| Google Workspace | HITL Gmail send + reply ingest (`@hrmny.co` only) |
| Apollo.io | People search / org enrich / intent CSV |
| Hunter | Email verify |
| NeverBounce | Verify fallback |
| OpenRouter | Research + draft + classify + reflect |

Do **not** connect for outbound: LinkedIn unofficial MCP / Playwright /
Phantombuster / Dripify, Resend/Mailgun/SES for cold mail, Apollo sequences,
Outreach.io, Instantly.

## Compliance before go-live

- [ ] SPF / DKIM / DMARC live on `hrmny.co`
- [ ] Owner sign-off on ICP no-go list, email footer, and 24-month unused-lead
      retention (Sales OS settings)
- [ ] Daily Gmail cap ≤ 15 / mailbox until reputation is proven
- [ ] Weekly LinkedIn assist cap ≤ 20 / person
- [ ] Global pause switch understood (`Sales OS → Pause all outreach`)
- [ ] One-click unsubscribe (`/api/sales-os/unsubscribe`) tested
- [ ] No tracking pixels

## Daily loop in the CRM

| Old Claude command | CRM |
|---|---|
| `/daily-research` `/find-leads` | Hunt / Research → Run daily research |
| Gate 1 / Gate 2 | Approve / Reject / Rework on the research console |
| `/fetch-contacts` | Fetch contacts (Apollo credit budget) |
| `/draft-outreach` | Approve + draft → `/crm/outreach` |
| `/send-linkedin` | Copy + Open LinkedIn + Mark sent / accepted |
| `/process-intent-leads` | Inbound or Sales OS → Apollo intent CSV |
| `/dashboard` `/pipeline-review` | `/crm` digest strip + `/crm/deals` stall flags |
| `/reflect` `/evolve` | Sales OS → Propose weekly changes (HITL apply) |

Email send remains two clicks: **Approve draft** then **Send via Gmail**.
LinkedIn never auto-sends.
