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

## Open questions blocking the plan

1. **Sage contract end date + notice period** — anchors the whole timeline. The parallel
   run wants a full VAT quarter, so discovery should start 4–5 months before expiry.
2. Client's actual Sage invoice (to replace illustrative costs in the proposal).
3. Whether the year-end accountant is bought in — they hold the veto.
4. "9thrts" — user mentioned it re: BOMs; never clarified what system this is. Ask.
5. BOM data shape: Sage Manufacturing exports vs spreadsheets; costing accuracy vs
   structural mess as the client's real pain.

## Shipped

- `index.html` — JSON X-Ray (payload workbench). Merged, live.
- `sage.html` — Sage X-Ray (ledger workbench): 15 detector families, Benford analysis,
  AI briefing pack, consent-gated BYO-key Ask Claude with complexity model routing.
  Merged in PR #3, live on Pages.
- `migrate.html` — Migration X-Ray (Sage → ERPNext): convert exports to ERPNext import
  packs, parallel-run reconciliation, cutover checklist. **Draft PR #4 open.**
  Adversarially reviewed (15 agents): 12 defects found and fixed, three of them
  critical false-clean reconciliation bugs. 17-case headless regression suite added —
  keep it passing; the reconciliation "clean" verdict gates cutover, so any change that
  can make it clean on unexamined data is a critical bug, not a nicety.
- `.claude/skills/xray-conventions` + `.claude/skills/sage-migration` — auto-loaded
  project memory; `.claude/agents/migration-auditor` — adversarial pure-layer reviewer.
- Client proposal artifact (ERPNext recommendation, MTD plan, costs, risks, phases):
  https://claude.ai/code/artifact/095882f4-b392-48a4-9c02-87fa91124859

## In flight / next steps

- Draft PR #4 awaiting review/merge: https://github.com/mcfearless75/Json/pull/4
- Repo housekeeping PaulMc asked about and hasn't decided: the repo is still named
  `Json` though it now holds three apps and the migration project — consider renaming
  it (GitHub redirects the old URL) vs splitting the Sage work into its own repo.
  Also wants a local clone under `C:\Users\LAPTOP80\Projects` for backup.
- ERPNext import column headers are best-effort against v15 Data Import templates —
  **must be verified against the client's live instance in Phase 0** before bulk import.
- Candidate next build: **BOM X-Ray** (circular refs, cost roll-up verification, orphan
  components, obsolete parts on live BOMs) — works off CSV today, becomes the live BOM
  quality module post-migration.

## Model policy

Product code uses Haiku 4.5 / Sonnet 5 / Opus 5 auto-routing; Fable 5 is a manual-only
"Maximum" tier and auto never selects it. Opus 5 is the right deep tier — Fable is not
needed for this product and carries extra data-retention requirements.
