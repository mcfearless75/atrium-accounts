# JSON X-Ray — Payload Workbench

A single-file, zero-dependency, fully client-side JSON inspection webapp for data/decisioning professionals (credit risk, bureau payloads, API traces). It goes beyond "beautify JSON" tools: it actively scans payloads for data-quality defects and PII.

**Nothing ever leaves the browser.** There is no server, no build step and no network call carrying payload data — a deliberate design constraint for inspecting sensitive credit-decisioning connector payloads (TransUnion, Equifax, CIFAS, affordability engines) during QA/testing.

## Features

- **Tree explorer** — collapsible payload tree with search (keys, paths, values; Enter cycles matches), clickable path links everywhere, and node/size stats.
- **Quality engine** — 14 built-in detectors for the defects that actually break decisioning:
  inconsistent key spellings, duplicate concepts (`dob` + `dateOfBirth`), mixed types per key,
  booleans/numbers stored as strings, legacy Y/N flags, mixed date/timestamp formats,
  impossible or conflicting dates of birth, sentinel values (999/9999/-1/9999.99),
  `"Infinity"` string literals, empty containers, null density, and invisible whitespace padding.
- **PII scanner + mask** — heuristics for Email, Phone (UK), Postcode, Date of birth, Income, Account number, Name, Address and Reference ID. One toggle masks detected values across the tree, tables, CSV export and report.
- **Diff mode** — load a second payload ("Compare against…") and get added / removed / changed-value / changed-type rows on flattened paths, with clickable jumps into the primary tree.
- **Custom rule packs** — user-defined detectors as JSON (key/path/value regex, type filter, negate-for-whitelist), persisted in localStorage (rules only — never payload data). Ships with a **UK credit decisioning** example pack: RAG value validation, CIFAS case-type whitelist, bureau score sanity range, APR range check.
- **Exports** — flattened-leaves CSV, and a Markdown findings report (PII values masked unless you explicitly confirm otherwise) ready for a Jira ticket or Confluence page.
- **Demo payload** — deliberately dirty; triggers every built-in detector and every example rule, so you can see the whole engine at a glance.

## Run it

Open `index.html` in any modern browser. That's it.

## Deploy to GitHub Pages

The repo ships with a Pages workflow (`.github/workflows/pages.yml`) that publishes the repo root on every push to `main`.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. After the next push to `main` the app is live at `https://<owner>.github.io/<repo>/`.

(Any other static host works too — Vercel, Netlify, an intranet share — it's one file.)

## Testing

No test framework by design. Manual smoke test: load the demo payload and confirm the scan strip shows critical + warning + PII segments; see `CLAUDE.md` for the full checklist.
