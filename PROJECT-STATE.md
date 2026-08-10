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

- `index.html` — JSON X-Ray (payload workbench). Merged, live.
- `sage.html` — Sage X-Ray (ledger workbench): 15 detector families, Benford analysis,
  AI briefing pack, consent-gated BYO-key Ask Claude with complexity model routing.
  Merged in PR #3, live on Pages.
- `migrate.html` — Migration X-Ray (Sage → ERPNext): convert exports to ERPNext import
  packs, parallel-run reconciliation, cutover checklist. Merged in PR #4, live.
  Adversarially reviewed (15 agents): 12 defects found and fixed, three of them
  critical false-clean reconciliation bugs. 17-case headless regression suite added —
  keep it passing; the reconciliation "clean" verdict gates cutover, so any change that
  can make it clean on unexamined data is a critical bug, not a nicety.
- `.claude/skills/xray-conventions` + `.claude/skills/sage-migration` — auto-loaded
  project memory; `.claude/agents/migration-auditor` — adversarial pure-layer reviewer.
- Client proposal artifact (ERPNext recommendation, MTD plan, costs, risks, phases):
  https://claude.ai/code/artifact/095882f4-b392-48a4-9c02-87fa91124859

- `bom.html` — BOM X-Ray: multi-level BOM analysis, cycle detection, cost roll-up,
  where-used, ERPNext BOM export. **PR open, not yet merged.**

**Repo rename is done:** `Json` → `atrium-accounts`. Note the MCP GitHub tools in a
session scoped to the old name still work via GitHub's API redirect — pass `repo: "json"`
if `atrium-accounts` is refused. Live URLs are now
`mcfearless75.github.io/atrium-accounts/{index,sage,migrate,bom}.html`.

## In flight / next steps

- Merge the BOM X-Ray PR.
- Run the `migration-auditor` agent against `bom.html`'s pure layer — the ledger and
  migration tools have both been adversarially reviewed; the BOM cost roll-up has not,
  and wrong costings are exactly the failure this project cannot afford.
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
