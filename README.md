# JSON X-Ray — Payload Workbench

A single-file, zero-dependency, fully client-side JSON inspection webapp for data/decisioning professionals (credit risk, bureau payloads, API traces). It goes beyond "beautify JSON" tools: it actively scans payloads for data-quality defects and PII.

**Nothing ever leaves the browser.** There is no server, no build step and no network call carrying payload data — a deliberate design constraint for inspecting sensitive credit-decisioning connector payloads (TransUnion, Equifax, CIFAS, affordability engines) during QA/testing.

## Features

- **Load any way you like** — paste, **Upload** button, or **drag-and-drop a .json file anywhere on the window**. Malformed input? **Attempt repair** fixes what QA actually pastes: single quotes, unquoted keys, trailing commas, comments, smart quotes, Python `True`/`False`/`None`, `NaN`/`Infinity`, JSONP wrappers and NDJSON/JSONL — and flags the repair as a finding, because a producer emitting broken JSON is itself a defect.
- **Tree explorer** — collapsible payload tree with search (keys, paths, values; Enter cycles matches), clickable path links everywhere, node/size stats, and **click-to-copy**: click any key to copy its dot-path, any value to copy the value (mask-aware).
- **Beautify / Minify / Sort** — copy formatted (2-space; Alt-click 4-space) or minified JSON, Shift-click to download instead; **A→Z** toggles sorted keys in the tree and the emitted output. Both outputs respect the PII mask.
- **Quality engine** — 14 built-in detectors for the defects that actually break decisioning:
  inconsistent key spellings, duplicate concepts (`dob` + `dateOfBirth`), mixed types per key,
  booleans/numbers stored as strings, legacy Y/N flags, mixed date/timestamp formats,
  impossible or conflicting dates of birth, sentinel values (999/9999/-1/9999.99),
  `"Infinity"` string literals, empty containers, null density, and invisible whitespace padding.
- **PII scanner + mask** — heuristics for Email, Phone (UK), Postcode, Date of birth, Income, Account number, Name, Address and Reference ID. One toggle masks detected values across the tree, tables, CSV export and report.
- **Query tab** — JSONPath subset (`$.key`, `["key"]`, `[0]`/`[-1]`, `[*]`/`.*`, `..key` deep scan, `[?(@.path)]` existence and `[?(@.path op value)]` comparison filters) with jump-to-tree results.
- **Schema inference** — draft-07 JSON Schema inferred from the payload (types, required-in-all-siblings, enums for low-cardinality strings, date/date-time/email format hints; PII fields never contribute enum values). Copy or download from the Insights tab.
- **Diff mode** — load a second payload ("Compare against…") and get added / removed / changed-value / changed-type rows on flattened paths, with clickable jumps into the primary tree.
- **Custom rule packs** — user-defined detectors as JSON (key/path/value regex, type filter, negate-for-whitelist), persisted in localStorage (rules only — never payload data). Ships with a **UK credit decisioning** example pack: RAG value validation, CIFAS case-type whitelist, bureau score sanity range, APR range check.
- **Exports** — flattened-leaves CSV, and a Markdown findings report (PII values masked unless you explicitly confirm otherwise) ready for a Jira ticket or Confluence page.
- **Demo payload** — deliberately dirty; triggers every built-in detector and every example rule, so you can see the whole engine at a glance.

## Sage X-Ray — Ledger Workbench (`sage.html`)

A sister app in the same file, same rules: single-file, zero-dependency, fully client-side — built for clients running **Sage**. Paste or drop a Sage 50 audit-trail/transaction CSV (headers matched fuzzily, any column order) or Sage Business Cloud API JSON, and a ledger-specific quality engine scans it:

- **15 detector families** — duplicate postings, VAT-vs-tax-code arithmetic (T0/T1/T2/T5/T9 at UK rates), unbalanced journals, sales-invoice sequence gaps, amounts skimming just below £1k/£5k/£10k/£25k approval thresholds, credits posted as negative invoices, future-dated / weekend / stale / unparseable dates, missing references and tax codes, round-sum postings, and a **Benford's-law first-digit analysis** (Nigrini MAD bands) with an inline chart.
- **Findings link to rows** — click a finding to jump to and highlight the offending transactions; flagged rows are tinted by severity in the grid.
- **Mask toggle** — hides account names and narrative across the grid, insights and every export, so screenshots and briefs are safe to share.
- **AI briefing pack** — one click builds a Markdown brief (totals, findings, Benford table, top accounts, analyst instructions) ready to paste into any assistant the client permits. Built locally; respects the mask.
- **Ask Claude (optional, BYO key)** — behind an explicit consent checkbox, sends *only* the briefing plus your question directly from the browser to the Anthropic API. The key lives in memory only. Everything else stays offline, same as JSON X-Ray.
- **Demo ledger** — deliberately dirty; fires all 15 detector families.

Open `sage.html` — it deploys alongside `index.html` on the same Pages site.

## Run it

Open `index.html` (payloads) or `sage.html` (ledgers) in any modern browser. That's it.

## Deploy to GitHub Pages

The repo ships with a Pages workflow (`.github/workflows/pages.yml`) that publishes the repo root on every push to `main`.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. After the next push to `main` the app is live at `https://<owner>.github.io/<repo>/`.

(Any other static host works too — Vercel, Netlify, an intranet share — it's one file.)

## Testing

No test framework by design. Manual smoke test: load the demo payload and confirm the scan strip shows critical + warning + PII segments; see `CLAUDE.md` for the full checklist.
