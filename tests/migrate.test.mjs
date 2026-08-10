// Regression suite for migrate.html's pure layer.
// Run with:  node tests/migrate.test.mjs
//
// Slices the app at the DOM-layer marker and evaluates the pure half in a document-free
// vm context. Every case here is an input that once produced a wrong answer — several of
// them produced a *clean* reconciliation verdict on data that does not reconcile, which
// is the verdict that authorises cutover. Keep this green.
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'migrate.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const src = blocks.sort((a, b) => b.length - a.length)[0];
const pure = src.split('/* ================= DOM LAYER ================= */')[0];

const exposed = ['normKey','parseCSV','parseMoney','mapHeaders','detectEntity','getRow',
  'convertParties','convertItems','convertNominal','rootTypeFor','accountCode',
  'parseSide','reconcile','toCSV','ENT','REC_ALIASES','DEMO_FILES','REC_DEMO_A','REC_DEMO_B'];
const ctx = {};
vm.createContext(ctx);
// The slice ends mid-IIFE; close it after publishing the pure functions outward.
vm.runInContext(pure + '\n;globalThis.__X = {' + exposed.join(',') + '};\n})();', ctx);
const X = ctx.__X;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`FAIL  ${name}\n      got  ${g}\n      want ${w}`); }
};
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n      ' + detail : ''}`); }
};

// Helpers for the converters, which take (rows, map) rather than raw text.
const rowsOf = csv => X.parseCSV(csv.trim());
const conv = (csv, entKey, fn, ...rest) => {
  const rows = rowsOf(csv);
  const map = X.mapHeaders(rows[0], X.ENT[entKey].aliases);
  return fn(rows.slice(1), map, ...rest);
};
const issueText = r => r.issues.map(i => i.sev + ': ' + i.text).join(' | ');

/* ==================================================================
   parseCSV — structural integrity
   ================================================================== */

// A quote appearing mid-cell is literal text. Treating it as the start of a quoted cell
// swallowed the rest of the file into one cell and every following row was lost.
{
  const rows = X.parseCSV('a,b,c\n1,5" reel,3\n4,5,6\n');
  eq('mid-cell quote does not swallow the file', rows.length, 3);
  eq('the quote survives as literal text', rows[1][1], '5" reel');
  eq('the following row is intact', rows[2], ['4','5','6']);
}
// Genuine quoting still works.
eq('quoted comma stays in one cell', X.parseCSV('a,b\n"x,y",2\n')[1][0], 'x,y');
eq('escaped quote round-trips', X.parseCSV('a,b\n"x""y",2\n')[1][0], 'x"y');
eq('quoted newline stays in one cell', X.parseCSV('a,b\n"x\ny",2\n')[1][0], 'x\ny');

// Padding rows are spreadsheet artefacts, not data.
{
  const rows = X.parseCSV('a,b,c\n1,2,3\n,,\n   \n');
  eq('comma-only and whitespace-only rows are dropped', rows.length, 2);
}
// All three line-ending conventions.
for (const [name, nl] of [['LF','\n'], ['CRLF','\r\n'], ['CR','\r']])
  eq(`${name} line endings`, X.parseCSV('a,b' + nl + '1,2' + nl).length, 2);

// A UTF-8 BOM on the first header must not break column mapping.
eq('BOM is stripped by normKey', X.normKey('﻿Name'), 'name');

/* ==================================================================
   parseMoney — strict, because a fabricated figure looks authoritative
   ================================================================== */

eq('plain amount', X.parseMoney('1250.00'), 1250);
eq('thousands separator', X.parseMoney('1,250.00'), 1250);
eq('currency symbol', X.parseMoney('£1,250.00'), 1250);
eq('explicit negative', X.parseMoney('-1250.00'), -1250);
eq('blank is null, not zero', X.parseMoney('   '), null);
eq('bracket negative', X.parseMoney('(1,250.00)'), -1250);

// "(-5.00)" states the sign twice and contradicts itself; it once returned +5.
eq('contradictory sign notation refused', X.parseMoney('(-5.00)'), null);
// parseFloat prefix-parses; "8odd" must not become 8.
eq('trailing junk refused', X.parseMoney('8odd'), null);
eq('"12abc" refused', X.parseMoney('12abc'), null);
eq('"5.5.5" refused', X.parseMoney('5.5.5'), null);

/* ==================================================================
   Entity detection — importing creditors as customers is unrecoverable
   ================================================================== */

const PARTY_HDR = 'Account Reference,Name,Address Line 1,Town,Postcode,VAT Registration Number';
{
  const d = X.detectEntity(PARTY_HDR.split(','), 'suppliers-export.csv');
  eq('the filename resolves customers vs suppliers', d.key, 'suppliers');
}
{
  const d = X.detectEntity(PARTY_HDR.split(','), 'customers-export.csv');
  eq('and the other way round', d.key, 'customers');
}
{
  // No hint in headers or filename: the guess must be declared ambiguous, not made silently.
  const d = X.detectEntity(PARTY_HDR.split(','), 'export1.csv');
  ok('an unhinted party file is flagged as ambiguous', !!d && !!d.ambiguousWith,
     JSON.stringify(d && {key: d.key, ambiguousWith: d.ambiguousWith}));
}
{
  const d = X.detectEntity('Stock Code,Description,Quantity In Stock,Cost Price,Sales Price'.split(','), 'products.csv');
  eq('an item export is detected', d.key, 'items');
}
{
  const d = X.detectEntity('N/C,Name,Debit,Credit'.split(','), 'trial-balance.csv');
  eq('a nominal export is detected', d.key, 'nominal');
}

/* ==================================================================
   convertParties — ERPNext keys parties by NAME and will merge them
   ================================================================== */

{
  const r = conv(PARTY_HDR + '\nA01,Acme Ltd,1 High St,Liverpool,L2 7NA,GB123456789\n' +
                              'A02,Acme Ltd,2 Low St,Liverpool,L3 1AA,GB987654321\n',
                 'customers', X.convertParties, 'Customer');
  ok('two Sage accounts sharing a name are flagged as a merge risk',
     /Duplicate customer name/i.test(issueText(r)) && r.issues.some(i => i.sev === 'high'),
     issueText(r));
  eq('both rows are still emitted for the user to fix', r.out.length, 2);
}
{
  const r = conv(PARTY_HDR + '\nA01,Acme Ltd,1 High St,Liverpool,L2 7NA,GB123456789\n' +
                              'A01,Other Ltd,2 Low St,Liverpool,L3 1AA,GB987654321\n',
                 'customers', X.convertParties, 'Customer');
  ok('a duplicate account reference is flagged', /Duplicate account reference/i.test(issueText(r)),
     issueText(r));
}
{
  // A skipped row must be reported. A row dropped without a count is data loss the user
  // never finds out about.
  const r = conv(PARTY_HDR + '\nA01,,1 High St,Liverpool,L2 7NA,GB123456789\n',
                 'customers', X.convertParties, 'Customer');
  eq('a nameless row is not emitted', r.out.length, 0);
  ok('and it is reported as skipped', /missing name.*skipped/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(PARTY_HDR + '\nA01,Acme Ltd,1 High St,Liverpool,,GB123456789\n',
                 'customers', X.convertParties, 'Customer');
  ok('an address with no postcode is flagged', /no postcode/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(PARTY_HDR + '\nA01,Acme Ltd,1 High St,Liverpool,L2 7NA,NOTAVATNO\n',
                 'customers', X.convertParties, 'Customer');
  ok('a malformed UK VAT number is flagged', /VAT number/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(PARTY_HDR + '\nA01,Acme Ltd,1 High St,Liverpool,L2 7NA,GB 123 4567 89\n',
                 'customers', X.convertParties, 'Customer');
  ok('a correctly spaced UK VAT number is accepted', !/VAT number/i.test(issueText(r)), issueText(r));
}

/* ==================================================================
   convertItems
   ================================================================== */

const ITEM_HDR = 'Stock Code,Description,Quantity In Stock,Cost Price,Sales Price,Unit of Sale';
{
  const r = conv(ITEM_HDR + '\nW-01,Widget,10,5.00,9.00,Each\nW-01,Widget again,5,5.00,9.00,Each\n',
                 'items', X.convertItems);
  ok('a duplicate stock code is flagged', /Duplicate stock code/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(ITEM_HDR + '\nW-02,Widget,-4,5.00,9.00,Each\n', 'items', X.convertItems);
  ok('negative stock is flagged as blocking',
     r.issues.some(i => i.sev === 'high' && /negative stock/i.test(i.text)), issueText(r));
}
{
  const r = conv(ITEM_HDR + '\nW-03,Widget,10,12.00,9.00,Each\n', 'items', X.convertItems);
  ok('cost exceeding sale price is flagged', /exceeds sale price/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(ITEM_HDR + '\nW-04,Widget,10,0.00,9.00,Each\n', 'items', X.convertItems);
  ok('stock on hand at zero cost is flagged', /zero cost/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(ITEM_HDR + '\nW-05,Widget,10,5.00,9.00,\n', 'items', X.convertItems);
  ok('a missing unit of sale is defaulted AND disclosed', /no unit of sale/i.test(issueText(r)),
     issueText(r));
  eq('the default is applied', r.out[0]['Default Unit of Measure'], 'Nos');
}
{
  const r = conv(ITEM_HDR + '\n,Widget,10,5.00,9.00,Each\n', 'items', X.convertItems);
  eq('a codeless row is not emitted', r.out.length, 0);
  ok('and it is reported as skipped', /missing stock code.*skipped/i.test(issueText(r)), issueText(r));
}

/* ==================================================================
   rootTypeFor — Sage UK nominal ranges → ERPNext root types
   ================================================================== */

const bands = [
  ['0031','Asset'], ['999','Asset'], ['1000','Asset'], ['1999','Asset'],
  ['2000','Liability'], ['2299','Liability'], ['2300','Liability'], ['2999','Liability'],
  ['3000','Equity'], ['3999','Equity'],
  ['4000','Income'], ['4999','Income'],
  ['5000','Expense'], ['5999','Expense'],
  ['6000','Expense'], ['6999','Expense'],
  ['7000','Expense'], ['8999','Expense'],
  ['9000','Expense']
];
for (const [code, want] of bands) eq(`nominal ${code} → ${want}`, X.rootTypeFor(code).root, want);
eq('a non-numeric code has no root type', X.rootTypeFor('MISC'), null);
eq('an empty code has no root type', X.rootTypeFor(''), null);

/* ==================================================================
   convertNominal — the opening journal must balance, and say so if it doesn't
   ================================================================== */

const NOM_HDR = 'N/C,Name,Debit,Credit,Balance';
{
  const r = conv(NOM_HDR + '\n1200,Bank,1000.00,,\n4000,Sales,,1000.00,\n', 'nominal', X.convertNominal);
  eq('a balanced opening journal has zero delta', r.totals.delta, 0);
  ok('and raises no imbalance issue', !/do not balance/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(NOM_HDR + '\n1200,Bank,1000.00,,\n4000,Sales,,900.00,\n', 'nominal', X.convertNominal);
  eq('an unbalanced journal reports its delta', r.totals.delta, 100);
  ok('and raises a blocking issue',
     r.issues.some(i => i.sev === 'high' && /do not balance/i.test(i.text)), issueText(r));
}
{
  // The balance check must see the same rounded figures the journal emits, or a journal
  // can be certified balanced while its own printed lines are out by a penny.
  let csv = NOM_HDR + '\n';
  for (let k = 0; k < 300; k++) csv += `${1000+k},Acc ${k},0.005,,\n`;
  csv += '4000,Sales,,1.50,\n';
  const r = conv(csv, 'nominal', X.convertNominal);
  const dr = r.journal.reduce((s, j) => s + (parseFloat(j.Debit) || 0), 0);
  const cr = r.journal.reduce((s, j) => s + (parseFloat(j.Credit) || 0), 0);
  eq('the reported delta matches the emitted lines',
     r.totals.delta, Math.round((dr - cr) * 100) / 100);
}
{
  // An unreadable value excludes the WHOLE line, not just that leg — otherwise the
  // journal silently carries half a posting while claiming the line was excluded.
  const r = conv(NOM_HDR + '\n1200,Bank,1000.00,notanumber,\n4000,Sales,,1000.00,\n',
                 'nominal', X.convertNominal);
  ok('an unreadable leg is reported', /not a readable amount/i.test(issueText(r)), issueText(r));
  ok('and the whole line is excluded from the journal',
     !r.journal.some(j => /^1200/.test(j.Account)), JSON.stringify(r.journal));
}
{
  // An explicit 0.00 in both legs must not mask a real balance column.
  const r = conv(NOM_HDR + '\n1200,Bank,0.00,0.00,2500.00\n4000,Sales,0.00,0.00,-2500.00\n',
                 'nominal', X.convertNominal);
  eq('the balance column is consulted when both legs are zero', r.journal.length, 2);
  eq('a positive balance becomes a debit', r.journal[0].Debit, '2500.00');
  eq('a negative balance becomes a credit', r.journal[1].Credit, '2500.00');
  eq('and it still balances', r.totals.delta, 0);
}
{
  const r = conv(NOM_HDR + '\n9010,Suspense,500.00,,\n1200,Bank,,500.00,\n', 'nominal', X.convertNominal);
  ok('a suspense-range nominal is flagged before cutover', /suspense/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(NOM_HDR + '\n1200,Bank,100.00,,\n1200,Bank again,200.00,,\n', 'nominal', X.convertNominal);
  ok('a duplicate nominal code is flagged as blocking',
     r.issues.some(i => i.sev === 'high' && /Duplicate nominal/i.test(i.text)), issueText(r));
}
{
  const r = conv(NOM_HDR + '\n,Orphan,100.00,,\n', 'nominal', X.convertNominal);
  ok('a row with no account code is reported, not silently dropped',
     /no account code/i.test(issueText(r)), issueText(r));
}

/* ==================================================================
   toCSV round-trip — an export that cannot be re-read is not an export
   ================================================================== */

{
  const objs = [
    {'Item Code':'W-01', 'Item Name':'Widget, large', 'Notes':'5" reel'},
    {'Item Code':'W-02', 'Item Name':'Say "hello"',   'Notes':'line1\nline2'}
  ];
  const back = X.parseCSV(X.toCSV(objs));
  eq('round-trip preserves row count', back.length, 3);
  eq('an embedded comma survives', back[1][1], 'Widget, large');
  eq('an embedded quote survives', back[2][1], 'Say "hello"');
  eq('an embedded newline survives', back[2][2], 'line1\nline2');
  eq('a bare quote in a value survives', back[1][2], '5" reel');
}

/* ==================================================================
   accountCode — a collision merges two accounts and hides a real delta
   ================================================================== */

eq('a leading code is extracted from an ERPNext account name', X.accountCode('4000 - Sales - CO'), '4000');
eq('a bare code passes through', X.accountCode('4000'), '4000');
eq('surrounding whitespace is trimmed', X.accountCode('  4000  '), '4000');
ok('a non-numeric account name is not silently emptied', X.accountCode('Sales') !== '', X.accountCode('Sales'));

/* ==================================================================
   reconcile — the clean verdict gates cutover
   ================================================================== */

const TB_A = 'N/C,Name,Debit,Credit\n1200,Bank,1000.00,\n4000,Sales,,1000.00\n';
const rec = (a, b) => X.reconcile(a, b);

{
  const r = rec(TB_A, 'Account,Debit,Credit\n1200 - Bank,1000.00,\n4000 - Sales,,1000.00\n');
  ok('identical sides reconcile clean', r.clean, JSON.stringify(r.warnings) + ' ' + JSON.stringify(r.stats));
  eq('and both accounts match', r.stats.matched, 2);
}
{
  const r = rec(TB_A, 'Account,Debit,Credit\n1200 - Bank,900.00,\n4000 - Sales,,1000.00\n');
  ok('a delta blocks clean', !r.clean);
  eq('and is counted', r.stats.deltas, 1);
}
{
  const r = rec(TB_A, 'Account,Debit,Credit\n1200 - Bank,1000.00,\n');
  ok('an account missing from one side blocks clean', !r.clean);
  eq('and is counted as Sage-only', r.stats.onlyA, 1);
}

// An unreadable amount is not "no difference" — it is unexamined, and must block clean.
{
  const r = rec('N/C,Name,Debit,Credit\n1200,Bank,notanumber,\n4000,Sales,,1000.00\n',
                'Account,Debit,Credit\n4000 - Sales,,1000.00\n');
  ok('an unreadable amount blocks a clean verdict', !r.clean, JSON.stringify(r.warnings));
  ok('and is disclosed in the warnings', r.warnings.some(w => /unreadable amount/i.test(w)),
     JSON.stringify(r.warnings));
}
// A blank account code drops a balance out of the comparison entirely.
{
  const r = rec('N/C,Name,Debit,Credit\n,Orphan,5000.00,\n4000,Sales,,1000.00\n',
                'Account,Debit,Credit\n4000 - Sales,,1000.00\n');
  ok('a blank account code blocks a clean verdict', !r.clean, JSON.stringify(r.warnings));
  ok('and is disclosed', r.warnings.some(w => /no account code/i.test(w)), JSON.stringify(r.warnings));
}
// A side with no amount column once compared every account as zero and reported clean.
{
  const r = rec('N/C,Name\n1200,Bank\n', 'Account,Debit,Credit\n1200 - Bank,1000.00,\n');
  ok('a side with no amount column is rejected outright', !!r.error, JSON.stringify(r));
}
{
  const r = rec('Name,Debit,Credit\nBank,1000.00,\n', 'Account,Debit,Credit\n1200 - Bank,1000.00,\n');
  ok('a side with no code column is rejected outright', !!r.error, JSON.stringify(r));
}
// Comparing a transaction list against a trial balance must be declared, not glossed over.
{
  const tx = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,100.00,\n';
  const r = rec(tx, 'Account,Debit,Credit\n1200 - Bank,100.00,\n');
  ok('mismatched shapes block clean', !r.clean, JSON.stringify(r.warnings));
  ok('and are disclosed', r.warnings.some(w => /transaction list/i.test(w)), JSON.stringify(r.warnings));
}
// The transaction key is signed. On absolute amounts, a fully sign-reversed batch
// reconciled clean — every debit posted as a credit and nobody told.
{
  const a = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,100.00,\n02/06/2026,INV2,1200,200.00,\n';
  const b = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,,100.00\n02/06/2026,INV2,1200,,200.00\n';
  const r = rec(a, b);
  ok('a sign-reversed batch does not reconcile clean', !r.clean,
     JSON.stringify(r.stats) + ' ' + JSON.stringify(r.txDiff));
  ok('and the transaction diff sees it',
     r.txDiff && (r.txDiff.missingInA.length > 0 || r.txDiff.missingInB.length > 0),
     JSON.stringify(r.txDiff));
}
// A transaction present on one side only must surface.
{
  const a = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,100.00,\n02/06/2026,INV2,1200,200.00,\n';
  const b = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,100.00,\n';
  const r = rec(a, b);
  ok('a missing transaction blocks clean', !r.clean);
  ok('and is named', r.txDiff.missingInB.length === 1, JSON.stringify(r.txDiff));
}
// Duplicate postings are a multiset, not a set: two identical rows on one side and one
// on the other is a real difference.
{
  const a = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,100.00,\n01/06/2026,INV1,1200,100.00,\n';
  const b = 'Date,Ref,Account,Debit,Credit\n01/06/2026,INV1,1200,100.00,\n';
  const r = rec(a, b);
  ok('a duplicated posting on one side is caught', !r.clean, JSON.stringify(r.txDiff));
}
// Per-account aggregation sums multiple rows for the same code.
{
  const a = 'N/C,Name,Debit,Credit\n1200,Bank,600.00,\n1200,Bank,400.00,\n';
  const b = 'Account,Debit,Credit\n1200 - Bank,1000.00,\n';
  const r = rec(a, b);
  ok('rows for one account are aggregated before comparison', r.clean,
     JSON.stringify(r.stats) + ' ' + JSON.stringify(r.warnings));
}
// Penny-level float accumulation must not manufacture a spurious delta.
{
  let a = 'N/C,Name,Debit,Credit\n', b = 'Account,Debit,Credit\n';
  for (let k = 0; k < 300; k++) a += '1200,Bank,0.01,\n';
  b += '1200 - Bank,3.00,\n';
  const r = rec(a, b);
  ok('300 penny postings sum to £3.00 without drift', r.clean,
     JSON.stringify(r.lines) + ' ' + JSON.stringify(r.warnings));
}

/* ==================================================================
   demo fixtures — the documented behaviour the smoke test relies on
   ================================================================== */

{
  const r = rec(X.REC_DEMO_A, X.REC_DEMO_B);
  ok('the demo pair does not reconcile clean', !r.clean);
  eq('demo yields 2 deltas', r.stats.deltas, 2);
  eq('demo yields 1 Sage-only account', r.stats.onlyA, 1);
}
{
  // Every demo export must still detect, convert and re-parse.
  for (const [fname, text] of Object.entries(X.DEMO_FILES)) {
    const rows = rowsOf(text);
    const d = X.detectEntity(rows[0], fname);
    ok(`demo ${fname} is detected`, !!d, 'no entity matched');
    if (!d) continue;
    let out;
    if (d.key === 'customers') out = X.convertParties(rows.slice(1), d.map, 'Customer');
    else if (d.key === 'suppliers') out = X.convertParties(rows.slice(1), d.map, 'Supplier');
    else if (d.key === 'items') out = X.convertItems(rows.slice(1), d.map);
    else out = X.convertNominal(rows.slice(1), d.map);
    const emitted = out.out || out.coa;
    ok(`demo ${fname} converts to at least one row`, emitted.length > 0);
    ok(`demo ${fname} output re-parses`, X.parseCSV(X.toCSV(emitted)).length === emitted.length + 1);
    ok(`demo ${fname} raises at least one issue (it is deliberately dirty)`, out.issues.length > 0);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
