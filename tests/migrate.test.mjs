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
  'parseSide','reconcile','toCSV','ENT','REC_ALIASES','DEMO_FILES','REC_DEMO_A','REC_DEMO_B',
  'parseDate','fmtDateUTC','EXPORT_SPECS','analyseArchiveFile','checkArchive','archiveManifest',
  'DEMO_ARCHIVE_EXTRA'];
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
// Per-account aggregation sums multiple rows for the same code — but in a TRIAL BALANCE
// a repeated code is an export defect, so it is summed AND disclosed. Two rows that
// happen to cancel must not disappear into a clean verdict.
{
  const a = 'N/C,Name,Debit,Credit\n1200,Bank,600.00,\n1200,Bank,400.00,\n';
  const b = 'Account,Debit,Credit\n1200 - Bank,1000.00,\n';
  const r = rec(a, b);
  eq('rows for one account are aggregated before comparison', r.lines[0].a, 1000);
  eq('and the totals agree', r.lines[0].delta, 0);
  ok('a repeated code in a trial balance blocks clean', !r.clean, JSON.stringify(r.warnings));
  ok('and is disclosed', r.warnings.some(w => /repeats account code/i.test(w)),
     JSON.stringify(r.warnings));
}
// In a transaction list a repeated account code is normal, not a defect.
{
  let a = 'Date,Ref,N/C,Debit,Credit\n', b = 'Date,Ref,Account,Debit,Credit\n';
  for (let k = 0; k < 300; k++){
    a += `01/06/2026,TX${k},1200,0.01,\n`;
    b += `01/06/2026,TX${k},1200 - Bank,0.01,\n`;
  }
  const r = rec(a, b);
  ok('a repeated code in a transaction list is not flagged', r.clean,
     JSON.stringify(r.warnings));
  eq('300 penny postings sum to £3.00 without drift', r.lines[0].a, 3);
}

/* ==================================================================
   demo fixtures — the documented behaviour the smoke test relies on
   ================================================================== */

{
  const r = rec(X.REC_DEMO_A, X.REC_DEMO_B);
  ok('the demo pair does not reconcile clean', !r.clean);
  eq('demo yields 2 deltas', r.stats.deltas, 2);
  eq('demo yields 1 Sage-only account', r.stats.onlyA, 1);
  // The demo must exercise a false-clean guard rather than pass it by luck.
  ok('demo demonstrates the unreadable-amount exclusion',
     r.warnings.some(w => /unreadable amount/i.test(w)), JSON.stringify(r.warnings));
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


/* ==================================================================
   Second audit — parseMoney parity with its siblings
   ================================================================== */

// sage.html's parseMoney and bom.html's parseNum both refuse a comma that is not a
// thousands separator. This file used to strip every comma, so "9,50" became 950 —
// and through convertNominal the opening journal balanced perfectly at 100x, which
// means the delta check could never catch it.
eq('"9,50" refused', X.parseMoney('9,50'), null);
eq('"4,25" refused', X.parseMoney('4,25'), null);
eq('"1.250,00" refused', X.parseMoney('1.250,00'), null);
eq('"1,2,3" refused', X.parseMoney('1,2,3'), null);
eq('"1,234.56" still accepted', X.parseMoney('1,234.56'), 1234.56);

// Sage's own ODBC/report notation. Refusing it made convertNominal drop whole accounts
// from the opening journal and then blame the imbalance on a missing control account.
eq('trailing minus', X.parseMoney('1250.00-'), -1250);
eq('CR suffix', X.parseMoney('1250.00 CR'), -1250);
eq('DR suffix', X.parseMoney('450.00 DR'), 450);
{
  const r = conv(NOM_HDR + '\n1200,Bank,,,"9,50"\n3200,Retained,,,"-9,50"\n', 'nominal', X.convertNominal);
  ok('a decimal-comma balance is refused, not posted at 100x',
     /not a readable amount/i.test(issueText(r)), issueText(r));
}

/* ==================================================================
   rootTypeFor — must agree with parseMoney about the same cell
   ================================================================== */

eq('"4,000" gets no root type', X.rootTypeFor('4,000'), null);
eq('"4e3" gets no root type', X.rootTypeFor('4e3'), null);
eq('"0x10" gets no root type', X.rootTypeFor('0x10'), null);
eq('"-1" gets no root type', X.rootTypeFor('-1'), null);
// A 5-digit chart is a different scheme, not a chart where every account is suspense.
eq('a 5-digit code gets no root type', X.rootTypeFor('40000'), null);
eq('9999 is the top of the suspense range', X.rootTypeFor('9999').parent, 'Suspense / Mispostings');
{
  const r = conv(NOM_HDR + '\n40000,Sales - Consultancy,,45200.00,\n12000,Bank,45200.00,,\n',
                 'nominal', X.convertNominal);
  ok('a non-default chart says so rather than filing everything as suspense',
     /may not use the Sage 50 UK default/i.test(issueText(r)) && !/suspense\/mispostings range/i.test(issueText(r)),
     issueText(r));
}

/* ==================================================================
   accountCode — a collision merges two accounts and hides a real delta
   ================================================================== */

eq('a Sage sub-account keeps its suffix', X.accountCode('1200-01'), '1200-01');
eq('and its sibling is distinct', X.accountCode('1200-02'), '1200-02');
eq('an ERPNext spaced-dash name still yields the code', X.accountCode('1200 - Bank Current Account - BW'), '1200');
eq('an Excel float code normalises', X.accountCode('1200.0'), '1200');
eq('an Excel thousands-formatted code normalises', X.accountCode('1,200'), '1200');
{
  const a = 'N/C,Name,Debit,Credit\n1200-01,Bank A,500.00,\n1200-02,Bank B,300.00,\n';
  const b = 'Account,Debit,Credit\n1200-01 - Bank A,800.00,\n1200-02 - Bank B,0.00,\n';
  const r = rec(a, b);
  ok('a misallocation between two sub-accounts does not reconcile clean', !r.clean,
     JSON.stringify(r.lines));
  eq('both sub-accounts are compared separately', r.lines.length, 2);
}

/* ==================================================================
   parseSide — the three new false-clean routes
   ================================================================== */

// The ERPNext v15 Trial Balance shape: period movement of 0.00 alongside a closing
// balance. Reading the explicit zeros as the answer destroyed every figure in the ledger.
{
  const erp = 'Account,Debit,Credit,Closing Balance\n' +
    '1100 - Debtors Control - BW,0.00,0.00,27515.00\n' +
    '1200 - Bank Current Account - BW,0.00,0.00,18930.50\n' +
    '2100 - Creditors Control - BW,0.00,0.00,-38664.50\n';
  const sage = 'N/C,Name,Debit,Credit,Balance\n' +
    '1100,Debtors,0.00,0.00,27515.00\n' +
    '1200,Bank,0.00,0.00,999.99\n' +
    '2100,Creditors,0.00,0.00,-38664.50\n';
  const r = rec(sage, erp);
  ok('explicit zero legs fall through to the balance column', !r.clean, JSON.stringify(r.lines));
  const line = r.lines.find(l => l.code === '1200');
  eq('and the real discrepancy surfaces', Math.round(line.delta * 100) / 100, -17930.51);
  eq('the other accounts match', r.stats.matched, 2);
}
// An amount column that exists but is never populated is not a ledger of nil balances.
{
  const r = rec('N/C,Name,Balance\n1200,Bank,\n4000,Sales,\n',
                'Account,Balance\n1200 - Bank,\n4000 - Sales,\n');
  ok('two files with no figures at all do not reconcile clean', !r.clean, JSON.stringify(r.warnings));
  ok('and the empty rows are disclosed', r.warnings.some(w => /no amount in any/i.test(w)),
     JSON.stringify(r.warnings));
}
// Shape detection failing on BOTH sides used to drop to totals-only in silence.
{
  const a = 'Tran Date,Refn,N/C,Debit,Credit\n01/04/2026,SI-1001,4000,,500.00\n02/04/2026,SI-1002,4000,,300.00\n';
  const b = 'Tran Date,Refn,Account,Debit,Credit\n01/04/2026,SI-9999,4000 - Sales - BW,,800.00\n';
  const r = rec(a, b);
  ok('Sage’s own Tran Date / Refn labels are recognised', r.txDiff !== null,
     JSON.stringify(r.warnings) + ' ' + JSON.stringify(r.notes));
  ok('and different invoices on each side do not reconcile clean', !r.clean,
     JSON.stringify(r.txDiff));
}
{
  // A side with a date but no ref cannot be compared at transaction level. Say so.
  const a = 'Date,N/C,Debit,Credit\n01/04/2026,4000,,500.00\n';
  const b = 'Date,Account,Debit,Credit\n01/04/2026,4000 - Sales,,500.00\n';
  const r = rec(a, b);
  ok('a totals-only comparison is disclosed',
     (r.notes || []).some(n => /account totals only/i.test(n)) ||
     r.warnings.some(w => /transaction-level/i.test(w)),
     JSON.stringify(r.notes) + ' ' + JSON.stringify(r.warnings));
}
// Which columns were read must be visible — an ERPNext TB has several amount columns.
{
  const r = rec('N/C,Name,Debit,Credit\n1200,Bank,100.00,\n', 'Account,Debit,Credit\n1200 - Bank,100.00,\n');
  ok('both sides name the columns actually read',
     (r.notes || []).some(n => /^Sage columns read:/.test(n)) &&
     (r.notes || []).some(n => /^ERPNext columns read:/.test(n)), JSON.stringify(r.notes));
  ok('and they name the real header text', (r.notes || []).join(' ').includes('"Debit"'),
     JSON.stringify(r.notes));
}
// A ragged row's fields are misaligned, so its amounts are not the file's amounts.
{
  // Five cells under a four-cell header: an unquoted comma in the account name.
  const r = rec('N/C,Name,Debit,Credit\n1200,Bank,100.00,\n4000,Sales, Europe,100.00,\n',
                'Account,Debit,Credit\n1200 - Bank,100.00,\n4000 - Sales,100.00,\n');
  ok('a misaligned row blocks clean', !r.clean, JSON.stringify(r.warnings));
  ok('and is disclosed as a column-count problem',
     r.warnings.some(w => /different number of columns/i.test(w)), JSON.stringify(r.warnings));
}
// Transaction references differing only in case are the same document (false DIRTY).
{
  const a = 'Date,Ref,N/C,Debit,Credit\n01/06/2026,si-1001,1200,100.00,\n';
  const b = 'Date,Ref,Account,Debit,Credit\n01/06/2026,SI-1001,1200 - Bank,100.00,\n';
  const r = rec(a, b);
  ok('reference case does not manufacture a difference', r.clean,
     JSON.stringify(r.txDiff) + ' ' + JSON.stringify(r.warnings));
}

/* ==================================================================
   detectEntity — importing creditors as customers is unrecoverable
   ================================================================== */

// Sage supplier records carry a Credit Limit too, so the header bonus used to outvote
// a filename that plainly said SUPPLIERS.CSV.
{
  const H = 'Account Reference,Name,Address Line 1,Town,Postcode,Telephone,Credit Limit,Balance'.split(',');
  for (const f of ['SUPPLIERS.CSV', 'purchase_ledger.csv', 'creditors.csv'])
    eq(`${f} is detected as suppliers despite a Credit Limit column`, X.detectEntity(H, f).key, 'suppliers');
  for (const f of ['customers.csv', 'sales_ledger.csv', 'debtors.csv'])
    eq(`${f} is detected as customers`, X.detectEntity(H, f).key, 'customers');
  const d = X.detectEntity(H, 'export1.csv');
  ok('with no filename hint the party type is declared ambiguous', !!d.ambiguousWith,
     JSON.stringify({key: d.key, ambiguousWith: d.ambiguousWith}));
}
{
  // Headers and filename disagreeing is a conflict to raise, not a vote to win.
  // Generic reference column (both party types match it), but a header wording that
  // votes customers while the filename says purchase ledger.
  const H = 'Account Reference,Name,Address Line 1,Town,Postcode,Customer Credit Limit'.split(',');
  const d = X.detectEntity(H, 'purchase_ledger.csv');
  eq('the filename decides which way it is treated', d.key, 'suppliers');
  ok('but the disagreement is declared ambiguous', !!d.ambiguousWith,
     JSON.stringify({key: d.key, ambiguousWith: d.ambiguousWith}));
}

/* ==================================================================
   convertItems — the checks that only existed in convertNominal
   ================================================================== */

{
  const r = conv(ITEM_HDR + '\nZ-3,Unreadable cost,12,n/a,10.00,Each\n', 'items', X.convertItems);
  ok('an unreadable amount is reported', /not a readable amount/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(ITEM_HDR + '\nZ-2,Blank cost,12,,10.00,Each\n', 'items', X.convertItems);
  ok('stock with no cost price warns just as an explicit zero does',
     /nil valuation|no cost price/i.test(issueText(r)), issueText(r));
}
{
  const r = conv(ITEM_HDR + '\nxr-lic-01,Lower,1,1.00,2.00,Each\nXR-LIC-01,Upper,1,1.00,2.00,Each\n',
                 'items', X.convertItems);
  ok('stock codes differing only in case are flagged as a collision',
     /Duplicate stock code/i.test(issueText(r)), issueText(r));
}

/* ==================================================================
   convertParties — the whole address was discarded when line 1 was blank
   ================================================================== */

{
  const r = conv('Account Reference,Name,Address Line 1,Address Line 2,Town,Postcode\n' +
                 'A1,Alpha Ltd,,Suite 2,Liverpool,L1 1AA\n' +
                 'A2,Beta Ltd,,,Leeds,LS1 1AA\n' +
                 'A3,Gamma Ltd,1 High St,,Hull,HU1 1AA\n',
                 'customers', X.convertParties, 'Customer');
  eq('an address survives a blank Address Line 1', r.addresses.length, 3);
  eq('and keeps its town', r.addresses[0]['City/Town'], 'Liverpool');
}

/* ==================================================================
   Ragged rows and formula injection, across every converter
   ================================================================== */

{
  const hdr = 'Account Reference,Name,Address Line 1,Town,Postcode,VAT Registration Number';
  const rows = rowsOf(hdr + '\nA1,Smith, Jones & Co,1 High St,Liverpool,L1 1AA,GB123456789\n');
  const map = X.mapHeaders(rows[0], X.ENT.customers.aliases);
  const r = X.convertParties(rows.slice(1), map, 'Customer', rows[0].length);
  ok('a misaligned row is reported as blocking',
     r.issues.some(i => i.sev === 'high' && /different number of columns/i.test(i.text)), issueText(r));
}
{
  const hdr = 'Account Reference,Name,Address Line 1,Town,Postcode';
  const rows = rowsOf(hdr + '\nA3,=cmd|\'/c calc\'!A1,1 High St,Liverpool,L1 1AA\n');
  const map = X.mapHeaders(rows[0], X.ENT.customers.aliases);
  const r = X.convertParties(rows.slice(1), map, 'Customer', rows[0].length);
  ok('a formula-shaped value is called out', /treat.*as a formula|starts? with = or @/i.test(issueText(r)),
     issueText(r));
  eq('but the value itself is left intact for the import', r.out[0]['Customer Name'], "=cmd|'/c calc'!A1");
}

/* ==================================================================
   convertNominal — double-counting, signed legs, contradicting balance
   ================================================================== */

{
  const r = conv(NOM_HDR + '\n1200,Bank,18930.50,,\n1200,Bank,18930.50,,\n2100,Creditors,,18930.50,\n',
                 'nominal', X.convertNominal);
  eq('a duplicated account is not opened at twice its balance', r.totals.dr, 18930.50);
  ok('and the duplicate is reported', /Duplicate nominal code/i.test(issueText(r)), issueText(r));
  eq('the journal carries one line for it', r.journal.filter(j => /^1200/.test(j.Account)).length, 1);
}
{
  const r = conv(NOM_HDR + '\n1200,Bank,-500.00,,\n2100,Creditors,,-500.00,\n', 'nominal', X.convertNominal);
  eq('a negative debit becomes a credit', r.journal[0].Credit, '500.00');
  eq('a negative credit becomes a debit', r.journal[1].Debit, '500.00');
  // The pair now balances legitimately — Credit 500 against Debit 500 — rather than by
  // two negative legs cancelling, which ERPNext would reject or sign-invert.
  eq('the totals are positive amounts', [r.totals.dr, r.totals.cr], [500, 500]);
  ok('no emitted leg is negative',
     r.journal.every(j => !/^-/.test(j.Debit) && !/^-/.test(j.Credit)), JSON.stringify(r.journal));
}
{
  const r = conv(NOM_HDR + '\n1200,Bank,5000.00,3000.00,2000.00\n', 'nominal', X.convertNominal);
  eq('a row with both legs is netted into one posting', r.journal[0].Debit, '2000.00');
  eq('and carries no credit', r.journal[0].Credit, '');
  ok('a balance column that disagrees is not needed here', r.totals.dr === 2000, JSON.stringify(r.totals));
}
{
  const r = conv(NOM_HDR + '\n1200,Bank,5000.00,,2000.00\n', 'nominal', X.convertNominal);
  ok('legs disagreeing with the balance column are reported as blocking',
     r.issues.some(i => i.sev === 'high' && /balance column says/i.test(i.text) &&
                        /Account 1200/.test(i.text)), issueText(r));
}
{
  const r = conv(NOM_HDR + '\n,Retained earnings,,5000.00,\n', 'nominal', X.convertNominal);
  ok('an account lost for want of a code is blocking, not advisory',
     r.issues.some(i => i.sev === 'high' && /no account code/i.test(i.text)), issueText(r));
}

/* ---------- Phase 0: the export archive check ----------
   This is the gate in front of the one irreversible step in the whole migration. Every
   assertion below is a route by which an archive could have read as taken when it was not. */

const TODAY = Date.UTC(2026, 7, 10);                       // pinned clock — 10/08/2026
const CUST_OK = `Account Reference,Name,Address Line 1,Town,Postcode,Telephone,VAT Registration Number,Balance
ACME01,Acme Lending Ltd,1 Fenwick Street,Liverpool,L2 7NA,0151 496 0101,GB123456789,5375.00
`;
const SUPP_OK = `Account Reference,Name,Address Line 1,Town,Postcode,Telephone,VAT Registration Number,Balance
SUPP01,Northern Cloud Ltd,Data House,Manchester,M4 6DE,0161 496 0606,GB222333444,2159.00
`;
const ITEM_OK = `Stock Code,Description,Category,Sale Price,Cost Price,Quantity in Stock,Unit of Sale
XR-LIC-01,Licence,Licences,5000.00,1500.00,12,Each
`;
const NOM_OK = `N/C,Name,Debit,Credit
1200,Bank,18930.50,
4000,Sales,,45200.00
`;
const auditCSV = rows => `Type,Account Ref,N/C,Date,Reference,Details,Net,Tax,T/C\n${rows}`;
const AUDIT_LONG = auditCSV(
  `SI,ACME01,4000,01/04/2023,INV-1,Opening trade,1000.00,200.00,T1
SI,ACME01,4000,09/08/2026,INV-2,Recent,2400.00,480.00,T1
`);
const fullSet = extra => [
  {name:'customers.csv', text:CUST_OK}, {name:'suppliers.csv', text:SUPP_OK},
  {name:'products.csv', text:ITEM_OK}, {name:'nominal_tb.csv', text:NOM_OK},
  {name:'audit_trail.csv', text:AUDIT_LONG}
].concat(extra || []);
const arcText = r => JSON.stringify({blocking:r.blocking, warnings:r.warnings});
const itemOf = (r, key) => r.items.find(i => i.key === key);

{
  const r = X.checkArchive(fullSet(), TODAY);
  eq('a full, clean CSV set reads as complete', r.verdict, 'complete');
  eq('and nothing is blocking', r.blocking.length, 0);
  // The verdict covers the five CSVs and nothing else. Reading it as "the archive is done"
  // would skip the backup — the only artefact that is actually the legal record.
  eq('the four unverifiable items are still named', r.manualPending.length, 4);
  ok('and the report says outright what it could not see',
     r.notes.some(n => /cannot confirm the Sage backup/.test(n)), JSON.stringify(r.notes));
}
{
  // The false-clean guard: nothing examined must never be the same answer as nothing wrong.
  const r = X.checkArchive([], TODAY);
  eq('an empty archive is incomplete, not clean', r.verdict, 'incomplete');
  eq('with one blocking line per missing export', r.blocking.length, 5);
  ok('and it says it read nothing', r.notes.some(n => /No files given/.test(n)), JSON.stringify(r.notes));
}
{
  const r = X.checkArchive(fullSet().filter(f => f.name !== 'audit_trail.csv'), TODAY);
  eq('a missing export blocks', r.verdict, 'incomplete');
  eq('and the slot is reported missing', itemOf(r, 'audit').status, 'missing');
  ok('the audit trail is named as the one that cannot be recreated',
     r.blocking.some(b => /cannot be recreated from anything else/.test(b)), arcText(r));
}
{
  const set = fullSet().map(f => f.name === 'customers.csv'
    ? {name:'customers.csv', text:'Account Reference,Name,Town,Postcode\n'} : f);
  const r = X.checkArchive(set, TODAY);
  // Sage will happily export a filtered view. The file parses, matches, and holds nobody.
  ok('an export with a header row and no data blocks',
     r.blocking.some(b => /header row and no data/.test(b)), arcText(r));
}
{
  const set = fullSet().map(f => f.name === 'customers.csv'
    ? {name:'customers.csv', text:'Address Line 1,Town,Postcode\n1 Fenwick Street,Liverpool,L2 7NA\n'} : f);
  const r = X.checkArchive(set, TODAY);
  // Losing the name column stops the file being recognisable as a customer export at all,
  // so the slot stays empty and blocks. It is still an export that has to be re-run, and it
  // cannot be re-run once the licence lapses.
  eq('an export missing a column detection needs does not fill its slot', itemOf(r, 'customers').status, 'missing');
  eq('and the archive is incomplete', r.verdict, 'incomplete');
}
{
  // Reachable where the `must` check was not: this file detects as the nominal export
  // perfectly, and carries none of the figures the opening position is built from. Mutation
  // testing found the original guard here could never fire — this is what replaced it.
  const listOnly = 'N/C,Name\n1200,Bank\n4000,Sales\n';
  const r = X.checkArchive(fullSet().map(f => f.name === 'nominal_tb.csv' ? {name:'nominal_tb.csv', text:listOnly} : f), TODAY);
  eq('the nominal account list is still recognised as the nominal export',
     X.analyseArchiveFile('nominal_tb.csv', listOnly, TODAY).specKey, 'nominal');
  ok('but an export with no balance column at all blocks',
     r.blocking.some(b => /none of the debit \/ credit \/ balance columns are here/.test(b)), arcText(r));
  eq('and the slot does not read as taken', itemOf(r, 'nominal').status, 'issues');
  eq('so the archive is incomplete', r.verdict, 'incomplete');
}
{
  const set = fullSet().map(f => f.name === 'products.csv'
    ? {name:'products.csv', text:'Stock Code,Description\nXR-LIC-01,Licence\n'} : f);
  const r = X.checkArchive(set, TODAY);
  eq('a reduced field list still fills the slot when the key columns survive', itemOf(r, 'items').status, 'ok');
  ok('but the dropped fields are reported while they can still be re-exported',
     r.warnings.some(w => /no sale price, cost price, quantity in stock, unit of sale/.test(w)), arcText(r));
}
{
  const headerless = {name:'nominal_no_headers.csv', text:'1200,Bank,18930.50,\n4000,Sales,,45200.00\n'};
  const a = X.analyseArchiveFile(headerless.name, headerless.text, TODAY);
  eq('a file exported without its header row matches nothing', a.specKey, null);
  ok('and is told why, because it parses perfectly and looks like the wrong file',
     /include header row/.test(a.reason), a.reason);
  const r = X.checkArchive(fullSet([headerless]), TODAY);
  ok('an unrecognised file is reported rather than ignored',
     r.warnings.some(w => /nominal_no_headers\.csv/.test(w) && /has not been checked/.test(w)), arcText(r));
}
{
  // A Sage audit trail carries an Account column, which is a `nominal` alias. Classified as
  // a trial balance it fills the wrong slot, its date coverage is never looked at, and the
  // real trial balance then reads as a duplicate.
  const a = X.analyseArchiveFile('audit_trail.csv', AUDIT_LONG, TODAY);
  eq('an audit trail is recognised as an audit trail, not a trial balance', a.specKey, 'audit');
  const b = X.analyseArchiveFile('nominal_tb.csv', NOM_OK, TODAY);
  eq('and a trial balance is still a trial balance', b.specKey, 'nominal');
}
{
  const short = auditCSV(
    `SI,ACME01,4000,02/06/2026,INV-1,May,2400.00,480.00,T1
SI,BLUE02,4000,09/07/2026,INV-2,June,5000.00,1000.00,T1
`);
  const r = X.checkArchive(fullSet().map(f => f.name === 'audit_trail.csv' ? {name:'audit_trail.csv', text:short} : f), TODAY);
  // The export dialog offers a default date range and it is not "everything". A 37-day
  // audit trail labelled "the history" is the quietest way to lose fifteen years of it.
  ok('an audit trail covering under a year is challenged',
     r.warnings.some(w => /covers 37 days/.test(w) && /slice of the history/.test(w)), arcText(r));
  ok('the challenge is a warning, not a block — some companies really are that young',
     r.verdict === 'complete', arcText(r));
  ok('and a stale end date is measured against the injected clock, not the wall clock',
     r.warnings.some(w => /most recent transaction is 09\/07\/2026, 32 days ago/.test(w)), arcText(r));
}
{
  const nodates = auditCSV(`SI,ACME01,4000,not a date,INV-1,May,2400.00,480.00,T1\n`);
  const r = X.checkArchive(fullSet().map(f => f.name === 'audit_trail.csv' ? {name:'audit_trail.csv', text:nodates} : f), TODAY);
  ok('an audit trail with no readable date at all blocks',
     r.blocking.some(b => /not one date in this file could be read/.test(b)), arcText(r));
}
{
  const mixed = auditCSV(
    `SI,ACME01,4000,01/04/2023,INV-1,Old,1000.00,200.00,T1
SI,ACME01,4000,31/02/2026,INV-2,Impossible,1000.00,200.00,T1
SI,ACME01,4000,09/08/2026,INV-3,New,2400.00,480.00,T1
`);
  const a = X.analyseArchiveFile('audit_trail.csv', mixed, TODAY);
  // Coverage is disclosed wherever a range is printed: a range derived from two rows of
  // three, presented as the range, is the same defect as a total that omits rows.
  eq('the range is taken only from the dates that parsed', a.stats.dated, 2);
  eq('and the unreadable one is counted, not dropped', a.stats.undated, 1);
  ok('31/02 does not roll into March and stretch the range',
     X.fmtDateUTC(a.stats.last) === '09/08/2026', X.fmtDateUTC(a.stats.last));
  ok('the gap between the range and the row count is stated',
     a.issues.some(i => /1 of 3 rows carry a date this tool cannot read/.test(i.text)),
     JSON.stringify(a.issues));
}
{
  // "ledger.csv" holding party records could be either book. detectEntity refuses to guess;
  // the archive has to carry that refusal forward, because after Sage has gone nobody can
  // answer "which of these two is the creditors ledger" from the file itself.
  const r = X.checkArchive(fullSet([{name:'ledger.csv', text:CUST_OK}]), TODAY);
  ok('a party export that could be either book is flagged in the archive',
     r.warnings.some(w => /ledger\.csv/.test(w) && /could equally be the/.test(w) && /Rename the file/.test(w)), arcText(r));
}
{
  const two = X.checkArchive(fullSet([{name:'audit_trail_2.csv', text:AUDIT_LONG}]), TODAY);
  const md = X.archiveManifest(two, {}, 'now', '');
  // One coverage line for two files describes one of them while appearing to describe both.
  eq('coverage is reported once per audit file, not once per slot',
     (md.match(/dates read from 2 of 2 rows/g) || []).length, 2);
}
{
  const r = X.checkArchive(fullSet([{name:'customers_old.csv', text:CUST_OK}]), TODAY);
  ok('two files claiming one slot are both named',
     r.warnings.some(w => /2 files look like this export/.test(w) &&
                          /customers\.csv/.test(w) && /customers_old\.csv/.test(w)), arcText(r));
  eq('and both are carried into the manifest rather than the newest silently winning',
     itemOf(r, 'customers').files.length, 2);
}
{
  const misaligned = `Account Reference,Name,Address Line 1,Town,Postcode,Telephone,VAT Registration Number,Balance
ACME01,Acme Lending, Ltd,1 Fenwick Street,Liverpool,L2 7NA,0151 496 0101,GB123456789,5375.00
`;
  const r = X.checkArchive(fullSet().map(f => f.name === 'customers.csv' ? {name:'customers.csv', text:misaligned} : f), TODAY);
  ok('a row of the wrong width blocks here too, not only in the converters',
     r.blocking.some(b => /different number of columns/.test(b)), arcText(r));
}
{
  const r = X.checkArchive(fullSet(), TODAY);
  const md = X.archiveManifest(r, {'customers.csv':'abc123'}, '2026-08-10 09:00 UTC', '2026-09-21');
  ok('the manifest stamps the licence end date', /Sage licence ends: 2026-09-21/.test(md), md.slice(0,200));
  ok('a file with a checksum carries it', /abc123/.test(md));
  ok('a file without one says so rather than leaving a blank cell', /not computed/.test(md));
  ok('the four hand-ticked items appear as unverified', /Ticked by hand, not verified by this tool/.test(md));
  ok('and the audit trail coverage is recorded for the archive',
     /audit_trail\.csv: 01\/04\/2023 to 09\/08\/2026 \(1226 days\), dates read from 2 of 2 rows/.test(md), md);
  const md2 = X.archiveManifest(X.checkArchive([], TODAY), {}, 'now', '');
  ok('an incomplete archive says so at the top of its own manifest',
     /INCOMPLETE — do not let the licence lapse/.test(md2), md2.slice(0,300));
  ok('and every missing export is a MISSING row', (md2.match(/MISSING/g) || []).length === 5, md2);
}
{
  // The demo has to exercise the guards rather than pass them by luck.
  const files = [];
  for (const n in X.DEMO_FILES) if (n !== 'products.csv') files.push({name:n, text:X.DEMO_FILES[n]});
  for (const n in X.DEMO_ARCHIVE_EXTRA) files.push({name:n, text:X.DEMO_ARCHIVE_EXTRA[n]});
  const r = X.checkArchive(files, TODAY);
  eq('the demo archive is incomplete', r.verdict, 'incomplete');
  eq('with the missing products export blocking', itemOf(r, 'items').status, 'missing');
  ok('and it fires the truncated-audit-trail guard', r.warnings.some(w => /slice of the history/.test(w)), arcText(r));
  ok('the duplicate-slot guard', r.warnings.some(w => /2 files look like this export/.test(w)), arcText(r));
  ok('the missing-header-row guard', r.warnings.some(w => /include header row/.test(w)), arcText(r));
  ok('and the unreadable-date disclosure', r.warnings.some(w => /rows carry a date this tool cannot read/.test(w)), arcText(r));
}

/* ---------- sibling parity ----------
   The rule this project keeps relearning: a fix that lands in one app and not its twin
   produces a confident wrong number. These load the siblings and compare them directly,
   so drift fails the build rather than waiting for an audit to notice. */

function pureOf(file, expose){
  const h = fs.readFileSync(path.join(root, file), 'utf8');
  const s = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];
  const c = {};
  vm.createContext(c);
  vm.runInContext(s.split('/* ================= DOM LAYER ================= */')[0] +
    '\n;globalThis.__X = {' + expose.join(',') + '};\n})();', c);
  return c.__X;
}
const SAGE = pureOf('sage.html', ['parseMoney','parseDate']);
const BOM = pureOf('bom.html', ['parseNum']);

const MONEY_CASES = ['1,250.00','(1,250.00)','1250.00-','1250.00CR','1250.00 DR','(-5.00)','9,50',
  '8odd','12abc','','   ','£1,250.00','-1250','1,2500.00','.5','5.','Infinity','1 250.00','(0.00)'];
for (const c of MONEY_CASES)
  eq('parseMoney agrees with sage.html on ' + JSON.stringify(c), X.parseMoney(c), SAGE.parseMoney(c));
for (const c of MONEY_CASES)
  eq('parseMoney agrees with bom.html parseNum on ' + JSON.stringify(c), X.parseMoney(c), BOM.parseNum(c));

const DATE_CASES = ['31/03/2026','31/02/2026','2026-03-31','2026-02-31','01/06/98','01/06/71','01/06/70',
  '1/6/2026','31.03.2026','2026-03-31T09:00:00','13/13/2026','','not a date','00/01/2026'];
for (const c of DATE_CASES){
  const a = X.parseDate(c), b = SAGE.parseDate(c);
  eq('parseDate agrees with sage.html on ' + JSON.stringify(c),
     a === null ? null : a.toISOString(), b === null ? null : b.toISOString());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
