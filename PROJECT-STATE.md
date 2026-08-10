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
2. **Establish whether it expires or auto-renews, and the notice deadline.** Many Sage
   contracts auto-renew unless cancelled with ~30 days' notice — with 6 weeks left, the
   notice deadline may be days away. Missing it can lock in another full year.
3. **Decide: short extension vs compressed cutover.** A 1–3 month extension buys a
   proper parallel run and is usually worth it. If an extension is only available as a
   full year, compress instead — accounting-only scope, cut over at a VAT quarter
   boundary so no return is split across two systems. BOM/stock/dashboards come after.
4. **Check where the VAT quarter end falls** relative to the expiry — that is the ideal
   cutover date. File the final return from Sage, start clean in ERPNext.
5. **MTD registration with HMRC takes lead time** — start it immediately, not at the end.

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
  open one answer. **PR #10 open, not yet merged.**
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
  another. All fixed. `tests/migrate.test.mjs` (196 assertions, 21/21 mutations caught) is
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
  families now. `tests/bom.test.mjs` (81 assertions) is the regression suite — **keep it
  green**; it is the only committed test suite in the repo.

**Repo rename is done:** `Json` → `atrium-accounts`. Note the MCP GitHub tools in a
session scoped to the old name still work via GitHub's API redirect — pass `repo: "json"`
if `atrium-accounts` is refused. Live URLs are now
`mcfearless75.github.io/atrium-accounts/{index,sage,migrate,bom}.html`.

## In flight / next steps

- **Merge PR #10** (help.html). Nothing blocking it — no CI on this repo beyond the Pages
  deploy on `main`.
- **Walk help.html against the client's real ERPNext instance once it exists.** The steps
  deliberately say what to *search for* rather than which menu to click, because sidebar
  wording drifts between versions — but they should still be checked against real screens
  and tightened where they are vaguer than they need to be.
- **The VAT entry in help.html stops short on purpose.** It says "file it through whichever
  route we set up for you at cutover" and tells the user not to do the first quarter alone,
  because the MTD filing path is not settled. Fill that in once it is.

- PR #6 open (draft): the Atrium shell plus the BOM costing fixes.
- All four accounting-side jobs are done: every app has a committed suite
  (81 / 116 / 196) and every app has been adversarially audited. `json.html` has neither,
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
