# hrmny OS — Cutover, training & hypercare

**Milestone:** M6 · **Status:** M1 candidate verified; production cutover pending · **Evidence updated:** 2026-07-31

**Owner:** Lead engineer + client ops sponsor

---

## 1. Cutover goals

1. Staff day-to-day work runs in hrmny OS (sales → delivery → money), not Asana/Airtable for core boards.
2. Client portal (`/portal`) is the scoped read/approve surface — **no finance**.
3. Cross-system seams (`deal.won`, `brief.lock`, `creative.approved`, …) are idempotent and auditable.
4. 30-day hypercare clock starts at M6 sign-off.

---

## 2. Pre-cutover checklist

| # | Item | Owner | Done |
|---|---|---|---|
| 1 | Target Supabase `klrugedztqxlvyghyzxs` is at **0070**; fresh, 0069→0070, second-apply, RLS/Data API/constraint/index/trigger and target postchecks passed | Eng | ☑ |
| 2 | Exact `9019c48a…` has two successful previews and two fully green CI runs; the `hrmny-os` functions are verified in `sin1`, while authoritative production remains on `3b3c65d…` pending owner promotion | Eng + Vercel owner | ☐ |
| 3 | Google Workspace SSO for staff; portal magic-link allowlist | Eng + IT | ☐ |
| 4 | Composio OAuth apps (Gmail, LinkedIn, Canva, Calendar) redirect URLs | Eng | ☐ |
| 5 | Xero / Bayzat / Apollo / Hunter keys in Keeper → Vercel env | Client | ☐ |
| 6 | Asana residual export → OS task boards reconciled | Ops | ☐ |
| 7 | Role matrix signed (AM margin deny, payroll SoD, portal scopes) | Partners | ☐ |
| 8 | Freeze list of live seams (idempotency keys agreed) | Eng | ☐ |
| 9 | Backup + DR: daily dump, RTO &lt; 24h documented — procedure in `docs/BACKUP-AND-DR.md`; ☐ until restore drill evidence attached | Ops | ☐ |
| 10 | Known-good Vercel target retained and exact rollback procedure documented below; production rollback rehearsal still required | Eng + Vercel owner | ☐ |

---

## 3. Cutover rehearsal (T−7 to T−1)

1. **T−7:** Seed staging with anonymized Demo Co + one real client shadow.
2. **T−5:** Run M1–M6 demo scripts end-to-end on staging (`AUTH_MODE=dev` then SSO).
3. **T−3:** Portal isolation test — portal_a cannot see portal_b or margin/payroll.
4. **T−2:** Seam re-drive test — same idempotency key does not double-spawn tasks.
5. **T−1:** Training dry-run (below); freeze schema migrations except hotfixes.

---

## 4. Training plan (roles)

| Cohort | Length | Focus |
|---|---|---|
| Partners / Directors | 60 min | Dashboards hub, margin, overrides, audit |
| AM / CS | 90 min | Sales→handover, Month-1, portal approvals coaching |
| Traffic / Creative | 90 min | DoR, boards, QC@5, Canva connect |
| Finance / HR | 90 min | Invoice propose-approve-post, payroll SoD, VAT close |
| Client portal champions | 45 min | Magic-link, deliveries, approvals, reports (no money) |

**Artifacts:** short Loom per cohort + this checklist; office hours calendar for hypercare week 1.

---

## 5. Go-live day

1. Announce freeze window; enable production feature flags for staff modules already demoed.
2. Point `app.` and `portal.` DNS; verify RLS + session isolation with one real portal user.
3. Disable Asana writes for cutover boards (read-only archive).
4. Start **hypercare clock** (below); open shared support channel (Chat/Slack).

---

## 6. Hypercare (30 days)

| Window | Cadence | Focus |
|---|---|---|
| Days 1–7 | Same-day response | Auth, portal scope bugs, seam failures, Xero post |
| Days 8–21 | Next-business-day | Adoption friction, report gaps, role tweaks |
| Days 22–30 | Triage backlog | V1.1 parking vs hotfix; hypercare exit review |

**Exit criteria:** no P0 open &gt; 48h; portal finance exclusion still holds; payroll never disbursed from OS; weekly adoption check (work of record in OS).

---

## 7. Rollback

### M1 authoritative Vercel rollback

Command syntax was verified against Vercel's current
[`rollback`](https://vercel.com/docs/cli/rollback) and
[`promote`](https://vercel.com/docs/cli/promote) CLI references. The
authoritative project is `hrmny-os-web` in scope
`ahmad-bukharis-projects-74a52414`. Do not run these commands against the
similarly named `hrmny-os` project. The retained known-good production target
is `dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG` at commit
`3b3c65dcc0bf20254332dfe6ce45ef8d16af87b5`.

1. Before promotion, inspect and retain the known-good deployment:

   ```powershell
   vercel inspect dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG --scope ahmad-bukharis-projects-74a52414
   ```

   Stop if it is not READY, is not from `hrmny-os-web`, or does not match the
   recorded commit. Record the candidate deployment ID before changing traffic.

2. If the promoted candidate fails the smoke gate, request an explicit rollback
   to that deployment and scope:

   ```powershell
   vercel rollback dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG --scope ahmad-bukharis-projects-74a52414 --timeout=3m
   ```

   Do not add an undocumented non-interactive flag. If the CLI requests
   confirmation, confirm only when it names `hrmny-os-web` and its production
   domains; otherwise abort.

3. Wait for rollback completion and verify the public target:

   ```powershell
   vercel rollback status hrmny-os-web --scope ahmad-bukharis-projects-74a52414 --timeout=3m
   vercel inspect https://hrmny-os-web.vercel.app --scope ahmad-bukharis-projects-74a52414
   vercel httpstat / --deployment https://hrmny-os-web.vercel.app --scope ahmad-bukharis-projects-74a52414
   vercel logs --deployment https://hrmny-os-web.vercel.app --level error --since 5m --scope ahmad-bukharis-projects-74a52414
   ```

   Repeat login/protected-route and database-read smoke checks. Record the
   rollback timestamp, operator, deployment ID, HTTP result and error-log result.

4. Leave migration 0070 applied during an application rollback. It is additive
   and the retained application deployment must be rechecked against it before
   promotion. Never restore or destructively downgrade the database as part of
   this application procedure. Use a separately approved, tested restore only
   for a confirmed data incident; prefer a forward schema fix.

5. A Vercel instant rollback disables automatic production-domain assignment.
   After the repaired deployment passes all gates, restore normal delivery with:

   ```powershell
   vercel promote <repaired-production-deployment-id-or-url> --scope ahmad-bukharis-projects-74a52414
   ```

   Verify `vercel promote status hrmny-os-web --scope
   ahmad-bukharis-projects-74a52414` before closing the incident.

### Wider M6 operational rollback

1. Re-enable Asana writes only for affected boards if the full cutover had
   already disabled them.
2. Disable seam workers / Inngest if a double-fire is suspected, then reconcile
   and drain the outbox with an audit record.

---

## 8. Production gaps (post-demo)

Tracked in repo README. Exact `9019c48a…` has green CI, successful previews,
fail-closed HTTP assertions, and a clean `hrmny-os` runtime smoke window. The
remaining M1 release gaps are the exact-head authenticated browser thread and
owner-controlled promotion/rollback proof on `hrmny-os-web`. Later-milestone
gaps include durable Xero webhooks, Composio keys, Inngest crons, Bayzat API
versus CSV, and the UAE-residency migration path.
