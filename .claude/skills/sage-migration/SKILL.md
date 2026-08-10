---
name: sage-migration
description: Domain knowledge for the Sage 50 → ERPNext migration project — export formats, ERPNext import targets, nominal code mapping, VAT/MTD constraints, and the parallel-run assurance workflow. Use when working on migrate.html, the migration proposal, reconciliation logic, or anything touching Sage exports or ERPNext imports.
---

# Sage 50 → ERPNext migration

The client runs Sage 50 (no payroll), files MTD VAT to HMRC from it, and is migrating
to self-hosted ERPNext via a **parallel run that ends at Sage contract expiry**.
`migrate.html` is the tooling; the client-facing plan lives in the proposal artifact.

## Sage 50 exports we consume

Run from Sage 50 via File → Export / report CSV buttons. Headers vary by version, so
`migrate.html` matches them fuzzily (see `ENT` alias tables in the pure layer):

- **Customers / Suppliers** — Account Reference, Name, Address Lines, Postcode,
  Contact Name, Telephone, VAT Registration Number, Credit Limit (customers), Balance.
  The two share a shape: entity detection uses the *filename* as a tie-breaker, so
  keep "customer"/"supplier" in export filenames.
- **Products** — Stock Code, Description, Category, Sale Price, Cost Price,
  Quantity in Stock, Unit of Sale.
- **Nominal / Trial balance** — N/C, Name, Debit, Credit (or Balance).
- **Audit trail** — Type (SI/PI/SC/PC/BP/BR/JD/JC…), Account, Nominal, Date (UK
  dd/mm/yyyy), Ref, Details, Net, Tax, T/C. Parsed by sage.html's pure layer.

## Sage 50 UK default nominal ranges → ERPNext root types

0–999 Fixed Assets · 1000–1999 Current Assets (Asset) · 2000–2299 Current Liabilities ·
2300–2999 Long-term Liabilities (Liability) · 3000–3999 Capital (Equity) ·
4000–4999 Sales (Income) · 5000–5999 Purchases · 6000–6999 Direct Expenses ·
7000–8999 Overheads (Expense) · 9000+ Suspense/Mispostings (flag — resolve, don't
migrate). Implemented in `rootTypeFor()`.

## ERPNext import targets

Generated CSVs target ERPNext v15 Data Import templates: Customer, Supplier, Address
(linked by Link Document Type/Link Name), Item, the Chart of Accounts importer
(Account Number / Account Name / Root Type / Suggested Parent), and an opening
Journal Entry. **Column labels must be re-verified against the client's live ERPNext
instance during Phase 0** — treat the current headers as best-effort scaffolding, and
say so in any UI copy about them.

Opening journal must balance to the penny; the converter reports the debit/credit
delta and refuses silence on imbalance. Common cause: missing retained earnings or
control-account line in the TB export.

## VAT / MTD constraints

**Full detail and sourcing: `ERPNEXT-DEPLOYMENT.md` §7 — read that before touching
this section again, and update both together.**

- The community app once assumed as primary (`uk_vat`,
  `software-to-hardware/erpnext-vat-mtd`) is **ruled out**: no commits since
  July 2021, an open unanswered issue reports it doesn't install on v15, no
  flat-rate scheme support, and it pushes HMRC fraud-prevention-header compliance
  onto the client directly.
- Current best candidate: **Case Solved's "United Kingdom" app**
  (`CaseSolvedUK/uk-support`) — proprietary, pay-per-submission, claims HMRC
  recognition. ⚠ Unverified: v15 support (public listing describes v14),
  self-hosted support, current pricing.
- **HMRC-recognised bridging software is the lower-risk default right now**, not a
  fallback — it decouples filing from any ERPNext app's maintenance status. The
  handoff must be a file export, never hand-retyped figures (digital links have
  been mandatory since April 2021).
- **No separate MTD registration/sign-up step exists for an already VAT-registered
  business** — HMRC auto-enrolled everyone after August 2022. Don't budget lead
  time for "registration"; budget it for vendor onboarding instead.
- HMRC software authorisation expires after 18 months and must be re-granted.
- During parallel run: compute the VAT return in BOTH systems each quarter;
  accountant signs off the first matching quarter before cutover.
- HMRC requires 6-year record retention: final Sage dataset is exported and archived
  in full at cutover.

## Reconciliation semantics (migrate.html `reconcile()`)

Sides auto-detect as trial-balance (code + debit/credit/balance) or transaction list
(+ date + ref). Account codes are extracted from ERPNext "4000 - Sales - CO" names by
leading digits. Net = debit − credit; comparisons tolerate 0.005 rounding. Transaction
mode diffs (ref, |amount|) multisets both ways. A "clean" report = no deltas, no
one-sided accounts, no unmatched transactions — that is the cutover gate.
