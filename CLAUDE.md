# Atrium — Accounts &amp; Migration Workbench

Project brief for Claude Code. Read this fully before making changes.

## What this is

**Atrium** is a suite of four single-file, zero-dependency, fully client-side workbenches
sharing one product shell. Each loads an export, scans it for defects in plain English, and
emits whatever files the next step needs. Nothing is uploaded; nothing is stored server-side.

The original member — JSON X-Ray (`json.html`) — is a JSON inspection app for
data/decisioning professionals (credit risk, bureau payloads, API traces). It goes beyond
"beautify JSON" tools: it actively scans payloads for data-quality defects and PII.

**Owner:** PaulMc (Bluewater Associates). Primary real-world use case: inspecting credit decisioning connector payloads (TransUnion, Equifax, CIFAS, affordability engines) during QA/testing at a UK financial services client, and migrating a client off Sage 50 onto self-hosted ERPNext. Payloads and ledgers are sensitive — the no-server, no-network architecture is a deliberate design constraint, not an accident. **Never add any code that transmits payload data anywhere.**

## Repo layout

```
index.html                    ← Atrium home dashboard (module cards + migration workflow)
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
`index.html`, nav across all five pages with `class="on"` on the current one, and a
`100% CLIENT-SIDE` marker. The markup and its CSS block are **duplicated verbatim** in each
file — that is the cost of the single-file constraint, and it is deliberate. If you change
the nav, change it in all five files and re-check that each page marks the right link `on`.
`index.html` is a static page with no script block; it must stay that way.

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

**Detector families (15)** — the demo ledger must fire every one: duplicate postings ·
VAT-vs-tax-code arithmetic · unbalanced journals · SI sequence gaps (per-pair gaps ≤10 only) ·
threshold skimming (£1k/£5k/£10k/£25k, 5% band) · negative invoices · future-dated ·
unparseable dates · weekend postings · stale (>2y) · missing references · missing tax codes ·
non-standard tax codes · round sums ≥£500 · Benford deviation (needs n≥25; med >1.5% MAD,
info >1.2%).

**AI boundary — read carefully.** The "never transmit payload data" rule holds for sage.html
with one deliberate, explicit exception: the **Ask Claude** button on the AI Copilot tab sends
the generated briefing text + the user's question to `api.anthropic.com`, and only after the
user pastes their own key AND ticks the consent checkbox. The key is held in a form field
only — never persisted. Never widen this: no auto-send, no telemetry, no other endpoints, no
key storage. The briefing itself is built locally and respects `MASK`.

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

1. Demo loads and lands on **Dashboard**; strip shows 4 critical / 5 warnings / 6 info;
   all 15 detector families appear in the Workbench.
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

Key pure functions: `detectEntity` (fuzzy header + filename-hint scoring — the filename
tie-breaks customers vs suppliers), `convertParties` / `convertItems` / `convertNominal`
(→ ERPNext v15 Data Import shapes; opening journal must balance and reports its delta),
`rootTypeFor` (Sage UK nominal ranges → ERPNext root types), `parseMoney` (strict —
rejects malformed amounts; accepts `(1,250.00)` bracket negatives), `reconcile`/`parseSide`
(TB or transaction shape auto-detect, per-account aggregation, ref+amount multiset diff).

**Smoke test (migrate.html)** after any change:

1. Demo loads all four exports; strip shows blocking issues + warnings; every issue class
   fires (dup refs, bad VAT no, missing postcode, dup stock code, negative qty, missing
   UoM, cost>sale, zero-cost stock, suspense-range nominal, unparseable amount, TB
   imbalance).
2. Each entity card offers its download(s); downloaded CSVs re-parse cleanly.
3. Reconcile demo pair → 2 deltas + 1 Sage-only account, report downloads as .md.
4. Checklist ticks persist across reload and reset works.
5. `node --check` passes; pure layer runs headless when sliced at the DOM-layer marker.

## Sister app: BOM X-Ray — Bill of Materials Workbench (`bom.html`)

Same one-file/IIFE/pure-DOM-split rules. Analyses multi-level bills of materials from
Sage Manufacturing, ERPNext or spreadsheet exports. Five views: **Overview** (default —
KPIs, attention list, rolled-up cost per product, most-used components, cost make-up),
**Structure** (explodable tree), **Issues**, **Where used**, **Load**.

Key pure functions: `parseBOM` (fuzzy headers via `BOM_ALIASES`; one row per parent →
component line), `buildGraph` (nodes with `children`/`parents`, plus `uoms`/`costs` Sets so
contradictions across lines are catchable), `findCycles` (DFS three-colour; returns every
distinct cycle), `rollUpCosts` (leaves upward, qty × cost × scrap; **cycle members and any
assembly with an incomplete branch resolve to `null`, never a fabricated number**),
`maxDepth`, `whereUsed` (multi-level upward walk, cycle-safe), `analyseBOM`, `toERPNextBOM`.

**Costing rule that must not be relaxed:** a roll-up is either complete or `null`. Never
substitute zero for a missing component cost — an understated product cost that looks
authoritative is worse than an obvious gap. The UI shows "no roll-up" and names the reason.

**Detector families (15)** — the demo BOM must fire every one: circular references ·
conflicting units for one part · conflicting costs for one part · unreadable/missing
quantities · negative quantities · zero quantities · purchased parts with no cost ·
parts costed at zero · stated cost vs rolled-up cost drift · obsolete parts on live BOMs ·
duplicate component lines on one parent · missing units of measure · missing descriptions ·
deep nesting (≥4 levels) · single-component assemblies.

**Smoke test (bom.html)** after any change:

1. Demo loads and lands on Overview; strip shows 7 blocking / 5 warnings / 3 info; all 15
   families appear on Issues.
2. Overview: two products show a rolled-up cost, FG-BIKE-02 is named as incomplete with the
   reason; cost make-up bars render.
3. Structure: tree expands/collapses; the circular branch is outlined and stops with
   "circular — stopped"; obsolete and no-qty badges show.
4. Clicking any code jumps to Where used; RM-BEARING resolves 3 parent paths.
5. All three exports download and re-parse; `bom_import.csv` has one row per assembly.
6. `node --check` passes; pure layer runs headless when sliced at the DOM-layer marker.

## Deployment

Static hosting only. GitHub Pages is wired up via `.github/workflows/pages.yml` (publishes the repo root on every push to `main`); one-time setup is Settings → Pages → Source: **GitHub Actions**. `vercel deploy` or an intranet share also work. No env vars, no server.
