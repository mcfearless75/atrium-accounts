---
name: xray-conventions
description: Architecture rules and testing conventions for the X-Ray app family (index.html, sage.html, migrate.html). Use before creating or modifying any of the single-file apps in this repo — covers the one-file constraint, the pure/DOM split, masking, escaping, and the headless test harness.
---

# X-Ray family conventions

Every app in this repo is a **single self-contained HTML file**: one IIFE, strict mode,
vanilla JS, no dependencies, no build step, no CDN scripts (Google Fonts is the only
external fetch and the app must degrade gracefully without it). Deployable by copying
one file. Never break this.

## Privacy contract (non-negotiable)

Payload/ledger data never leaves the browser. No network requests carrying user data,
no telemetry, no storage of client data (localStorage may hold *rules* or *checklist
ticks*, never transactions or payloads). The single sanctioned exception is the
consent-gated, bring-your-own-key "Ask Claude" call in sage.html — never widen it.

## Code structure

Split every app's script at a marker:

    /* ================= PURE LAYER ... ================= */
    ...parsing + analysis, no DOM access...
    /* ================= DOM LAYER ================= */
    if (typeof document === 'undefined') return;

New detectors, parsers and converters go **above** the marker. This is what makes the
headless test harness work.

## Testing (no framework, by design)

After any change to an app:

1. Extract the script block and run `node --check` on it.
2. Slice at the DOM-layer marker, wrap the pure layer in `new Function(...)`, and run
   the demo data through the pipeline — every detector/issue family must fire on the
   deliberately dirty demo. If you add a detector, extend the demo so it fires.
3. Render in Chromium (Playwright, `executablePath: '/opt/pw-browsers/chromium'`),
   click the demo button, screenshot each tab, assert zero page errors.
4. Follow the per-app smoke-test checklist in CLAUDE.md.

## UI conventions

- Shared design tokens (CSS variables at `:root`) — same palette across all apps;
  never hardcode colours.
- `esc()` everything user-supplied before innerHTML — payloads are untrusted; XSS via
  a crafted export is the main attack surface.
- Respect the mask where the app has one: any new surface showing leaf values checks
  `MASK`.
- UK English. Event delegation over per-node listeners. Debounce inputs.
  `prefers-reduced-motion` respected; focus-visible outlines intact.
- Chart colours must pass the dataviz palette validator on the dark surface
  (`#0d1117`); current validated pair: observed `#3d8bdf`, expected `#b3841a`.

## AI model routing (sage.html)

`routeModel()` lives in the pure layer. Tiers: fast `claude-haiku-4-5`, balanced
`claude-sonnet-5`, deep `claude-opus-5`, max `claude-fable-5` (manual only — auto
never routes to max). Auto scores severity-weighted findings + question shape;
thresholds ≥14 deep, ≥6 balanced. Always surface which model answered and why.
