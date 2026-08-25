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

| Connection | Purpose | Live status 2026-08-25 |
|---|---|---|
| Google Workspace | HITL Gmail send + reply ingest (`@hrmny.co` only) | **Blocked.** Production has 1 error row: token expired/revoked (400). Staff Connections UI needs `@hrmny.co` SSO. Cloud Chrome / Playwright had no Workspace session. |
| Apollo.io | People search / org enrich / intent CSV | **Mock** on `hrmny-os`. Ayham shared access (Aug 21); key still not pasted in Connections. The Vercel Sales & Growth app shows “Apollo Connected” in **Demo Mode** — that is not the CRM vault. |
| Hunter | Email verify | **Mock.** Paste key in Connections. |
| NeverBounce | Verify fallback | No Connections card. Set `NEVERBOUNCE_API_KEY` (credits were 0 historically). |
| OpenRouter | Research + draft + classify + reflect | **Configured** on production (`liquid/lfm-2.5-2.6b:free`). Meeting notes still flag a credit top-up. |

Do **not** connect for outbound: LinkedIn unofficial MCP / Playwright /
Phantombuster / Dripify, Resend/Mailgun/SES for cold mail, Apollo sequences,
Outreach.io, Instantly.

### How to finish connections (human, Harmony Chrome)

Cursor’s Harmony/Browser MCP was down in this run. Composio cloud Chrome and
Playwright/Chromium were used instead. Neither had an `@hrmny.co` Google
session, so OAuth could not be completed from the agent VM.

1. On your machine, open Harmony Chrome signed in as `@hrmny.co`.
2. Go to [https://hrmny-os.vercel.app/settings/connections](https://hrmny-os.vercel.app/settings/connections).
3. **Reconnect Google Workspace** (clear the dead token if shown, then OAuth).
   Use Workspace only — not personal Gmail.
4. Paste **Apollo** and **Hunter** keys. Get the Apollo passcode from Ayham if
   the shared login still needs it.
5. Confirm OpenRouter credits. Set `NEVERBOUNCE_API_KEY` if verify-fallback
   credits are funded.
6. `/crm/settings/sales-os` is on this PR — it 404s on production until merge.
   After merge, the Sales OS page shows the same `/api/ready` blockers.

### Import sources found

| Source | Where | Notes |
|---|---|---|
| Official spec v3.0 | [Drive doc](https://docs.google.com/document/d/1nn_zPF5srzhoVqVmhNE7VeAETs4UQzgDJq4WmJAiG8Y/edit) | Already seeded into Sales OS defaults |
| `sales-growth.zip` (670 MB) | Drive `1uMxKjk_IHMli6mXuUrWbTZaXiREQUpf3`, owner `ay@hrmny.co` | June prototype + likely `dashboard.db`. Too large to pull in this VM. |
| `hrmny_OS_Module1_Handover.zip` (54 MB) | Drive `1G9jJ-TlZpQGpod8gus2dP0bDfBFVBEEt` | Briefs + anonymized sample CSVs only — no `dashboard.db` |
| Vercel `hrmny-sales-growth` | `prj_yZoAIb0VTohQVroTTxss6IFqEWJI` on Ahmad’s personal team | Live at `https://hrmny-sales-growth.vercel.app` in Demo Mode. Last production deploy is old. Keep archived after the parallel window. |

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
