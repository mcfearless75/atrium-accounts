# ERPNext deployment & configuration runbook

This is the document that turns "stand up ERPNext" from a research project into a
checklist. It's written for whoever holds the hosting credentials (Bluewater) to
execute — not for the client, and not something `help.html` covers.

**Read this alongside `PROJECT-STATE.md` (the deadline and open questions) and
`migrate.html` (the export/convert/reconcile tooling this runbook feeds into).**

## Why this document exists

Every item on the client's wish-list — BOM, invoicing, stock taking, inventory
management, dashboards and historical reporting — is a **native ERPNext module**.
None of it is missing software. All of it is blocked on one thing: an ERPNext
instance existing. Nothing in this project has stood one up yet. This document is
that prerequisite.

| Client wish-list item | ERPNext module | Work once the instance exists |
|---|---|---|
| BOM | Manufacturing (BOM doctype) | Import BOMs (`bom.html` → `bom_import.csv`), set costing method |
| Invoicing | Selling / Accounts (Sales Invoice) | Tax templates, print format, payment terms |
| Stock taking | Stock (Stock Reconciliation) | Warehouses, opening count at cutover |
| Inventory management | Stock (Item, Stock Ledger) | Import items with opening quantities |
| Dashboards & historical reports | Accounts + Stock reports, Dashboard Charts | Mostly configuration once data is in |

The one item on the client's original goals that is **not** turnkey: MTD VAT filing.
ERPNext does not file to HMRC out of the box. See [VAT and MTD](#vat-and-mtd) below —
this is the one section with an open decision rather than a checklist.

## Version caveat

Everything below is written against **ERPNext v15**. Sidebar wording, menu paths and
exact field labels drift between versions and even between point releases — the same
discipline `help.html` applies ("steps say what to search for, not which menu to
click") applies here too. Where a step names a doctype or a search term, that's
stable; where it implies a specific click path, treat it as the likely route and
verify against the live instance. **Anything marked ⚠ VERIFY must be checked against
the running instance before it's relied on** — this document has not been run against
a live deployment yet.

---

## 1. Server

**Sizing**, for a business this size (a few users, a few hundred transactions a
month, no payroll): 2 vCPU / 4GB RAM / 40GB SSD is comfortable headroom, not a
minimum — ERPNext runs on less, but backups, indexing and report generation are
smoother with margin. Ubuntu 22.04 LTS is the best-supported base OS.

**Where it runs** — self-hosted was the agreed direction (Bluewater does
hosting/backups/upgrades), so this is a VPS or on-prem box Bluewater controls, not a
managed ERPNext-as-a-service offering. Any mainstream VPS provider works; the
requirements are just a public IP, a domain name pointed at it, and root/sudo access.

**Domain** — a subdomain (e.g. `erp.clientdomain.co.uk`) pointed at the server's IP
via an A record, set up *before* installation so TLS provisioning during setup can
complete in one pass.

## 2. Install

The current officially-supported production path is the Docker Compose deployment
(`frappe_docker`), not the older manual bench install — it bundles the app
containers, MariaDB, Redis and a reverse proxy (Traefik) with automatic TLS via
Let's Encrypt, and it's what upstream documents for production.

```bash
# On the server, as a non-root sudo user
git clone https://github.com/frappe/frappe_docker
cd frappe_docker
```

⚠ VERIFY the exact easy-install command against the current
`frappe_docker/README.md` at install time — this project moves and the flags change
between releases. As of writing, the pattern is:

```bash
python3 install.py \
  --sitename erp.clientdomain.co.uk \
  --app erpnext \
  --email admin@clientdomain.co.uk \
  --production
```

This provisions the containers, requests a Let's Encrypt certificate for the domain,
and creates the first site. Follow the prompts for the initial Administrator
password — store it in whatever the practice's password manager is, not in this
repo, not in chat, not in a file that gets committed.

**After install, confirm:**
- `https://erp.clientdomain.co.uk` loads with a valid certificate (no browser warning)
- Login as Administrator succeeds
- `docker compose ps` shows every container `Up` / healthy

## 3. Backups — set this up before any real data goes in, not after

This is a repeat of a rule already in `migrate.html`'s Phase 1 checklist item
("automated encrypted backups running" / "restore procedure tested from a real
backup") — worth restating here because it's the step most likely to be skipped
under deadline pressure, and it's the one that makes every later step reversible.

- ERPNext ships a scheduled backup job (Setup → Backup, or the `bench backup`
  equivalent inside the container) that produces a database dump plus the files
  folder, on a schedule set in System Settings.
- Point the backup destination at off-instance storage — S3-compatible object
  storage or equivalent — not just local disk on the same server. A server-level
  failure that takes out the disk must not take out the backups too.
- **Test a restore before go-live, not after something breaks.** Spin up a second,
  disposable instance (or a local Docker Compose instance on a laptop) and restore
  the most recent backup into it. If this hasn't been done, "we have backups" is
  unverified.
- Encryption at rest depends on the storage provider — most S3-compatible services
  offer server-side encryption as a bucket setting; enable it.

## 4. Initial site setup

Run through ERPNext's setup wizard (appears on first login):

- **Country**: United Kingdom
- **Currency**: GBP
- **Fiscal year**: match whatever the client's accountant already uses (not
  necessarily UK's default April–March — confirm with the accountant rather than
  assuming)
- **Company name, address, VAT number**: match Sage exactly, since these appear on
  every invoice the client sends from here on
- **Chart of accounts**: choose "create from CSV" rather than a standard template —
  the client's actual chart comes from `migrate.html`'s converter (below), not a
  generic UK template, because the generic templates don't line up with Sage's
  nominal codes or the client's specific accounts

## 5. Data import — in dependency order

This is where `migrate.html`'s Convert tab output goes in. Import in this order;
each stage depends on the one before it existing:

1. **Chart of accounts** (`chart_of_accounts.csv`) — via Setup → Chart of Accounts →
   Import, or the Data Import tool against the Account doctype. ⚠ VERIFY the exact
   import route and column headers against the live instance — this is the one
   assumption CLAUDE.md and the `sage-migration` skill both flag as unverified:
   *"Column labels must be re-verified against the client's live ERPNext instance
   during Phase 0."* Do this import as a dry run first if the tool offers one.
2. **Customers** (`customer_import.csv`) and **Suppliers** (`supplier_import.csv`) —
   via the Data Import tool against the Customer / Supplier doctypes.
3. **Addresses** (`addresses_import.csv`) — same tool, Address doctype, linked to
   the customers/suppliers just created.
4. **Items** (`item_import.csv`) — Data Import tool, Item doctype. Import before
   BOMs, since BOM rows reference item codes that must already exist.
5. **Opening journal** (`opening_journal.csv`) — via the Journal Entry import, or
   Accounting → Opening Invoice Creation Tool depending on what the balances
   represent. `migrate.html`'s converter reports the debit/credit delta and refuses
   silence on an imbalance — if it reported balanced, the journal should post
   balanced; if it reported a delta, resolve that in `migrate.html` before
   importing, not by hand-editing the CSV.
6. **BOMs** (`bom.html`'s `bom_import.csv`, if the client has manufacturing data) —
   after items exist. `bom.html` refuses to costed-export anything with an
   incomplete roll-up (circular reference, missing cost, unusable scrap) — resolve
   those in `bom.html` first.

After each import, spot-check a handful of records against the source CSV rather
than trusting the import summary alone — row counts matching is necessary, not
sufficient (this mirrors the "row counts match exports" gate already in
`migrate.html`'s Phase 1 checklist).

## 6. Module configuration

### Invoicing

- **Tax templates**: create a Sales Taxes and Charges Template for each Sage tax
  code in use (T0/T1/T2/T5/T9 etc — see `sage.html`'s VAT handling for the set this
  client actually posts). Standard rate is 20%, but match whatever the client's
  actual codes map to rather than assuming only the standard rate is in use.
- **Naming series**: set invoice numbering to continue from wherever Sage left off,
  or start a clearly-delineated new series from cutover — either is fine, but pick
  one deliberately rather than letting ERPNext's default series collide with
  historical Sage invoice numbers.
- **Print format**: rebuild the client's current invoice layout as a Print Format.
  `help.html`'s guide assumes the invoice looks recognisably like the one customers
  already get — this is the step that makes that true.
- **Payment terms** and **Payment Entry** reconciliation against bank feed or manual
  entry — confirm which with the client before go-live.

### Stock taking & inventory management

- **Warehouses**: set up to match the client's actual physical locations, not a
  single default warehouse — even a single site usually wants at minimum a
  "Finished Goods" and a "Raw Materials" split if BOM is in use.
- **Opening stock**: enter via Stock Reconciliation at cutover, using a real
  physical count — not the Sage stock figures on their own, since the whole point of
  a stock take at cutover is to catch drift Sage's numbers never saw. `bom.html`
  and `migrate.html`'s item converter carry the last-known quantities as a starting
  point for the count, not a replacement for it.
- **Reorder levels**: set per item once real usage data exists in ERPNext — don't
  try to carry Sage's reorder settings over verbatim if Sage wasn't tracking this
  well (check with the client whether it was).

### BOM (Manufacturing)

- Enable the Manufacturing module (Setup → Module Settings, or it may already be
  enabled by default in v15 — ⚠ VERIFY).
- Set the default valuation method (FIFO or Moving Average) to match what the
  client's costing in Sage implied, or what the accountant prefers going forward —
  this is a real decision, not a default to accept blindly.
- Import BOMs from `bom.html`'s export; the tool's rolled-up cost is what the
  imported BOM should reproduce — check a handful of parent items' costed BOM in
  ERPNext against `bom.html`'s displayed roll-up as a sanity check.

### Dashboards & historical reports

Mostly configuration once the data above is in — this is the module where "already
built" is most literally true:

- **Financial Statements** (Balance Sheet, Profit and Loss, Trial Balance) — built
  in, work immediately once the chart of accounts and journals are imported.
- **Aged Receivable / Aged Payable** — built in, needs the opening journal and
  ongoing invoices to be meaningful.
- **Stock Balance / Stock Ledger** — built in, needs the item import and stock
  reconciliation.
- **Dashboard Charts and Number Cards** — configurable tiles (Setup → Dashboard) for
  whatever KPIs the client actually looks at day to day. Worth asking the client
  directly what they currently check in Sage rather than guessing — a dashboard
  nobody reads is wasted configuration time under a deadline.
- **Historical reporting** depends on how much Sage history gets imported as opening
  balances vs left as an archived export. The opening journal captures a snapshot,
  not a full transaction history — if the client wants prior-year comparisons inside
  ERPNext itself (not just "the archived Sage export exists"), that's a bigger
  import (full transaction history, not just opening balances) and worth scoping
  explicitly rather than assuming it's included.

## 7. VAT and MTD

The one genuinely open decision, not a configuration checklist — `help.html`
deliberately leaves this page blank for exactly this reason.

Two routes, both mentioned in `PROJECT-STATE.md` and the `sage-migration` skill:

1. **ERPNext's community UK VAT / Making Tax Digital app** — connects directly to
   HMRC's MTD API from inside ERPNext. Native, no extra software, but ⚠ VERIFY its
   current maintenance status and feature completeness against the client's actual
   VAT scheme (standard, flat-rate, etc.) before committing to it — community
   add-ons vary in how actively maintained they are, and this needs checking at
   decision time, not assumed from this document.
2. **HMRC-recognised bridging software** — export the VAT figures from ERPNext (a
   report, or a CSV) into a bridging tool that handles the actual HMRC submission.
   More moving parts, but decouples "is our MTD software solid" from "is ERPNext
   solid" — a reasonable hedge if the community app's status is uncertain.

**This needs a decision before cutover, not after.** HMRC MTD registration has its
own lead time (already flagged in `PROJECT-STATE.md`) — whichever route is chosen,
start the registration process as soon as the decision is made, not once the
instance is otherwise ready.

During the parallel run: compute the VAT return in **both** systems each quarter and
have the accountant sign off the first matching quarter before cutover — this is
already the plan in `PROJECT-STATE.md` and doesn't change based on which MTD route
is picked.

## 8. Cutover

This runbook feeds into, and doesn't duplicate, `migrate.html`'s **Checklist** tab —
that's the authoritative phase-gated list with persistent ticks. The mapping:

- Phase 0 (Discovery) → sections 1–2 here (server + install) can start in parallel
  with the export work in `migrate.html`'s "Get the data out" tab; neither blocks
  the other.
- Phase 1 (Build) → sections 3–6 here (backups, setup, import, module config).
- Phase 2 (Parallel run) → weekly reconciliation via `migrate.html`'s Reconcile tab,
  against the now-live ERPNext instance.
- Phase 3 (Cutover) → final reconciliation clean, Sage archived, users trained,
  Sage renewal cancelled in writing.

## What this document is not

It is not a substitute for actually running any of this against a live instance.
Every ⚠ VERIFY marker above is a place where reality may differ from what's written
here, and the first real deployment should correct this document rather than the
other way round — same discipline as `help.html`'s footer about not inventing
precise UI paths. Update this file once a real instance exists and any step here
turns out to be wrong.
