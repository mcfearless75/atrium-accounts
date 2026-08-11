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
instance existing. This document is that prerequisite — check `PROJECT-STATE.md`
for where that stands right now rather than treating this file as the record of
current progress; it's the runbook, not the log.

| Client wish-list item | ERPNext module | Work once the instance exists |
|---|---|---|
| BOM | Manufacturing (BOM doctype) | Import BOMs (`bom.html` → `bom_import.csv` + `bom_items_import.csv`), set costing method |
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
the running instance before it's relied on.**

**⚠ Live decision, not a default to accept: v15 or v16.** This document, `migrate.html`
and `help.html` are all written against v15, but the current install tooling defaults
to the *latest stable* release, which as of writing is v16 — installing without
pinning a version gets you v16, not v15. v15 is still actively released and supported
to end-2027; v16 is supported to end-2029 and is the newer line. **Settle this before
anyone runs the install command in section 2** — every ⚠ VERIFY in this document, and
every doctype name and menu-path assumption in `migrate.html`'s and `help.html`'s
copy, is downstream of that answer.

---

## 1. Server

**Sizing.** Frappe publishes no current hardware guidance — the only official table
is a [2020 bench wiki page](https://github.com/frappe/bench/wiki/OS-and-Hardware-Specifications)
whose OS list predates the Docker install path entirely, so treat its numbers as a
floor of unknown vintage rather than a recommendation. That table's entry for 1 site
/ 5–30 users is **4GB RAM / 2 processors / 40GB disk**.

For this client (a few users, a few hundred transactions a month, no payroll),
**4GB / 2 vCPU / 40GB SSD is the documented starting point, not headroom** — the
Docker deployment runs MariaDB, two Redis instances, Traefik, the backend, nginx, a
websocket server, two queue workers and a scheduler on one host. **Start at 8GB /
2 vCPU / 60GB SSD** if the provider allows resizing later; memory is what runs out
first, and MariaDB plus report generation on imported historical data is the usual
cause. Confirm before go-live that the VPS can be resized without a rebuild — that
is the assumption this sizing rests on. Budget disk separately for the fact that
scheduled backups land on local disk by default (see [Backups](#3-backups--set-this-up-before-any-real-data-goes-in-not-after))
and will grow until redirected off-instance.

**Base OS.** The Docker install path has no OS requirement beyond a 64-bit Linux
that can run Docker Engine and Compose v2 — the install script installs Docker
itself. Use **Ubuntu 24.04 LTS** (supported to May 2029, and by far the most
community install coverage for ERPNext on Docker). **Do not deploy onto 22.04
LTS**: standard support ends May 2027, which is inside this instance's expected
life and lands an OS upgrade on the client shortly after cutover.

**Where it runs** — self-hosted was the agreed direction (Bluewater does
hosting/backups/upgrades), so this is a VPS or on-prem box Bluewater controls, not a
managed ERPNext-as-a-service offering. Any mainstream VPS provider works; the
requirements are a public IP, a domain name pointed at it, root/sudo access, and
**ports 80 and 443 both reachable from the internet** — Let's Encrypt issues the
certificate via an HTTP-01 challenge on port 80, so a firewall that only opens 443
fails certificate issuance silently-ish.

**Domain** — a subdomain (e.g. `erp.clientdomain.co.uk`) pointed at the server's IP
via an A record, set up *before* installation so TLS provisioning during setup can
complete in one pass.

## 2. Install

The officially recommended production path is still Docker, via
[`frappe/frappe_docker`](https://github.com/frappe/frappe_docker). Upstream
currently documents two production-ready routes: an **Easy Install script**
(automated, lives in the [`frappe/bench`](https://github.com/frappe/bench) repo and
drives `frappe_docker` internally) and **`compose.yaml` + overrides** (manual,
described upstream as "the canonical production deployment method" for teams
managing their own infrastructure). `pwd.yml` and the devcontainer setup that
`frappe_docker` also ships are explicitly **not** production paths — don't evolve
either of those into one.

Use the Easy Install script. Do **not** clone `frappe_docker` first — the script
does that for you.

```bash
# On the server, as a non-root sudo user
wget https://raw.githubusercontent.com/frappe/bench/develop/easy-install.py

python3 easy-install.py deploy \
  --project=erp \
  --sitename=erp.clientdomain.co.uk \
  --app=erpnext \
  --email=admin@clientdomain.co.uk \
  --version=v15.119.0
```

**`--version` is not optional in practice — pin it.** Left unset it defaults to
*latest stable*, which today means v16, not v15 (see the version caveat above).
Check the current v15 tag at `hub.docker.com/r/frappe/erpnext/tags` on the day of
install rather than trusting the exact patch version above, which will be stale by
the time this runs.

⚠ VERIFY the flags against `frappe/bench`'s README at install time — the script is
subcommand-based (`build` / `deploy` / `upgrade` / `develop` / `exec`) and the flag
set has changed before.

This installs Docker if it's not already present, fetches `frappe_docker`,
generates `.env`, brings up MariaDB + Redis + Traefik (HTTPS by default, via
Let's Encrypt) + a backup cron, and creates the site. **It generates the MariaDB
root password and the Administrator password itself — you are not prompted for
them.** They're written to:

- `~/erp-passwords.txt` — `ADMINISTRATOR_PASSWORD` and `MARIADB_ROOT_PASSWORD`
- `~/erp-compose.yml` — the generated compose file

Move both passwords into the practice's password manager immediately, then delete
the file from the server. Not in this repo, not in chat, not in a file that gets
committed.

**After install, confirm:**
- `https://erp.clientdomain.co.uk` loads with a valid certificate (no browser warning)
- Login as Administrator succeeds with the password from `~/erp-passwords.txt`
- `docker compose -p erp -f ~/erp-compose.yml ps` shows every container `Up` /
  healthy — note the compose file lives in `$HOME`, not in a `frappe_docker`
  working directory the way a manual clone-and-compose flow would produce

## 3. Backups — set this up before any real data goes in, not after

This is a repeat of a rule already in `migrate.html`'s Phase 1 checklist item
("automated encrypted backups running" / "restore procedure tested from a real
backup") — worth restating here because it's the step most likely to be skipped
under deadline pressure, and it's the one that makes every later step reversible.

- The install script in section 2 already composes a backup cron (default every 6
  hours, `-g/--backup-schedule` to change it) — a schedule exists from minute one.
  It backs up to a container volume **on the same box**, which is the part that
  still needs doing: redirect the destination to off-instance storage —
  S3-compatible object storage or equivalent. A server-level failure that takes out
  the disk must not take out the backups too.
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
- **Chart of accounts**: the wizard only offers a standard template or copying an
  existing company — there's no "import from CSV" option at this step. Accept a
  standard template here (any one; it gets overwritten next) and import the real
  chart via the **Chart of Accounts Importer** immediately after, per §5 step 1 —
  **before posting anything**, because that importer deletes and replaces whatever
  chart is already there.

## 5. Data import — in dependency order

This is where `migrate.html`'s Convert tab output goes in. Import in this order;
each stage depends on the one before it existing:

**⚠ Column labels on every CSV in this section are best-effort scaffolding, not
confirmed against a live instance.** The `sage-migration` skill states this
directly: *"Column labels must be re-verified against the client's live ERPNext
instance during Phase 0."* It covers every file `migrate.html` and `bom.html`
generate, not just the chart of accounts — do a dry-run import (or a small test
batch) on each file type before trusting a full import.

1. **Chart of accounts** (`chart_of_accounts.csv`) — via the **Chart of Accounts
   Importer** (search "Chart of Accounts Importer"), not the generic Data Import
   tool. This is a dedicated tool with its own template: use its Download Template
   button and make `migrate.html`'s output match that shape, because it rejects a
   mismatched file outright rather than importing it wrong.

   **This tool overwrites.** It deletes the company's existing chart before
   importing the new one, and refuses to run once the company has any transactions
   posted — so this has to happen before anything else touches the books, and
   there's no recovering from running it a second time by mistake short of a fresh
   site. Root Type (Asset/Liability/Income/Expense/Equity) is mandatory on every
   row, and every parent account referenced must exist in the same file. There's no
   dry run as such, but it renders a **Chart Preview** tree before committing —
   check that against `migrate.html`'s output rather than importing and inspecting
   afterwards.

   `convertNominal` flags anything landing in Sage's 9000+ suspense/mispostings
   range rather than migrating it silently — **resolve those balances before this
   import**, the same as the checklist item this mirrors. It also can't classify
   every chart: a code outside the standard Sage 50 UK ranges comes through with no
   root type assigned and a note to set it by hand, so check `migrate.html`'s own
   flagged issues before assuming the generated file is complete.
2. **Customers** (`customer_import.csv`) and **Suppliers** (`supplier_import.csv`) —
   via the Data Import tool against the Customer / Supplier doctypes.
3. **Addresses** (`addresses_import.csv`) — Data Import, Address doctype.
   **Address has no direct customer/supplier column** — the link is a child table
   (`Link Document Type` / `Link Name`, one row per party it belongs to), and
   `Address Type` is mandatory. Spot-check that an imported address actually shows
   up on the customer record afterwards; one that imports "successfully" but isn't
   linked is invisible exactly where it's needed.
4. **Items** (`item_import.csv`) — Data Import tool, Item doctype. Import before
   BOMs, since BOM rows reference item codes that must already exist.
5. **Opening balances** — two separate tools, both needed; this is not a single
   import:
   - **Outstanding customer/supplier invoices** → **Opening Invoice Creation Tool**
     (search that name). It creates opening Sales/Purchase Invoices per party from
     the outstanding amount, posted against a Temporary Opening account — this is
     what makes Accounts Receivable/Payable and payment matching work at all. A
     lump journal entry against a debtors control account doesn't give you this; it
     kills the aged reporting that's on the client's own wish-list.
   - **Every other balance-sheet figure** (`opening_journal.csv`) → a **Journal
     Entry** with **Entry Type = "Opening Entry"** and **Is Opening = Yes**, offset
     to the same **Temporary Opening** account.

   Both post to Temporary Opening, so **once both are in, that account should net
   to zero** — a free reconciliation check; if it doesn't, something was
   double-counted or missed between the two. `migrate.html`'s converter reports the
   debit/credit delta on the journal and refuses silence on an imbalance — resolve
   any delta there, not by hand-editing the CSV. ⚠ Check whether `migrate.html`'s
   single `opening_journal.csv` already separates party balances from the rest, or
   whether that split needs doing by hand at import time — a `migrate.html`
   question this runbook surfaces but doesn't answer.
6. **BOMs** — `bom.html` emits **two** files and both are required:
   `bom_import.csv` (one row per assembly) and `bom_items_import.csv` (the
   component lines, carrying rate/scrap/qty-consumed). Importing only the first
   creates BOMs with no components. Import after items exist.

   **`bom.html` does not refuse to export an incomplete BOM — it exports it with
   the cost column blank.** An assembly with a circular reference, a missing
   component cost or an unusable scrap percentage never gets a fabricated number,
   but nothing stops the row reaching this CSV uncosted. Check `bom.html`'s own
   findings for incomplete roll-ups and resolve them there **before** this import,
   rather than relying on the import to catch it — it won't.

After each import, spot-check a handful of records against the source CSV rather
than trusting the import summary alone — row counts matching is necessary, not
sufficient (this mirrors the "row counts match exports" gate already in
`migrate.html`'s Phase 1 checklist).

## 6. Module configuration

### Invoicing

- **Tax templates**: create a Sales Taxes and Charges Template for each Sage tax
  code the client actually posts. `sage.html` can verify the arithmetic for the
  common Sage 50 default set (T0/T1/T2/T4/T5/T9) and reports any code outside it as
  going out unverified — but that's the set the *checker* knows, not a record of
  this client's real usage. **Run a real Sage audit trail through `sage.html` first
  to establish which codes are genuinely in use**; no client export has been
  through it yet. Standard rate is 20%, but don't assume only the standard rate
  applies. A flat T-code → template mapping can't express item-level zero-rating on
  its own — pair it with **Item Tax Template** (per-item rate overrides, the
  T0/T2-vs-T1 distinction) and **Tax Category** (party-level defaults, e.g.
  EU/export customers) rather than relying on the template alone.
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
  point for the count, not a replacement for it. Set **Purpose = "Opening Stock"**
  (not the default "Stock Reconciliation") and set the **Difference Account**
  deliberately — it defaults to a P&L account, and an opening count posted through
  the wrong difference account misstates the first period's profit.
- **Reorder levels**: set per item once real usage data exists in ERPNext — don't
  try to carry Sage's reorder settings over verbatim if Sage wasn't tracking this
  well (check with the client whether it was).

### BOM (Manufacturing)

- **No enabling step is needed** — Manufacturing ships with ERPNext and its
  workspace is visible by default. (Modules can be *hidden* per user via User →
  Block Modules / Module Profile, which is the opposite problem — worth checking
  nobody's hidden it from the person who needs it.)
- **Default valuation method lives in Stock Settings, not a Manufacturing
  setting** — search "Stock Settings", field "Default Valuation Method"
  (FIFO / Moving Average / LIFO, overridable per item on the Item record). Match
  what the client's Sage costing implied, or what the accountant prefers going
  forward — a real decision, not a default to accept blindly. **Do not pick LIFO:
  ERPNext offers it in the dropdown, but it isn't permitted under UK GAAP or
  IFRS.**
- Separately, **Manufacturing Settings** has an "Update BOM Cost Automatically"
  option — relevant to whether ERPNext's costed BOM keeps matching `bom.html`'s
  roll-up as component costs move over time.
- Import BOMs from `bom.html`'s export; the tool's rolled-up cost is what the
  imported BOM should reproduce — check a handful of parent items' costed BOM in
  ERPNext against `bom.html`'s displayed roll-up as a sanity check.

### Dashboards & historical reports

Mostly configuration once the data above is in — this is the module where "already
built" is most literally true:

- **Financial Statements** (Balance Sheet, Profit and Loss, Trial Balance) — built
  in, work immediately once the chart of accounts and journals are imported.
- **Accounts Receivable / Accounts Payable** (Sage's Aged Debtors / Aged Creditors —
  same term `help.html` uses, deliberately, so the client searches the word they'll
  actually be told to use) — built in, needs the opening journal and ongoing
  invoices to be meaningful.
- **Stock Balance / Stock Ledger** — built in, needs the item import and stock
  reconciliation.
- **Dashboard Charts and Number Cards** — configurable tiles for whatever KPIs the
  client actually looks at day to day. There's no single "Setup → Dashboard" page;
  either create them directly (search "Dashboard Chart" / "Number Card") or, more
  usually, add them to a Workspace via **Edit** mode on the workspace page itself —
  ⚠ the desk UI has been reworked between recent versions, so treat any click path
  here as version-specific and work from the search terms. Worth asking the client
  directly what they currently check in Sage rather than guessing — a dashboard
  nobody reads is wasted configuration time under a deadline.
- **Historical reporting** depends on how much Sage history gets imported as opening
  balances vs left as an archived export. The opening journal captures a snapshot,
  not a full transaction history — if the client wants prior-year comparisons inside
  ERPNext itself (not just "the archived Sage export exists"), that's a bigger
  import (full transaction history, not just opening balances) and worth scoping
  explicitly rather than assuming it's included.

## 7. VAT and MTD

The one genuinely open decision, not a configuration checklist. `help.html`'s VAT
entry deliberately stops short of naming the filing route for exactly this reason.

**Three real options exist, not two — and the one the `sage-migration` skill
currently names as primary turned out, on checking, to be a dead end.** The skill
needs updating to match this section, not the other way round.

1. ~~"ERPNext's community UK VAT / MTD app"~~ — **do not use this.** The specific
   package (`uk_vat`, `software-to-hardware/erpnext-vat-mtd`) has had no commits
   since July 2021, and an open, unanswered issue reports it does not install on
   ERPNext v15 at all — the version this whole project targets. No flat-rate VAT
   scheme support is documented. And "native, no extra software" understated what
   it actually asks for: the client holds their own HMRC production API
   credentials and carries HMRC's fraud-prevention-header compliance obligation
   directly, which is a real ongoing responsibility, not a one-off setup step.
2. **Case Solved's "United Kingdom" app** (`CaseSolvedUK/uk-support`, listed on the
   Frappe Cloud marketplace) — proprietary, pay-per-submission, claims HMRC
   recognition and support for any VAT accounting method. The strongest in-ERPNext
   candidate found, but ⚠ VERIFY three things directly with Case Solved before
   committing, none of which could be confirmed from here: whether it currently
   supports **v15** (public listings describe it as v14), whether it runs on
   **self-hosted** ERPNext or only their own hosting, and current pricing. Its
   support repository has had no activity — no issues, no discussions — since June
   2023, which could mean stable or could mean dormant; not knowable from outside.
3. **HMRC-recognised bridging software** — export VAT figures from ERPNext into a
   dedicated bridging tool that files to HMRC. Real examples reported on HMRC's own
   compatible-software list: 123 Sheets, VitalTax, Absolute Excel VAT Filer, Easy
   MTD VAT, My Tax Digital (⚠ VERIFY current listing status directly at
   `tax.service.gov.uk/making-tax-digital-software` — that page couldn't be reached
   from this environment to confirm first-hand, so treat the names as leads, not a
   confirmed shortlist). **Decouples the filing decision entirely from any ERPNext
   app's maintenance status**, and the export it needs is a file this project
   already knows how to produce. With option 1 ruled out and option 2 carrying real
   open questions, this is the lower-risk default right now, not merely a hedge.

**If bridging is used, the handoff has to be a file** — a CSV export from ERPNext
into the bridging tool, never figures retyped by hand. HMRC's "soft landing" on
digital links ended April 2021; copy-and-paste or re-keyed figures do not satisfy
MTD — this is a real compliance requirement, not a formality.

**Correction to the registration-lead-time assumption.** For a business already
VAT-registered — which this client is, filing from Sage today — there is **no
separate MTD sign-up step any more**; HMRC auto-enrolled all remaining
VAT-registered businesses after August 2022. The lead time actually sitting in this
decision is commercial onboarding time with whichever vendor is chosen for options
2 or 3 (or HMRC's production-credentials approval process, if option 1 were ever
revisited, which it shouldn't be). `PROJECT-STATE.md` currently states "MTD
registration... takes lead time" — worth the accountant confirming that's genuinely
resolved rather than carried forward from an earlier, less-checked assumption.

**One operational detail worth planning around regardless of route**: HMRC's
authorisation for a piece of filing software expires after **18 months** and must
be re-granted, or the next filing fails with `invalid_grant`. Put a reminder
somewhere that survives staff turnover, not just institutional memory.

**This still needs a decision before cutover, not after** — and with option 1 ruled
out, the practical choice is between verifying option 2 and defaulting to option 3.

During the parallel run: compute the VAT return in **both** systems each quarter and
have the accountant sign off the first matching quarter before cutover — consistent
with `PROJECT-STATE.md`, though its deadline section separately notes a full
VAT-quarter parallel run may not fit the six-week window at all. That's a live
tension between this plan and the actual timeline, not something resolved by this
document — see §8.

## 8. Cutover

This runbook feeds into, and doesn't duplicate, `migrate.html`'s **Checklist** tab —
that's the authoritative phase-gated list with persistent ticks. Read the actual
item text there rather than this summary; the mapping below is a pointer to which
phase each section belongs under, and has already drifted from the checklist's real
wording once.

- **Phase 0 (Discovery)** → §1 (server + domain) and the export work in
  `migrate.html`'s "Get the data out" tab can run in parallel; neither blocks the
  other. The MTD route decision (§7) belongs here too — the checklist's own Phase 0
  names it directly, not a later phase, because of the lead-time risk even after
  the correction above.
- **Phase 1 (Build)** → §2's *production* install (real domain, live TLS — distinct
  from the checklist's separate, earlier "evaluation instance" item, which this
  document doesn't cover), §3 (backups), §4–6 (setup, import, module config).
- **Phase 2 (Parallel run)** → weekly reconciliation via `migrate.html`'s Reconcile
  tab, **and** the checklist's own "one full VAT quarter computed in both systems"
  and accountant sign-off items — both load-bearing gates in their own right, not
  implied by "weekly reconciliation" alone. If `PROJECT-STATE.md`'s six-week window
  genuinely can't fit a full VAT quarter, this phase as written and the real
  timeline are in tension — a client-conversation decision, not one this document
  makes for you.
- **Phase 3 (Cutover)** → opening balances locked, final reconciliation clean, full
  Sage archive kept for 6-year retention, users trained, day-one support agreed,
  **and the Sage renewal cancelled in writing before the notice deadline** — that
  last clause is easy to skim past and is one of the two genuinely irreversible
  items in the whole project, alongside the export itself.

## What this document is not

It is not a substitute for actually running any of this against a live instance.
Every ⚠ VERIFY marker above is a place where reality may differ from what's written
here, and the first real deployment should correct this document rather than the
other way round — same discipline as `help.html`'s footer about not inventing
precise UI paths. Update this file once a real instance exists and any step here
turns out to be wrong.
