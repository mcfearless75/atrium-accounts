# Atrium — Accounts &amp; Migration Workbench

Project brief for Claude Code. Read this fully before making changes.

## What this is

**Atrium** is a suite of four single-file, zero-dependency, fully client-side workbenches
sharing one product shell, plus a plain-English help guide. Each workbench loads an export,
scans it for defects in plain English, and emits whatever files the next step needs. Nothing
is uploaded; nothing is stored server-side.

The original member — JSON X-Ray (`json.html`) — is a JSON inspection app for
data/decisioning professionals (credit risk, bureau payloads, API traces). It goes beyond
"beautify JSON" tools: it actively scans payloads for data-quality defects and PII.

**Owner:** PaulMc (Bluewater Associates). Primary real-world use case: inspecting credit decisioning connector payloads (TransUnion, Equifax, CIFAS, affordability engines) during QA/testing at a UK financial services client, and migrating a client off Sage 50 onto self-hosted ERPNext. Payloads and ledgers are sensitive — the no-server, no-network architecture is a deliberate design constraint, not an accident. **Never add any code that transmits payload data anywhere.**

## Repo layout

```
index.html                    ← Atrium home dashboard (module cards + migration workflow)
help.html                     ← Atrium Help — task-first "how do I…?" guide for the client
json.html                     ← JSON X-Ray — Payload Workbench (was index.html)
sage.html                     ← Sage X-Ray — Ledger Workbench (same one-file rules)
migrate.html                  ← Migration X-Ray — Sage 50 → ERPNext (same one-file rules)
bom.html                      ← BOM X-Ray — Bill of Materials Workbench (same one-file rules)
CLAUDE.md                     ← this file
README.md                     ← user-facing docs + Pages setup
.claude/skills/               ← project skills: xray-conventions, sage-migration
.claude/agents/               ← agent defs: migration-auditor (adversarial pure-layer reviewer)
.github/workflows/pages.yml   ← GitHub Pages deploy (publishes repo root on push to main)
```

## The product shell

Every module carries an identical `.appbar` immediately after `<body>`: brand link to
`index.html`, nav across all six pages with `class="on"` on the current one, and a
`100% CLIENT-SIDE` marker. The markup and its CSS block are **duplicated verbatim** in each
file — that is the cost of the single-file constraint, and it is deliberate. If you change
the nav, change it in all six files and re-check that each page marks the right link `on`.
`index.html` is a static page with no script block; it must stay that way.

## `help.html` — the page the client actually lives in

The four X-Ray tools are for the migration; `help.html` is for the person whose day is
invoices. It is task-first and written for a non-specialist: every entry is phrased as a
job ("Refund a customer"), not a feature, and each carries a `was` line saying what the
same job was called in Sage — the hard part of a migration is not the new buttons, it is
not knowing the new word.

Rules for it:

- **Search matches the whole entry**, not the title. Typing "refund" must reach the credit
  note entry, and "money in" must reach payments. Add plain-English synonyms to `tags`
  rather than renaming entries to match search terms.
- **Steps say what to search for, not which menu to click.** ERPNext's sidebar wording
  moves between versions; its search bar does not. This also happens to be the fastest
  route for a non-technical user.
- **Do not invent precise UI paths.** Anything version-specific must be verifiable, or
  phrased at the level of the concept. The footer says this outright.
- `localStorage` under `atrium_help_v1` holds **step ticks only** — never client data.
- Content lives in the `TASKS` / `GLOSSARY` / `CATS` consts above the DOM-layer marker,
  so it stays greppable and could be tested headlessly.

Smoke test: `/` focuses search; searching "refund" opens the credit-note entry; a tick
survives reload; `help.html#vat` deep-links open; an unmatched search shows the empty
state; no horizontal overflow at 1280px.

Read the `xray-conventions` skill before modifying any app; read `sage-migration` before
touching migrate.html or anything Sage/ERPNext. After pure-layer changes, run the
`migration-auditor` agent.

There is no build step, no package.json, no framework. Keep it that way unless a feature genuinely cannot be done in vanilla JS (unlikely). The single-file constraint is a feature: it must remain trivially deployable to GitHub Pages / Vercel / an intranet share by copying one file.

## Architecture (inside json.html)

One IIFE, strict mode. Key state:

| Global | Purpose |
|---|---|
| `ROOT` | parsed JSON object |
| `RAW` | minified string (for size stats) |
| `NODES` | every node from a full walk: `{id, segs, depth, type, v}` |
| `FLAT` | leaf values only: `{path, segs, type, v, node}` |
| `FINDINGS` | quality findings: `{sev: high|med|info, cat, title, desc, paths[]}` |
| `PII` | detected personal data: `{kind, path, value, note}` |
| `MASK` | boolean — global PII mask toggle |
| `_piiset` | Set of PII paths for O(1) lookup during render |

Core functions:

- `walk(root)` — single-pass traversal. Builds NODES/FLAT and a `keyReg` Map: normalised key name → spellings, types seen, sample paths. Returns `{keyReg, dateVals, maxDepth, counts}`.
- `analyse(meta)` — the quality engine. All detectors live here. Pushes into FINDINGS.
- `scanPII()` — regex + key-name heuristics. Pushes into PII.
- `renderTree()` / `buildNode()` — recursive DOM build; nodes at depth ≥3 or with >60 children start collapsed; event delegation on `#tree`.
- `renderInsights / renderQuality / renderPII / renderFlatten / renderStrip` — side-panel tabs and the header scan strip.
- `dotPath(segs)` / `jsonPath(segs)` — path formatting (bracket-quotes non-identifier keys).
- `load(txt)` — parse (with line-number error pinpointing), then run the full pipeline.

UI conventions: any element with `data-jump="<dot.path>"` becomes a clickable path link that expands ancestors and scrolls the tree to that node (global click handler).

## Current detectors (quality engine)

1. **Inconsistent key spellings** — same normalised key, multiple spellings (`firstName`/`FirstName`) → high
2. **Duplicate concepts** — both `dob` and `dateOfBirth` families present → high
3. **Mixed types per key name** across paths → high
4. **Booleans stored as strings** (`"true"`/`"false"`) → med
5. **Numbers stored as strings** (excluding id/ref/phone/postcode-named keys) → med
6. **Legacy Y/N flags** → info
7. **Mixed date/timestamp formats** (date-only, `+0000`, `+00:00`, `Z`, no-TZ) → med
8. **Impossible DOBs** — under-18 or future, on birth-named keys → high
9. **Conflicting DOB values** across the payload → high
10. **Sentinel values** — 999, 9999, 9999.99, -1, 99, 999999 → med
11. **`"Infinity"` string literals** → med
12. **Empty objects/arrays** → info
13. **Null density** (>3 nulls) → info
14. **Leading/trailing whitespace in strings** → med

PII detector kinds: Email, Phone (UK), Postcode, Date of birth, Income, Account number, Name, Address, Reference ID.

## Coding conventions

- Vanilla JS, no dependencies, no CDN scripts (fonts via Google Fonts are the only external fetch — acceptable, but the app must degrade gracefully offline).
- UK English in all UI copy.
- Escape everything user-supplied with `esc()` before injecting into innerHTML — payloads are untrusted input; XSS via a crafted JSON string is the main attack surface. Audit this on every render change.
- Respect the mask: any new surface that displays leaf values must check `MASK && _piiset.has(path)`.
- Design tokens are CSS variables at `:root`. Do not hardcode colours.
- Keep render fast for ~10–50k nodes: prefer event delegation, avoid per-node listeners, debounce inputs.
- `prefers-reduced-motion` is respected; keep focus-visible outlines intact.

## Shipped from the backlog

### ✅ P1 — Diff mode
Second textarea in the load overlay ("Compare against…", optional). Diff on flattened paths (added / removed / changed value / changed type) in a colour-coded "Diff" tab; paths jump to the primary payload's tree; scan strip gains a diff chip when active. `computeDiff()` + `flattenTo()`.

### ✅ P2 — Custom rule packs
JSON rule format `{ "name", "severity", "match": {"keyRegex", "pathRegex", "valueRegex", "type", "negate"}, "message" }` — `negate: true` flags values that FAIL the value regex (the whitelist shape). Loaded from a pasted blob in the Rules tab; persisted in `localStorage` under `jsonxray_rules_v1` (**rules only — never payload data**). Ships the "UK credit decisioning" example pack inline (`EXAMPLE_PACK`): RAG value validation, CIFAS case-type whitelist, bureau score 0–1000 sanity, APR 0–100 range. Rules run inside `analyse()` after built-ins; findings get `cat:"custom"`.

### ✅ P3 — Schema inference + export
`inferSchema()` — draft-07: types, required (keys present in all array siblings), enums for low-cardinality strings (≥3 samples, ≤8 distinct; **PII-detected fields never contribute enum values**), format hints (date, date-time, email). Copy/download buttons in Insights.

### ✅ P4 — Shareable finding report
"Report" button → Markdown summary of findings + PII counts, values masked; raw PII values only included when mask is off AND the user confirms.

### ✅ Upload + drag & drop + JSON repair
Header "Upload" button and whole-window drag-and-drop (`loadFromFile`, `#dropVeil`). `repairJSON()` fixes malformed input on request ("Attempt repair" appears on parse failure): smart quotes, JSONP wrappers, comments, single quotes, unquoted keys, trailing commas, Python/JS literals (`True`/`None`/`NaN`/`Infinity`/`undefined`), NDJSON/JSONL wrapping. Repairs are surfaced as an info finding (`cat:"repair"`) — a producer emitting broken JSON is itself a defect.

### ✅ JSONPath query box (was a nice-to-have)
"Query" tab — `runQuery()`/`tokenizeQuery()` subset: `$.key`, `["key"]`, `[n]`/`[-n]`, `[*]`/`.*`, `..key` deep scan, `[?(@.path)]`, `[?(@.path op literal)]` (`== != > >= < <=`). Results table with jump links; errors shown inline.

### ✅ Beautify / Minify / Sort keys
Tree-pane toolbar: Beautify copies 2-space formatted JSON (Alt-click = 4-space), Minify copies minified, Shift-click on either downloads instead. "A→Z" toggles sorted object keys in the tree AND in emitted output (`sortDeep`; key order is not semantic so this is lossless). Both emitters run `maskDeep` first when the PII mask is on — the mask contract covers whole-payload output too.

### ✅ Click-to-copy (part of keyboard-nav nice-to-have)
Clicking a key/index in the tree copies its dot-path; clicking a value copies the value — blocked with a toast when the value is masked. `copyText()` uses the Clipboard API with an execCommand fallback; feedback via `#toast`.

## Backlog (priority order)

### P5 — Performance pass
- Virtualised tree rendering for payloads >50k nodes (windowing on scroll).
- Web Worker for `walk`/`analyse` on files >2MB, with a progress state on the scan strip.

### Nice-to-haves (unprioritised)
- Dark/light theme toggle (dark is default and primary).
- Keyboard nav in tree (↑↓ move, ←→ collapse/expand, Enter copy path).
- Aggregate quality stats per NDJSON record (basic NDJSON→array wrapping ships via repair).
- Related-values profile per key (JSON Hero-style: all values for a key across array siblings, incl. nulls).
- TypeScript interface generation from the inferred schema (JSON Crack-style).

## Testing

No test framework. Manual smoke test = load the built-in demo payload (`btnDemo`) — it is deliberately dirty and must trigger **every** built-in detector. If you add a detector, extend the demo payload so it fires there. After any change:

1. Demo loads, scan strip shows critical + warnings + PII segments.
2. Search "dob" → hits navigate with Enter.
3. Click a finding path → tree expands and scrolls to it.
4. Mask toggle hides values in tree, PII tab, flatten tab, and CSV export.
5. CSV export downloads and opens.
6. Paste invalid JSON → error message includes approximate line number, and "Attempt repair" appears; repairing `{'a': 1, b: True,}` succeeds and adds the repair info finding.
7. Upload button and drag-and-drop both load a `.json` file; NDJSON input repairs into an array.
8. Query tab: `$..score` returns 3 matches on the demo; `$.bureau[?(@.score>100)]` returns transunion only; a bad expression shows an inline error.
9. Insights: inferred schema renders, Copy/Download work, `dob` gets `format: date`.
10. Click a tree key → "Path copied" toast; click a masked value → blocked with a toast.
11. Beautify/Minify copy parseable JSON; A→Z re-orders the tree and the copied output; with mask on, copied output has `••••••` for PII values and untouched non-PII values.
12. `node --check` passes on the extracted script block.

## Sister app: Sage X-Ray — Ledger Workbench (`sage.html`)

Same architecture rules as `json.html`: one file, one IIFE, strict mode, vanilla JS, design tokens shared with JSON X-Ray, `esc()` on everything rendered, UK English. Built for the client's Sage estate.

**Script structure** (matters for testing): the IIFE is split by a
`/* ================= DOM LAYER ================= */` marker. Everything above it is pure
(parsing + analysis, no DOM access) and is exercised headlessly by slicing the script at the
marker — keep new detectors above the marker and DOM code below it.

Key pure functions: `parseCSV` / `mapColumns` (fuzzy header aliases in `COL_ALIASES`),
`parseInput` (CSV or Sage Business Cloud JSON — arrays, `$items`, `items`, `transactions`;
nested objects flattened), `parseDate` (UK dd/mm/yyyy + ISO), `normaliseTaxCode`
(T-codes + Business Cloud rate names), `analyse` (the quality engine), `benfordCalc`
(Nigrini MAD), `computeStats`. `analyse` reads an injectable clock from `txs._today` so the
demo and tests are deterministic (demo pins 2026-07-15).

**Detector families (21)** — the demo ledger must fire every one: unreadable amounts ·
rows with the wrong number of columns · totals rows found and excluded · postings with no
date · duplicate postings · VAT-vs-tax-code arithmetic · VAT sign disagreeing with net ·
credit notes carrying a negative amount · unbalanced journals · SI **and PI** sequence gaps
(per-pair gaps ≤10 only) · threshold-skimming clusters · negative invoices · future-dated ·
unparseable dates · weekend postings · stale (>2y) · missing references · missing tax codes ·
tax codes the VAT check cannot verify · round sums ≥£500 · Benford deviation.

**Rules the pure layer must keep** (each was a defect found by adversarial audit; the
regression suite pins every one):

- **`parseMoney` is strict.** It reads bracket negatives `(1,250.00)`, trailing minus
  `1250.00-` and `CR`/`DR` suffixes — all Sage's own export notations — and it *refuses*
  anything ambiguous rather than guessing. A stripped comma turns `"9,50"` into 950;
  `parseFloat` prefix-parses `"12abc"` into 12. Both put a fabricated figure into a total.
- **A null amount is a finding, not a skipped row.** There was a detector for unreadable
  dates and none for unreadable amounts, so a bracket-negative credit note vanished out of
  the headline figure in silence. Any surface printing a total must also print its coverage
  — `computeStats` returns `netRows`/`missingNet`/`datedRows`/`missingDate` for exactly this.
- **`parseCSV` opens a quoted cell only at cell start.** A quote mid-cell (`5" reel`) is
  literal text; treating it as a quote character swallowed the rest of the file into one
  cell and the parse still "succeeded".
- **`parseDate` rejects impossible calendar dates.** `Date.UTC` rolls `31/02` into March —
  a `31/03` typo would otherwise relocate a posting into a different VAT quarter. Two-digit
  years are windowed (`>70` → 1900s), not blindly `+2000`.
- **`fmtGBP` is signed**; `fmtMag` is the explicit magnitude for the few places one is
  wanted (bar widths, "differ by"). Rendering −£2,000 of supplier credit as "Expenditure
  £2,000.00" turns money coming back into money going out.
- **A breakdown must contain every line its own total contains.** `rank()` is for top-N
  lists only; `breakdown()` keeps net-negative categories. Filtering them out left a P&L
  table — and its CSV export — that did not add up to the total printed underneath it.
- **Journals are keyed on reference AND date.** Sage users reuse one reference for a
  recurring monthly journal; grouping on reference alone let two broken journals cancel out
  and neither be reported.
- **The duplicate key is the whole posting**, normalised for case and with the parsed date
  rather than the raw string. Nominal and details belong in it — one invoice split across
  two nominals shares everything else and is not a duplicate.
- **Threshold skimming needs a cluster, not a hit.** ~3.6% of any ledger falls in a 5% band
  under a threshold by arithmetic alone, so the detector compares each band against the
  mirror band just above it and fires only on the asymmetry. This detector is effectively a
  fraud accusation; a false positive here is a serious defect, not noise.
- **Benford needs `BENFORD_MIN_N` (120) amounts and uses chi-squared, not raw MAD.**
  Nigrini's MAD cutoffs are large-sample constants: at n=25 perfectly Benford data sits at
  MAD ≈ 0.05, three times the "nonconformity" line, so the old n≥25 gate accused every small
  ledger. Journal legs are excluded — each JD is matched by an identical JC, so a recurring
  journal swamps the distribution.
- **Bank and cash lines are first-class.** `BANK_DIR` gives BP/CP/VP and BR/CR/VR opposite
  directions (a rent refund reduces rent), they are inside `VATABLE_TYPES`, and their VAT
  reaches the VAT summary. They are among the most common postings in a Sage estate.
- **A credit type plus a negative amount states the direction twice.** Sage 50 holds credit
  notes as positive magnitudes, so such a row is a mixed convention and could mean either
  direction. It is excluded and reported, never guessed at.

**AI boundary — read carefully.** The "never transmit payload data" rule holds for sage.html
with one deliberate, explicit exception: the **Ask Claude** button on the AI Copilot tab sends
the generated briefing text + the user's question to `api.anthropic.com`, and only after the
user pastes their own key AND ticks the consent checkbox. The key is held in a form field
only — never persisted, and blanked after each send. Never widen this: no auto-send, no
telemetry, no other endpoints, no key storage. The briefing is built locally. **Loading a
ledger clears the briefing and un-ticks consent** — otherwise Ask Claude transmits the
*previous* client's figures while attributing the answer to the new one, which is the one
way real client data can leave this machine unintended. `MASK` covers account names and
narrative but **not references or amounts**; references reach the briefing through finding
titles, so the briefing says exactly that rather than claiming a blanket mask.

**Model routing.** `routeModel(choice, question, findings, txCount)` (pure layer) picks the
model. Manual tiers: Fast = `claude-haiku-4-5`, Balanced = `claude-sonnet-5`, Deep =
`claude-opus-5`, Maximum = `claude-fable-5` (**manual only** — auto never routes to it).
Auto scores ledger complexity (severity-weighted findings, capped at 12, plus a size bump)
plus question shape (analytical keywords, multiple questions, length) and routes ≥14 →
deep, ≥6 → balanced, else fast. The chosen model and the reason are always surfaced to the
user (`#aiMeta`). Keep routing logic in the pure layer.

**Two views.** `#views` switches between **Dashboard** (full-width overview — the default
landing view after load) and **Workbench** (the original split: transaction grid + findings /
insights / AI tabs). Non-specialist users live on the Dashboard; analysts drill into the
Workbench. Anything added to one must respect `MASK` in both.

**Dashboard aggregation** (pure layer): `classifyNominal` maps Sage UK nominal ranges to
kinds; `classifyTx` is direction-aware — sales/purchase types use document sign
(SI/PI +, SC/PC -), and journals apply double-entry signs (a JD to an income nominal
*reduces* income). Only genuine sales/purchase documents populate the customer/supplier
rankings — bank and journal accounts are excluded. `buildDashboard` returns KPIs, monthly
income/expense series, expense categories, top customers/suppliers, a P&L split and a VAT
summary. Transactions with unreadable dates are counted in totals but cannot be plotted —
`undated`/`undatedIncome`/`undatedExpense` exist so the chart discloses the gap rather than
silently under-reporting. Never let a surface report a total it did not actually examine.

**Smoke test (sage.html)** after any change:

0. `node tests/sage.test.mjs` passes (116 assertions over the pure layer — the regression
   suite; keep it green and extend it with each detector).
1. Demo loads and lands on **Dashboard**; strip shows 7 critical / 8 warnings / 6 info,
   and discloses coverage (`net … over 184 of 186 rows`, `… (2 undated)`);
   all 21 detector families appear in the Workbench.
1b. Dashboard: KPI row, monthly grouped-bar chart with the undated-transactions note,
   ranked bars filled, P&L and VAT summaries reconcile, both report CSVs download.
2. Click a finding row-link → grid scrolls, row highlighted.
3. Mask toggle hides Account + Details in grid, top-accounts list, and regenerated briefing.
4. Insights: Benford chart renders with observed bars + expected markers; data table opens.
5. Upload and drag-and-drop both load a `.csv`; a JSON array of Business Cloud-style records parses.
6. AI tab: briefing generates, Copy/Download work; Ask button stays disabled until consent
   ticked; model selector defaults to Auto and the answer is annotated with the routed model.
7. `node --check` passes on the extracted script block; the pure layer runs headless when
   sliced at the DOM-layer marker.

## Sister app: Migration X-Ray — Sage 50 → ERPNext (`migrate.html`)

Same one-file/IIFE/pure-DOM-split rules. Tooling for the client's Sage 50 → self-hosted
ERPNext migration (parallel run, cutover at Sage contract expiry). Domain knowledge lives
in the `sage-migration` skill — read it first.

Three tabs: **Convert** (Sage exports → ERPNext import CSVs with defect profiling),
**Reconcile** (trial-balance or transaction-level comparison between the two systems
during the parallel run; "clean" report gates cutover), **Checklist** (cutover gates;
ticks in localStorage — never client data).

Key pure functions: `detectEntity` (fuzzy header scoring, then the **filename decides**
customers vs suppliers — Sage supplier records carry a Credit Limit too, so header bonuses
must never outvote it; a header/filename conflict is declared ambiguous rather than won),
`convertParties` / `convertItems` / `convertNominal` (→ ERPNext v15 Data Import shapes;
opening journal must balance and reports its delta), `rootTypeFor` (Sage UK nominal ranges →
ERPNext root types), `parseMoney` (strict), `reconcile`/`parseSide` (TB or transaction shape
auto-detect, per-account aggregation, ref+amount multiset diff), `accountCode`,
`checkWidth` / `checkFormulaInjection` (shared across all three converters).

**Rules the pure layer must keep** (each was a defect found by adversarial audit):

- **`parseMoney` is kept behaviourally identical to `sage.html`'s `parseMoney` and
  `bom.html`'s `parseNum`.** When the three disagree, the same cell converts one way and
  audits another. It reads `(1,250.00)`, `1250.00-` and `CR`/`DR`; it refuses `(-5.00)`,
  `8odd`, and any comma that is not a thousands separator. `"9,50"` once became 950, and
  through `convertNominal` the opening journal **balanced perfectly at 100×** — so the
  delta check could never catch it.
- **`rootTypeFor` requires `^\d{1,4}$`.** `parseInt` prefix-parsed `"4,000"` to 4 and filed
  a sales nominal under fixed assets. A 5-digit chart is a *different scheme*, not a chart
  where every account is suspense — it returns `null` and says so. Suspense is 9000–9999,
  a bounded range, not a catch-all fallthrough.
- **`accountCode` must not truncate at the first non-digit.** ERPNext separates code from
  name with a *spaced* dash (`1200 - Bank`); Sage sub-accounts use a bare one (`1200-01`).
  Collapsing both to `1200` merged two bank accounts and an £800 misallocation reconciled
  clean.
- **`parseSide` consults the balance column when the legs are null OR an explicit zero.**
  ERPNext v15's own Trial Balance emits period movement of `0.00` alongside a closing
  balance; reading the zeros as the answer destroyed every figure in the ledger and
  reported clean. `convertNominal` already did this — its sibling did not. **Check every
  fix against its sibling function.**
- **Anything unexamined blocks a clean verdict**: unreadable amounts, blank account codes,
  rows with no amount in any column, misaligned rows, repeated codes in a trial balance,
  and a side that cannot be compared at transaction level. `reconcile` also returns `notes`
  naming *which columns it actually read* — a clean verdict on the wrong columns is still
  a clean verdict.
- **Shape mismatch is checked within each side, not only between them.** When both sides
  failed transaction detection the tool silently dropped to totals-only, and two ledgers
  holding entirely different invoices reconciled clean on matching account totals.
- **Transaction references are matched case- and space-insensitively**; ERPNext item codes
  and party names are matched case-insensitively because MariaDB's default collation is.
- **Formula-shaped values (`=`, `@`) are reported, never rewritten.** These CSVs are opened
  in Excel by the client's accountant, but mangling a value would corrupt the import — the
  data has to survive intact, so the user is told instead.

**Smoke test (migrate.html)** after any change:

0. `node tests/migrate.test.mjs` passes (196 assertions over the pure layer — the
   regression suite; keep it green and extend it with each fix).
1. Demo loads all four exports; strip shows blocking issues + warnings; every issue class
   fires (dup refs, bad VAT no, missing postcode, dup stock code, negative qty, missing
   UoM, cost>sale, zero-cost stock, suspense-range nominal, unparseable amount, TB
   imbalance). `customers.csv` detects as Customers and `suppliers.csv` as Suppliers.
2. Each entity card offers its download(s); downloaded CSVs re-parse cleanly.
3. Reconcile demo pair → 2 deltas + 1 Sage-only account, **plus the unreadable-amount
   warning** (the demo must exercise a false-clean guard, not pass it by luck), and the
   "columns read" notes appear. Report downloads as .md.
4. Checklist ticks persist across reload and reset works.
5. `node --check` passes; pure layer runs headless when sliced at the DOM-layer marker.

## Sister app: BOM X-Ray — Bill of Materials Workbench (`bom.html`)

Same one-file/IIFE/pure-DOM-split rules. Analyses multi-level bills of materials from
Sage Manufacturing, ERPNext or spreadsheet exports. Five views: **Overview** (default —
KPIs, attention list, rolled-up cost per product, most-used components, cost make-up),
**Structure** (explodable tree), **Issues**, **Where used**, **Load**.

Key pure functions: `parseBOM` (fuzzy headers via `BOM_ALIASES`; one row per parent →
component line; returns `orphans` — rows naming only one side, which cannot join the graph),
`buildGraph` (nodes with `children`/`parents`, plus `uoms`/`costs`/`statuses`/`statedCosts`
Sets so contradictions across lines are catchable, and a per-line `scrapBad` flag),
`findCycles` (DFS three-colour — readable cycle *paths*, for display only), `cyclicNodes`
(iterative Tarjan — complete SCC *membership*, which is what costing excludes),
`rollUpCosts` (leaves upward, qty × cost × scrap; **cycle members and any assembly with an
incomplete branch resolve to `null`, never a fabricated number**), `maxDepth`, `whereUsed`
(multi-level upward walk, cycle-safe, sums duplicate lines), `analyseBOM`, `toERPNextBOM`.

**Cycle paths and cycle membership are different sets.** A node can sit inside a
strongly-connected component without lying on the path any one back-edge closed, so
`findCycles` under-reports membership by design. Anything numeric — costing, depth, stats,
where-used — must take the `cyclicNodes` Set, never the `findCycles` list.

**Costing rules that must not be relaxed:**

- A roll-up is either complete or `null`. Never substitute zero for a missing component
  cost — an understated product cost that looks authoritative is worse than an obvious gap.
  The UI shows "no roll-up" and names the reason.
- The same applies to a scrap percentage that will not parse or falls outside 0–100: the
  true consumption is unknown, so the branch resolves to `null` rather than being costed as
  if scrap were zero.
- `fmtMoney` is **signed**. A negative cost is a defect; rendering `-£480` as `£480` turns
  it into a plausible figure nobody questions. `fmtMoneySet` exists because two genuinely
  different values can format to the same 2dp string, which makes a "these disagree"
  message read as nonsense — it falls back to full precision when that happens.
- `parseNum` refuses commas that are not thousands separators. `"9,50"` is a European
  decimal comma or a typo; stripping it blindly turns 9.50 into 950.
- The ERPNext export carries `Scrap %` and `Qty Consumed Per Unit` so the import can
  reproduce the cost this app displayed. An export that cannot reproduce the number the
  user signed off is not a valid export.

**Detector families (20)** — the demo BOM must fire every one: rows with no assembly or no
component · circular references · conflicting units for one part · conflicting costs for one
part · contradictory statuses for one part · more than one stated cost for an assembly ·
unreadable/missing quantities · negative quantities · zero quantities · unusable scrap
percentages · purchased parts with no cost · **negative** purchased-part costs · parts costed
at zero · stated cost vs rolled-up cost drift · obsolete parts on live BOMs · duplicate
component lines on one parent · missing units of measure (on assemblies too, not just
leaves) · missing descriptions · deep nesting (≥4 levels) · single-component assemblies.

A status column named `Active` or `Disabled` holds a boolean, not a lifecycle word — under
`Active`, the value `N` means obsolete. `isObsoleteStatus(status, alias)` reads the matched
header alias to decide which convention applies; never test `OBSOLETE_RE` directly.

**Smoke test (bom.html)** after any change:

0. `node tests/bom.test.mjs` passes (81 assertions over the pure layer, one per fixed
   defect — this is the regression suite, keep it green and extend it with each detector).
1. Demo loads and lands on Overview; strip shows 11 blocking / 6 warnings / 3 info; all 20
   families appear on Issues.
2. Overview: FG-BIKE-01 shows a rolled-up cost, FG-BIKE-02 and FG-TRAILER-01 are named as
   incomplete with the reason; cost make-up bars render and the negative contribution
   (RM-REBATE, -£4.80) shows in the warning colour, not as a small positive.
3. Structure: tree expands/collapses; the circular branch is outlined and stops with
   "circular — stopped"; obsolete and no-qty badges show.
4. Clicking any code jumps to Where used; RM-BEARING resolves 3 parent paths.
5. All three exports download and re-parse; `bom_import.csv` has one row per assembly.
6. `node --check` passes; pure layer runs headless when sliced at the DOM-layer marker.

## Testing beyond the smoke tests

Three committed suites, one per accounting app: `tests/bom.test.mjs` (81 assertions),
`tests/sage.test.mjs` (116) and `tests/migrate.test.mjs` (196). Each slices its app at the
DOM-layer marker, evaluates the pure half in a `vm` context with no `document`, and asserts
against the exact inputs that broke each fixed defect. Run them with
`node tests/<app>.test.mjs`. Never write a throwaway harness in a scratch directory — an
earlier `migrate.html` suite was written that way and was simply gone by the next session.

**A suite that has never failed has not been shown to work.** `tests/migrate.test.mjs`
passed on its first run, which is exactly when to distrust it, so it was mutation-tested:
guards were broken one at a time (`parseMoney` accepting `(-5.00)`, the transaction key
reverting to absolute amounts, `warnings` no longer blocking a clean verdict, journal legs
left unrounded, quotes opening mid-cell, `accountCode` truncating at the first non-digit,
the filename no longer overriding header bonuses, and so on). **21 of 21 mutations are
caught.** Do the same after adding a block of assertions — passing is not evidence, and two
weak assertions were found and tightened this way.

`json.html` has no suite. It is the lowest-stakes app (payload QA, not client accounting
data) and has never been audited.

## Deployment

Static hosting only. GitHub Pages is wired up via `.github/workflows/pages.yml` (publishes the repo root on every push to `main`); one-time setup is Settings → Pages → Source: **GitHub Actions**. `vercel deploy` or an intranet share also work. No env vars, no server.
