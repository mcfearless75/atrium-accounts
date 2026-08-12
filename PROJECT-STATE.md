# Project state — read me first in a new session

Working notes for the X-Ray app family and the Sage 50 → ERPNext migration project.
Update this file at the end of any session that changes the plan or ships work.

## Client context

- Client runs **Sage 50**, files **MTD VAT to HMRC from it**. **No payroll** in Sage.
- Goal: replace Sage with cheaper software, then build BOM, invoicing, stock taking,
  inventory management, and dashboards/historical reporting around it.
- Agreed direction: **self-hosted ERPNext**, Bluewater does hosting/backups/upgrades.
- Migration shape (client's own idea, endorsed): **build in parallel, cut over when the
  Sage contract expires** — never renew, no capability gap.
- PaulMc has Sage logins with full data-export rights, so exports are available on demand.

## ⚠️ HARD DEADLINE — Sage expires in 6 weeks (stated 2026-08-10, so ~2026-09-21)

This invalidates the original 4–5 month timeline in the proposal. A full-VAT-quarter
parallel run is **not possible** in the window. Consequences and required actions:

1. **Export everything NOW, before the licence lapses.** This is the one irreversible
   risk: if Sage 50 goes read-only or stops opening when the subscription ends, the
   data becomes very hard to get out. Run and archive full exports (customers,
   suppliers, products, nominal/TB, full audit trail, VAT returns filed to date) this
   week regardless of which migration path is chosen. Non-negotiable, do it first.
   **Tooling for this now exists**: `migrate.html` tab 0 ("Get the data out") is a
   step-by-step runbook for all nine artefacts plus an archive checker — drop the
   exported folder in and it reports what is missing, what was exported with a reduced
   field list, what was exported without a header row, and how much of the history the
   audit trail actually covers. It emits a MANIFEST.md (row counts, columns, date
   ranges, SHA-256) to file with the archive for the six-year retention.
2. **Establish whether it expires or auto-renews, and the notice deadline.** Many Sage
   contracts auto-renew unless cancelled with ~30 days' notice — with 6 weeks left, the
   notice deadline may be days away. Missing it can lock in another full year.
3. **Decide: short extension vs compressed cutover.** A 1–3 month extension buys a
   proper parallel run and is usually worth it. If an extension is only available as a
   full year, compress instead — accounting-only scope, cut over at a VAT quarter
   boundary so no return is split across two systems. BOM/stock/dashboards come after.
4. **Check where the VAT quarter end falls** relative to the expiry — that is the ideal
   cutover date. File the final return from Sage, start clean in ERPNext.
5. ~~MTD registration with HMRC takes lead time~~ — **checked, and this looks
   wrong.** For a business already VAT-registered (this client, filing from Sage
   today), HMRC auto-enrolled all remaining VAT-registered businesses after
   August 2022; there's no longer a separate MTD sign-up step. The real lead time
   is commercial onboarding with whichever MTD software route is chosen — see
   `ERPNEXT-DEPLOYMENT.md` §7, which also found the "primary" route named below
   (the community VAT app) is unmaintained since 2021 and doesn't install on v15.
   Get the accountant to confirm this correction before treating it as settled.

## Other open questions

- Client's actual Sage invoice (to replace illustrative costs in the proposal).
- Whether the year-end accountant is bought in — they hold the veto. Urgent now.
- BOM data shape: Sage Manufacturing exports vs spreadsheets; costing accuracy vs
  structural mess as the client's real pain.
- ("9thrts" from an earlier message was a typo — disregard, means nothing.)

## Shipped

- `index.html` — **Atrium home dashboard**: module cards, the "getting off Sage" running
  order, privacy footer. Every module carries an identical shared app bar. The former
  `index.html` (JSON X-Ray, payload workbench) is now `json.html`.
- `help.html` — **Atrium Help**, the page the client will actually live in. Task-first
  "how do I…?" guide: 17 answers phrased as jobs, each with what the same job was called
  in Sage, plus a Sage→ERPNext translation table. Search matches the whole entry (so
  "refund" reaches the credit-note answer), ticks persist in localStorage, deep links
  open one answer. Merged in PR #10.
- `sage.html` — Sage X-Ray (ledger workbench): 21 detector families, Benford analysis,
  AI briefing pack, consent-gated BYO-key Ask Claude with complexity model routing.
  Merged in PR #3, live on Pages. **Adversarially audited across four dimensions**
  (parsing / detectors / dashboard arithmetic / AI boundary + privacy). The privacy
  contract held — one data-bearing endpoint, no storage API used at all, auto-routing
  provably cannot reach Fable, no XSS. The arithmetic did not: six critical parsing
  defects that silently dropped money out of headline totals, two critical dashboard
  defects (a P&L breakdown that did not sum to its own total, and `Math.abs` in
  `fmtGBP`), a Benford gate that accused every small ledger, and a threshold-skimming
  detector that flagged ~100% of ordinary ledgers as possible fraud. All fixed.
  `tests/sage.test.mjs` (116 assertions) is the regression suite — **keep it green**.
- `migrate.html` — Migration X-Ray (Sage → ERPNext): convert exports to ERPNext import
  packs, parallel-run reconciliation, cutover checklist. Merged in PR #4, live.
  **Audited twice.** The first review (15 agents) found 12 defects, three of them
  false-clean reconciliation bugs. The second, after `sage.html` and `bom.html` had raised
  the bar, found 11 more — including three further false-clean routes and a `parseMoney`
  that was weaker than its two siblings, so the same cell converted one way and audited
  another. All fixed. `tests/migrate.test.mjs` (402 assertions, 40 mutations caught) is
  the regression suite — **keep it passing**; the reconciliation "clean" verdict gates
  cutover, so any change that can make it clean on unexamined data is a critical bug.
- `.claude/skills/xray-conventions` + `.claude/skills/sage-migration` — auto-loaded
  project memory; `.claude/agents/migration-auditor` — adversarial pure-layer reviewer.
- Client proposal artifact (ERPNext recommendation, MTD plan, costs, risks, phases):
  https://claude.ai/code/artifact/095882f4-b392-48a4-9c02-87fa91124859

- `bom.html` — BOM X-Ray: multi-level BOM analysis, cycle detection, cost roll-up,
  where-used, ERPNext BOM export. Merged in PR #5. **Then adversarially audited**, which
  found five defects that could each put a wrong cost in front of the client with nothing
  visibly wrong: negative costs rendered as positive, unusable scrap silently treated as
  zero, half-populated rows dropped without a count, an export that could not reproduce the
  displayed cost, and `"9,50"` parsing as 950. All fixed, plus nine more. 20 detector
  families now. `tests/bom.test.mjs` (97 assertions) is the regression suite — **keep it
  green**.

**Repo rename is done:** `Json` → `atrium-accounts`. Note the MCP GitHub tools in a
session scoped to the old name still work via GitHub's API redirect — pass `repo: "json"`
if `atrium-accounts` is refused. Live URLs are now
`mcfearless75.github.io/atrium-accounts/{index,sage,migrate,bom}.html`.

- `help.html` — task-first "how do I…?" guide for the people who just do the invoicing.
  Merged in PR #10.
- **Phase 0 export runbook** — `migrate.html` gains a first tab, "Get the data out": the
  nine-artefact runbook, an archive completeness checker, a MANIFEST.md emitter, and a
  hard gate that also renders at the top of the cutover checklist. The gate opens only
  when the five CSV exports verify clean *and* the four things no CSV check can see are
  confirmed by hand. Suite grew 196 → 298 assertions, mutation-tested 21/21; one of the
  new assertions turned out to cover nothing (it tested a guard that was unreachable) and
  was replaced. The suite now also compares `parseMoney` / `parseNum` / `parseDate`
  across all three apps, which **immediately found live drift**: `bom.html`'s `parseNum`
  had never learned Sage's trailing-minus and `CR`/`DR` notations, so a `480.00-` rebate
  was a negative cost in two apps and an unreadable cell in the third. Fixed. The sibling
  rule is now enforced by the build rather than by memory.
- **Then audited by four parallel agents, which found more than the build did.** The archive
  block had already passed 21/21 mutations; adversarial review found four further routes to
  a false **complete** verdict — the aged debtors/creditors reports the runbook itself asks
  for filling the customer and supplier slots, a bank activity export filling the audit
  slot, one mistyped year disarming the truncation *and* staleness checks together, and a
  trial balance whose figures were all blank. Also: the `parseNum` sibling fix above had
  applied a money notation to quantity and scrap columns, so a qty of `3 DR` (a drum) parsed
  as 3 and completed a roll-up that had correctly refused. All fixed. The XSS and privacy
  contract was attacked directly and held — proven clean, not assumed. Suites now
  **97 / 116 / 402**, 40 mutations caught across three sweeps.

## In flight / next steps

- **`ERPNEXT-DEPLOYMENT.md` added** — the deployment/config runbook that was actually
  missing. The client's wish-list (BOM, invoicing, stock taking, inventory management,
  dashboards/historical reports) is entirely native ERPNext modules; none of it was
  missing software, all of it was blocked on an instance existing. This document is that
  prerequisite: server sizing, the Docker install path, backups-before-data, the import
  order that depends on `migrate.html`'s converter output, module-by-module configuration,
  and the VAT/MTD decision (the one section that's a real open choice, not a checklist).
  Marked with ⚠ VERIFY wherever a claim needs checking against a live instance — nothing
  in it has been run against a real deployment yet. **Docker is now running on the
  server** — next is confirming DNS is pointed at it before the install script runs.
- **Frappe Cloud (the official hosted ERPNext) was seriously evaluated and set aside** —
  self-hosted stays the plan. Not skipped, properly checked (three research rounds,
  including reading Frappe Cloud's own source): the realistic price is $25/month, not
  free, because downloadable backups and the ability to disable forced auto-updates are
  both gated to that tier and above — below it, updates land on Frappe's schedule with no
  opt-out, and backups can't be pulled anywhere at all. On top of that, no uptime
  guarantee exists at any site-plan tier, offsite backups default to a Mumbai bucket even
  for a UK-region site (unconfirmed if redirectable), and support is India business
  hours. Full reasoning in `ERPNEXT-DEPLOYMENT.md`'s "Why self-hosted, not Frappe Cloud".
  Self-hosting is both cheaper and gives free control over backup destination — added
  **OneDrive via `rclone`** as the documented backup target for exactly that reason.
- **Walk help.html against the client's real ERPNext instance once it exists.** The steps
  deliberately say what to *search for* rather than which menu to click, because sidebar
  wording drifts between versions — but they should still be checked against real screens
  and tightened where they are vaguer than they need to be.
- **The VAT entry in help.html stops short on purpose.** It says "file it through whichever
  route we set up for you at cutover" and tells the user not to do the first quarter alone,
  because the MTD filing path is not settled. Fill that in once it is.

- **The tooling is now ahead of the client conversation, and that is the wrong way round.**
  Tab 0 exists, is tested and is live; nobody has yet run a single real export through it.
  The three unresolved questions are all answers only the client or Sage can give:
  does the contract auto-renew and has the notice deadline passed · is the year-end
  accountant bought in (they hold the veto) · which MTD filing route. None of them are
  engineering work.
- All four accounting-side jobs are done: every app has a committed suite
  (97 / 116 / 402) and every app has been adversarially audited. `json.html` has neither,
  and is the lowest-stakes of the four (payload QA, not client accounting data).
- **Verify the ERPNext import column headers against the client's live v15 instance**
  before any bulk import. Everything else is now pinned by tests; this is the one
  remaining assumption in the converters that no test can check from here.
- Consider raising with the client that the ledger tool now reports coverage
  (`net … over 184 of 186 rows`). If their real export produces a large gap there, that is
  a migration blocker worth knowing about early, not a display quirk.
- ERPNext import column headers (both `migrate.html` and `bom.html`) are best-effort
  against v15 Data Import templates — **must be verified against the client's live
  instance in Phase 0** before bulk import.
- PaulMc wants a local clone under `C:\Users\LAPTOP80\Projects` for backup.
- Remaining modules from the client's wish-list not yet built: invoicing, stock taking,
  inventory management. These are ERPNext modules rather than X-Ray tools — the X-Ray
  layer's job is quality assurance over them, not replacing them.

## Model policy

Product code uses Haiku 4.5 / Sonnet 5 / Opus 5 auto-routing; Fable 5 is a manual-only
"Maximum" tier and auto never selects it. Opus 5 is the right deep tier — Fable is not
needed for this product and carries extra data-retention requirements.
