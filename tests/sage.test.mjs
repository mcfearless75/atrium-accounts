// Regression suite for sage.html's pure layer.
// Run with:  node tests/sage.test.mjs
// Slices the script at the DOM-layer marker and evaluates the pure half in a
// document-free vm context. Every case here is an input that once produced a
// wrong number on screen — keep them green.
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'sage.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const src = blocks.sort((a, b) => b.length - a.length)[0];
const pure = src.split('/* ================= DOM LAYER ================= */')[0];

const exposed = ['parseCSV','parseMoney','parseDate','normaliseTaxCode','mapColumns','toTx',
  'parseInput','analyse','benfordCalc','chiSqP8','computeStats','routeModel','MODELS',
  'classifyNominal','classifyTx','buildDashboard','fmtGBP','fmtSigned','fmtMag','monthKey',
  'BENFORD_MIN_N','DEMO_CSV','DEMO_LEDGER'];
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

const HDR = 'Type,Account,Nominal,Date,Ref,Details,Net,Tax,T/C\n';
const load = csv => X.parseInput(csv);
const run = (csv, today) => {
  const r = X.parseInput(csv);
  if (r.error) return { error: r.error, has: () => false, titles: [], findings: [] };
  r.txs._today = today || new Date(Date.UTC(2026, 6, 15));
  r.txs._ragged = r.ragged || []; r.txs._footers = r.footers || []; r.txs._width = r.width;
  const a = X.analyse(r.txs);
  const findings = a.findings;
  return { txs: r.txs, findings, benford: a.benford,
           stats: X.computeStats(r.txs), dash: X.buildDashboard(r.txs),
           has: t => findings.some(f => new RegExp(t, 'i').test(f.title)),
           titles: findings.map(f => f.sev + ': ' + f.title) };
};

/* ================= parseMoney ================= */

eq('parseMoney plain', X.parseMoney('1250.00'), 1250);
eq('parseMoney thousands separator', X.parseMoney('1,250.00'), 1250);
eq('parseMoney currency symbol', X.parseMoney('£1,250.00'), 1250);
eq('parseMoney explicit negative', X.parseMoney('-1250.00'), -1250);
eq('parseMoney blank -> null', X.parseMoney('   '), null);

// C4 — a decimal comma is not a thousands separator. "9,50" is 9.50 or a typo;
// stripping it turns it into 950 and inflates the ledger a hundredfold.
eq('parseMoney "9,50" refused', X.parseMoney('9,50'), null);
eq('parseMoney "1,25" refused', X.parseMoney('1,25'), null);
eq('parseMoney "1.234,56" refused', X.parseMoney('1.234,56'), null);
eq('parseMoney "12,34,567" refused (bad grouping)', X.parseMoney('12,34,567'), null);

// C1 — bracket negatives are standard accounting notation and must be read, not dropped.
eq('parseMoney bracket negative', X.parseMoney('(1,250.00)'), -1250);
eq('parseMoney bracket negative no commas', X.parseMoney('(400.00)'), -400);
eq('parseMoney contradictory sign refused', X.parseMoney('(-5.00)'), null);

// C5 — trailing minus and CR/DR are Sage's own report/ODBC export notation.
eq('parseMoney trailing minus', X.parseMoney('1,250.00-'), -1250);
eq('parseMoney CR suffix', X.parseMoney('1250.00 CR'), -1250);
eq('parseMoney DR suffix', X.parseMoney('1,250.00 DR'), 1250);

// parseFloat prefix-parsing must not turn garbage into a number.
eq('parseMoney "12abc" refused', X.parseMoney('12abc'), null);
eq('parseMoney "5.5.5" refused', X.parseMoney('5.5.5'), null);
eq('parseMoney array refused', X.parseMoney([100, 200]), null);

/* ================= unreadable amounts are disclosed ================= */

// C1 — the headline failure: a null net was omitted from every total with no finding.
{
  const r = run(HDR +
    'SI,ACME01,4000,01/06/2026,INV1001,Consultancy,1000.00,200.00,T1\n' +
    'SC,ACME01,4000,05/06/2026,CRN-01,Credit note,"(1,250.00)","(250.00)",T1\n' +
    'PI,SUPP01,5000,06/06/2026,PB-1,Hosting,"(400.00)","(80.00)",T1\n' +
    'SI,BLUE02,4000,07/06/2026,INV1002,Support,2000.00,400.00,T1\n');
  eq('bracket negatives parse rather than vanish',
     r.txs.map(t => t.net), [1000, -1250, -400, 2000]);
  // The SC row states its direction twice (credit type AND negative amount). That is a
  // mixed export convention, not a number to guess at — it is excluded and reported.
  ok('a negatively-signed credit note is reported', r.has('Credit notes carrying a negative'),
     r.titles.join(' | '));
  eq('the ambiguous credit is excluded from income', Math.round(r.dash.income * 100) / 100, 3000);
  eq('it is counted so the exclusion is visible', r.dash.signConflict, 1);
  // A negative PI is unambiguous — type and sign agree that it reduces expenditure.
  eq('expenditure sees the negative purchase', Math.round(r.dash.expense * 100) / 100, -400);
}
{
  // An amount that genuinely cannot be read must be reported, not silently skipped.
  const r = run(HDR + 'SI,ACME01,4000,01/06/2026,INV1,Consultancy,not-a-number,200.00,T1\n');
  ok('unreadable amount fires a finding', r.has('amount'), r.titles.join(' | '));
  ok('unreadable amount is counted on the dashboard',
     (r.dash.unreadable || r.dash.unamounted || 0) > 0, JSON.stringify(Object.keys(r.dash)));
}

/* ================= parseCSV ================= */

// C2 — a quote mid-cell must not open quoted mode and swallow the file.
{
  const r = load(HDR +
    'SI,ACME01,4000,01/06/2026,INV1001,Supply of 5" reel cable,1000.00,200.00,T1\n' +
    'SI,BLUE02,4000,02/06/2026,INV1002,Consultancy,2000.00,400.00,T1\n' +
    'SI,CRED03,4000,03/06/2026,INV1003,Support,3000.00,600.00,T1\n');
  eq('mid-cell quote does not swallow the file', r.txs.length, 3);
  eq('all three amounts survive', r.txs.map(t => t.net), [1000, 2000, 3000]);
  eq('the quote is kept as literal text', r.txs[0].details, 'Supply of 5" reel cable');
}

// Quoted cells still work properly.
{
  const r = load(HDR + 'SI,ACME01,4000,01/06/2026,INV1,"Consultancy, phase 2",1000.00,200.00,T1\n');
  eq('quoted comma stays in one cell', r.txs[0].details, 'Consultancy, phase 2');
}
{
  const rows = X.parseCSV('a,b\n"x""y",2\n');
  eq('escaped quote round-trips', rows[1][0], 'x"y');
}

// C6 — padding lines and totals footers must not become transactions.
{
  const r = run(HDR +
    'SI,A,4000,01/06/2026,I1,x,100.00,20.00,T1\r\n' +
    ',,,,,,,,\r\n' +
    '   \r\n' +
    'Total,,,,,,100.00,20.00,\r\n');
  eq('padding and totals rows are dropped', r.txs.length, 1);
  eq('headline net is not double-counted', r.stats.net, 100);
}

// Line endings, all three conventions.
for (const [name, nl] of [['LF','\n'], ['CRLF','\r\n'], ['CR','\r']]) {
  const r = load(HDR.trim() + nl + 'SI,A,4000,01/06/2026,I1,x,100.00,20.00,T1' + nl);
  eq(`${name} line endings parse`, r.txs.length, 1);
}

// C9 (major) — a ragged row must not shift fields silently.
{
  const r = run(HDR + 'SI,ACME01,4000,04/06/2026,INV4,Consultancy, phase 3,3000.00,600.00,T1\n');
  ok('a row wider than the header is reported', r.error || r.has('column|field|width|row'),
     r.error || r.titles.join(' | '));
}

/* ================= parseDate ================= */

eq('UK dd/mm/yyyy', X.parseDate('01/06/2026') && X.parseDate('01/06/2026').toISOString().slice(0,10), '2026-06-01');
eq('ISO yyyy-mm-dd', X.parseDate('2026-06-01') && X.parseDate('2026-06-01').toISOString().slice(0,10), '2026-06-01');

// M7 — an impossible calendar date must be rejected, not rolled into the next month.
// A 31/03 style error otherwise relocates a posting into a different VAT quarter.
eq('31/02/2026 rejected', X.parseDate('31/02/2026'), null);
eq('30/02/2026 rejected', X.parseDate('30/02/2026'), null);
eq('31/04/2026 rejected', X.parseDate('31/04/2026'), null);
eq('29/02/2026 rejected (2026 is not a leap year)', X.parseDate('29/02/2026'), null);
eq('2026-06-31 rejected', X.parseDate('2026-06-31'), null);
ok('29/02/2024 accepted (2024 is a leap year)',
   X.parseDate('29/02/2024') && X.parseDate('29/02/2024').toISOString().slice(0,10) === '2024-02-29');

// M13 — a date carrying a time is still a date.
ok('date with a time component parses',
   X.parseDate('01/06/2026 00:00:00') &&
   X.parseDate('01/06/2026 00:00:00').toISOString().slice(0,10) === '2026-06-01');

// M10 — a two-digit year must not become a future date.
{
  const d = X.parseDate('01/06/98');
  ok('two-digit year 98 resolves to the past, not 2098',
     d === null || d.getUTCFullYear() === 1998, d && d.toISOString());
}

// Timezone: no date may drift across a day boundary.
eq('monthKey of the 1st stays in its own month', X.monthKey(X.parseDate('01/06/2026')), '2026-06');
eq('monthKey across the year boundary', X.monthKey(X.parseDate('01/01/2026')), '2026-01');
eq('monthKey of 31 December', X.monthKey(X.parseDate('31/12/2025')), '2025-12');

/* ================= normaliseTaxCode ================= */

eq('T-code passes through', X.normaliseTaxCode('T1'), 'T1');
eq('rate name maps to a T-code', X.normaliseTaxCode('Standard 20%'), 'T1');

// M8 — an unrecognised code must not silently switch off three detectors at once.
{
  const r = run(HDR + 'SI,A,4000,01/06/2026,I1,x,1000.00,20.00,GB_STANDARD\n');
  ok('an unrecognised tax code is reported',
     r.has('tax code'), r.titles.join(' | '));
}
// A numeric tax-code column must be handled consistently across all its values.
{
  const got = ['0','1','2','5','9','20'].map(v => X.normaliseTaxCode(v));
  ok('numeric tax codes normalise consistently',
     got.every(v => /^T\d+$/.test(v)), JSON.stringify(got));
}

/* ================= parseInput: JSON ================= */

// C3 — Business Cloud nested objects must resolve, or the load must fail loudly.
{
  const json = JSON.stringify({ $items: [
    { date:'2026-06-01', transaction_type:{id:'SI'}, reference:'INV1001',
      net_amount:1000.00, tax_amount:200.00, contact:{name:'ACME01'},
      ledger_account:{nominal_code:'4000'}, tax_rate:{id:'GB_STANDARD'} },
    { date:'2026-06-02', transaction_type:{id:'PI'}, reference:'PB-1',
      net_amount:500.00, tax_amount:100.00, contact:{name:'SUPP01'},
      ledger_account:{nominal_code:'5000'}, tax_rate:{id:'GB_STANDARD'} }
  ]});
  const r = X.parseInput(json);
  if (r.error) {
    ok('nested Business Cloud JSON fails loudly rather than reporting zeros', true);
  } else {
    eq('nested transaction_type resolves', r.txs.map(t => t.type), ['SI','PI']);
    eq('nested nominal_code resolves', r.txs.map(t => t.nominal), ['4000','5000']);
    const d = X.buildDashboard(r.txs);
    eq('nested JSON produces real income', d.income, 1000);
    eq('nested JSON produces real expenditure', d.expense, 500);
  }
}

// An input carrying no usable rows must error, not report a clean empty ledger.
for (const [name, blob] of [
  ['empty array', '[]'],
  ['empty items wrapper', '{"transactions":[]}'],
  ['array of scalars', '[1,2,3]'],
  ['array of strings', '["INV1","INV2"]'],
  ['array of nulls', '[null,null]']
]) {
  const r = X.parseInput(blob);
  ok(`${name} is rejected rather than silently accepted`,
     !!r.error || (r.txs && r.txs.length === 0 && r.error !== undefined) || !!r.error,
     JSON.stringify(r).slice(0, 160));
}

// A wrapper the parser does not know must produce a visible error.
ok('unknown JSON wrapper errors', !!X.parseInput('{"data":[{"a":1}]}').error);

/* ================= BOM and encoding ================= */

eq('BOM on the first header cell still maps', X.mapColumns(['﻿Type','Account']).type, 0);
{
  const r = load('﻿' + HDR + 'SI,A,4000,01/06/2026,I1,x,100.00,20.00,T1\n');
  eq('BOM-prefixed CSV parses', r.txs.length, 1);
}

/* ================= demo ledger still behaves ================= */
{
  const r = run(X.DEMO_LEDGER);
  ok('demo still parses', r.txs.length > 30, 'rows=' + (r.txs && r.txs.length));
  ok('demo still fires its detector families', r.findings.length >= 15,
     'findings=' + r.findings.length);
  const highs = r.findings.filter(f => f.sev === 'high').length;
  ok('demo still fires high-severity findings', highs >= 4, 'high=' + highs);
  // The governing rule: a reported total must reconcile with what was examined.
  const monthlyIncome = r.dash.monthly.reduce((s, m) => s + m.income, 0) + (r.dash.undatedIncome || 0);
  const monthlyExpense = r.dash.monthly.reduce((s, m) => s + m.expense, 0) + (r.dash.undatedExpense || 0);
  eq('monthly income + undated reconciles to total income',
     Math.round(monthlyIncome * 100) / 100, Math.round(r.dash.income * 100) / 100);
  eq('monthly expense + undated reconciles to total expenditure',
     Math.round(monthlyExpense * 100) / 100, Math.round(r.dash.expense * 100) / 100);
}


/* ================= detectors ================= */

// Journals are grouped by reference AND date. A recurring monthly journal reusing one
// reference otherwise merges every month into one bucket, where two broken journals
// cancel and neither is reported — the worst available failure for the finding that
// blocks a migration.
{
  const r = run(HDR +
    'JD,JRNL,7000,31/01/2026,JNL-01,Payroll Jan,5500.00,0.00,T9\n' +
    'JC,JRNL,2220,31/01/2026,JNL-01,Payroll Jan,5000.00,0.00,T9\n' +
    'JD,JRNL,7000,28/02/2026,JNL-01,Payroll Feb,3000.00,0.00,T9\n' +
    'JC,JRNL,2220,28/02/2026,JNL-01,Payroll Feb,3500.00,0.00,T9\n');
  const j = r.findings.filter(f => /Unbalanced journal/.test(f.title));
  eq('two months out by £500 each are both reported', j.length, 2);
}
{
  const r = run(HDR +
    'JD,JRNL,7000,10/01/2026,,Accrual,2500.00,0.00,T9\n' +
    'JC,JRNL,2109,10/01/2026,,Accrual,2000.00,0.00,T9\n' +
    'JD,JRNL,8200,10/02/2026,,Depreciation,1000.00,0.00,T9\n' +
    'JC,JRNL,0051,10/02/2026,,Depreciation,1500.00,0.00,T9\n');
  eq('reference-less journals do not share one bucket',
     r.findings.filter(f => /Unbalanced journal/.test(f.title)).length, 2);
}
{
  const r = run(HDR +
    'JD,JRNL,7000,31/01/2026,JNL-02,Balanced,1000.00,0.00,T9\n' +
    'JC,JRNL,2220,31/01/2026,JNL-02,Balanced,1000.00,0.00,T9\n');
  ok('a balanced journal is silent', !r.has('Unbalanced journal'), r.titles.join(' | '));
}

// A single invoice split across two nominals shares type, account, date, ref and amount.
// It is one document, not a duplicate.
{
  const r = run(HDR +
    'PI,SUPP01,5000,02/06/2026,PB-4471,Hosting - compute,500.00,100.00,T1\n' +
    'PI,SUPP01,7502,02/06/2026,PB-4471,Hosting - storage,500.00,100.00,T1\n');
  ok('a split-nominal invoice is not called a duplicate', !r.has('duplicate'), r.titles.join(' | '));
}
{
  const r = run(HDR +
    'PI,SUPP01,5000,02/06/2026,PB-4471,Hosting,500.00,100.00,T1\n' +
    'PI,supp01,5000,2026-06-02,pb-4471,Hosting,500.00,100.00,T1\n');
  ok('the same posting in two date formats and cases is caught', r.has('duplicate'),
     r.titles.join(' | '));
}

// VAT: the magnitude can be right while the sign is wrong, and bank lines carry VAT.
{
  const r = run(HDR + 'SI,A,4000,01/06/2026,I1,x,1000.00,-200.00,T1\n');
  ok('a sign-inverted VAT amount is caught', r.has('VAT sign'), r.titles.join(' | '));
}
{
  const r = run(HDR + 'BP,BANK01,7502,01/06/2026,DD-01,Card purchase,1000.00,999.00,T1\n');
  ok('VAT on a bank payment is checked', r.has('VAT does not match'), r.titles.join(' | '));
}
{
  const r = run(HDR + 'SI,A,4000,01/06/2026,I1,x,9.99,2.00,T1\n');
  ok('per-line rounding is not called a defect', !r.has('VAT does not match'), r.titles.join(' | '));
}

// A tax code the VAT check has no rate for must not fall through all three detectors.
for (const code of ['RC', 'Reverse charge', 'EC Goods', 'T1A']) {
  const r = run(HDR + 'SI,A,4000,01/06/2026,I1,x,1000.00,999.00,T1\n'.replace('T1', code));
  ok(`unverifiable tax code "${code}" is reported`, r.has('Tax codes the VAT check cannot verify'),
     r.titles.join(' | '));
}

// Threshold skimming is a fraud indicator. One invoice landing in a band is arithmetic,
// not evidence — roughly 3.6% of any ledger falls there.
{
  const r = run(HDR + 'SI,A,4000,01/06/2026,I1,Annual support renewal,24000.00,4800.00,T1\n');
  ok('a single just-under invoice is not called skimming', !r.has('cluster just under'),
     r.titles.join(' | '));
}
{
  let csv = HDR;
  for (let k = 0; k < 6; k++) csv += `SI,A,4000,0${k+1}/06/2026,I${k},Split ${k},9${60+k}.00,${(960+k)*0.2}0,T1\n`;
  const r = run(csv);
  ok('six invoices under one threshold with none above does fire', r.has('cluster just under'),
     r.titles.join(' | '));
}

// Benford: the MAD cutoffs are large-sample constants. Below BENFORD_MIN_N the test is
// not weak, it is invalid — and a wrong fraud indicator is worse than none.
{
  let csv = HDR;
  // 40 amounts drawn to sit close to the Benford distribution.
  const digits = [1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,3,3,3,3,3,4,4,4,4,5,5,5,6,6,7,7,8,8,9,9,1];
  digits.forEach((d, k) => { csv += `SI,A,4000,0${(k%9)+1}/06/2026,I${1000+k},x,${d}${(k*7)%10}0.00,0.00,T0\n`; });
  const r = run(csv);
  eq('Benford is not run below the minimum sample size', r.benford.valid, false);
  ok('no Benford finding on a 40-row ledger', !r.has('Benford') && !r.has('First-digit'),
     r.titles.join(' | '));
}
{
  // A large ledger whose digits follow Benford must come back clean.
  let csv = HDR;
  const counts = [301,176,125,97,79,67,58,51,46];   // exactly the expected proportions at n=1000
  let k = 0;
  counts.forEach((c, di) => {
    for (let j = 0; j < c; j++, k++)
      csv += `SI,A,4000,${String((k%28)+1).padStart(2,'0')}/06/2026,I${10000+k},x,${di+1}${String((k*3)%100).padStart(2,'0')}.00,0.00,T0\n`;
  });
  const r = run(csv);
  eq('Benford runs on a large ledger', r.benford.valid, true);
  ok('Benford-distributed data is not accused', !r.has('Benford') && !r.has('First-digit'),
     'chi2=' + r.benford.chi2.toFixed(1) + ' p=' + r.benford.p.toExponential(2));
}
eq('chi-squared survival function, df=8, at 0', X.chiSqP8(0), 1);
ok('chi-squared p at the 5% critical value', Math.abs(X.chiSqP8(15.507) - 0.05) < 0.002, String(X.chiSqP8(15.507)));
ok('chi-squared p at the 1% critical value', Math.abs(X.chiSqP8(20.090) - 0.01) < 0.001, String(X.chiSqP8(20.090)));

// Sequence gaps: a year-segmented reference is an ordinary UK invoice number.
{
  const r = run(HDR +
    'SI,A,4000,01/06/2026,INV-2026-0001,x,100.00,20.00,T1\n' +
    'SI,A,4000,02/06/2026,INV-2026-0002,x,100.00,20.00,T1\n' +
    'SI,A,4000,03/06/2026,INV-2026-0004,x,100.00,20.00,T1\n');
  ok('a gap in a year-segmented sequence is found', r.has('invoice sequence'), r.titles.join(' | '));
}
{
  const r = run(HDR +
    'PI,S,5000,01/06/2026,PB-1001,x,100.00,20.00,T1\n' +
    'PI,S,5000,02/06/2026,PB-1002,x,100.00,20.00,T1\n' +
    'PI,S,5000,03/06/2026,PB-1004,x,100.00,20.00,T1\n');
  ok('purchase invoice sequences are scanned too', r.has('purchase invoice sequence'),
     r.titles.join(' | '));
}

/* ================= dashboard arithmetic ================= */

// fmtGBP is signed. Rendering -£2,000 of supplier credit as "£2,000" turns money
// coming back into money going out.
eq('fmtGBP keeps the minus sign', X.fmtGBP(-480), '-£480.00');
eq('fmtGBP positive unchanged', X.fmtGBP(480), '£480.00');
eq('fmtMag is the explicit magnitude', X.fmtMag(-480), '£480.00');

// Double-entry direction, all four combinations.
{
  const cases = [
    ['JD,JRNL,4000', 'income',  -1000],
    ['JC,JRNL,4000', 'income',   1000],
    ['JD,JRNL,7000', 'expense',  1000],
    ['JC,JRNL,7000', 'expense', -1000]
  ];
  for (const [head, kind, want] of cases) {
    const r = run(HDR + head + ',01/06/2026,J1,x,1000.00,0.00,T9\n');
    eq(`${head} moves ${kind} by ${want}`, Math.round(r.dash[kind] * 100) / 100, want);
  }
}
// Bank payments and receipts are opposite movements.
{
  const r = run(HDR +
    'PI,SUPP04,7100,02/06/2026,R1,Serviced office rent,12000.00,2400.00,T1\n' +
    'BR,BANK01,7100,25/06/2026,RFND,Rent overpayment refunded,4000.00,800.00,T1\n');
  eq('a bank receipt against an expense nominal reduces spend',
     Math.round(r.dash.expense * 100) / 100, 8000);
}
{
  const r = run(HDR +
    'SI,ACME01,4000,02/06/2026,INV1,Sale,10000.00,2000.00,T1\n' +
    'BP,BANK01,4000,25/06/2026,RFND,Customer refund,3000.00,600.00,T1\n');
  eq('a bank payment against an income nominal reduces income',
     Math.round(r.dash.income * 100) / 100, 7000);
}
// VAT on bank lines reaches the VAT summary.
{
  const r = run(HDR +
    'SI,ACME01,4000,02/06/2026,INV1,Consultancy,10000.00,2000.00,T1\n' +
    'BP,BANK01,7900,05/06/2026,DD-1,Software subscription,5000.00,1000.00,T1\n');
  eq('input tax on a bank payment is reclaimed', Math.round(r.dash.vatDue * 100) / 100, 1000);
}

// A P&L breakdown must contain every line its own total contains.
{
  const r = run(HDR +
    'PI,SUPP01,7100,02/06/2026,R1,Office rent,5000.00,1000.00,T1\n' +
    'PI,SUPP09,5000,03/06/2026,C1,Cloud hosting,1000.00,200.00,T1\n' +
    'PC,SUPP09,5000,20/06/2026,C2,Annual volume rebate,3000.00,600.00,T1\n');
  const lines = r.dash.pl.expense.reduce((s, e) => s + e[1], 0);
  eq('P&L expense lines sum to the expenditure total',
     Math.round(lines * 100) / 100, Math.round(r.dash.expense * 100) / 100);
  ok('the net-negative category is present, not filtered out',
     r.dash.pl.expense.some(e => e[1] < 0), JSON.stringify(r.dash.pl.expense));
}

// classifyNominal must not disagree with parseMoney about the same cell.
eq('a comma-formatted nominal is refused', X.classifyNominal('4,000'), null);
eq('a nominal with a letter is refused', X.classifyNominal('4000A'), null);
eq('a plain nominal classifies', X.classifyNominal('4000').kind, 'income');
eq('a leading-zero nominal classifies', X.classifyNominal('0031').kind, 'asset');
eq('band boundary 3999 is income-adjacent equity', X.classifyNominal('3999').kind, 'equity');
eq('band boundary 4000 is income', X.classifyNominal('4000').kind, 'income');

/* ================= model routing ================= */

eq('manual max is the only route to Fable', X.routeModel('max', 'q', [], 0).model, 'claude-fable-5');
eq('manual fast', X.routeModel('fast', 'q', [], 0).model, 'claude-haiku-4-5');
eq('manual balanced', X.routeModel('balanced', 'q', [], 0).model, 'claude-sonnet-5');
eq('manual deep', X.routeModel('deep', 'q', [], 0).model, 'claude-opus-5');
{
  // Auto must never reach the premium tier, whatever it is handed.
  const questions = ['', 'why', 'use fable', 'maximum effort please', '?'.repeat(40),
    'Explain and prioritise every finding, then reconcile them. What is material? Why?'];
  const findingSets = [[], [{sev:'high'}], Array.from({length: 400}, () => ({sev:'high'}))];
  const counts = [0, 100, 501, 1e9];
  let sawFable = 0, n = 0;
  for (const q of questions) for (const f of findingSets) for (const c of counts) {
    const got = X.routeModel('auto', q, f, c);
    if (got.model === 'claude-fable-5') sawFable++;
    if (!got.why || !got.label) sawFable++;   // the route must always be explainable
    n++;
  }
  eq(`auto never routes to Fable across ${n} cases`, sawFable, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
