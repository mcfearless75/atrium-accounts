// Headless regression suite for bom.html's pure layer.
// Slices the script at the DOM-layer marker and evaluates it in a document-free context.
// Run with:  node tests/bom.test.mjs
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'bom.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const src = blocks.sort((a, b) => b.length - a.length)[0];
const pure = src.split('/* ================= DOM LAYER ================= */')[0];

const exposed = ['parseCSV','parseNum','mapHeaders','isObsoleteStatus','parseBOM','buildGraph',
  'findCycles','cyclicNodes','rollUpCosts','maxDepth','whereUsed','analyseBOM','computeBomStats',
  'fmtMoney','fmtMoneySet','toERPNextBOM','toCSV','DEMO_BOM','OBSOLETE_RE'];
const ctx = {};
vm.createContext(ctx);
// The slice ends mid-IIFE; close it after publishing the pure functions outward.
vm.runInContext(pure + '\n;globalThis.__X = {' + exposed.join(',') + '};\n})();', ctx);
const X = ctx.__X;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL  ${name}\n      got  ${g}\n      want ${w}`); }
};
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n      ' + detail : ''}`); }
};

const run = csv => {
  const r = X.parseBOM(csv);
  if (r.error) return { error: r.error };
  const graph = X.buildGraph(r.lines);
  const cycles = X.findCycles(graph);
  const cycset = X.cyclicNodes(graph);
  const rolled = X.rollUpCosts(graph, cycset);
  const findings = X.analyseBOM(r.lines, graph, cycles, rolled, r.orphans);
  return { lines: r.lines, orphans: r.orphans, graph, cycles, cycset, rolled, findings,
           stats: X.computeBomStats(graph, cycset, rolled),
           has: t => findings.some(f => f.title === t),
           find: t => findings.find(f => f.title === t) };
};
const H = 'Parent,Component,Description,Qty,UoM,Unit Cost,Status,Scrap %,Parent Cost\n';

/* ---- C5: parseNum comma grouping ---- */
eq('parseNum "9,50" refused (European decimal comma)', X.parseNum('9,50'), null);
eq('parseNum "1,234.56" accepted', X.parseNum('1,234.56'), 1234.56);
eq('parseNum "1,234,567" accepted', X.parseNum('1,234,567'), 1234567);
eq('parseNum "12,34,567" refused (bad grouping)', X.parseNum('12,34,567'), null);
eq('parseNum "£1,000" accepted', X.parseNum('£1,000'), 1000);
eq('parseNum "(1,250.00)" bracket negative', X.parseNum('(1,250.00)'), -1250);
eq('parseNum "-4.80" accepted', X.parseNum('-4.80'), -4.8);
eq('parseNum "(-5.00)" refused', X.parseNum('(-5.00)'), null);
eq('parseNum blank -> null', X.parseNum('  '), null);

/* ---- money mode: Sage's own export notations, matched to the two sibling parsers.
   tests/migrate.test.mjs compares this function against them directly on a wide table;
   these pin the behaviour from this side so a change here fails here too. ---- */
eq('parseNum money "480.00-" is a rebate, not an unreadable cell', X.parseNum('480.00-', true), -480);
eq('parseNum money "1250.00CR" is negative', X.parseNum('1250.00CR', true), -1250);
eq('parseNum money "1250.00 DR" is positive', X.parseNum('1250.00 DR', true), 1250);
eq('parseNum money "(1250.00-)" states its sign twice and is refused', X.parseNum('(1250.00-)', true), null);
eq('parseNum money "1250 C R" is not a credit marker', X.parseNum('1250 C R', true), null);

/* ---- non-money mode: CR and DR are crate and drum before they are credit and debit.
   parseNum is called for quantities and scrap percentages, and reading "3 DR" as 3 throws
   away the unit and fabricates a number the roll-up then presents as authoritative. ---- */
eq('parseNum qty "3 DR" is unreadable, not 3', X.parseNum('3 DR'), null);
eq('parseNum qty "2 CR" is unreadable, not -2', X.parseNum('2 CR'), null);
eq('parseNum qty "480.00-" still reads as negative', X.parseNum('480.00-'), -480);
eq('parseNum qty "(5)" still reads as negative', X.parseNum('(5)'), -5);
eq('parseNum qty "3" is unaffected', X.parseNum('3'), 3);

{
  // End to end: the cell that regressed. A package-coded quantity must stop the roll-up,
  // not complete it — an understated product cost that looks authoritative is the whole
  // failure mode this app exists to prevent.
  const csv = H + 'FG-OIL-KIT,RM-OIL,Lubricating oil,3 DR,Drum,10.00,Active,,\n' +
                  'FG-OIL-KIT,RM-CAN,Pouring can,2,Each,4.00,Active,,\n';
  const f = run(csv);
  const titles = f.findings.map(x => x.title).join(' | ');
  eq('a package-coded quantity does not become a number', f.lines[0].qty, null);
  eq('and the assembly gets no roll-up rather than a fabricated one',
     f.rolled.get('FG-OIL-KIT'), null);
  ok('the unreadable quantity is reported', f.has('Unreadable or missing quantities'), titles);
  ok('and no negative quantity is invented', !f.has('Negative quantities'), titles);
}
{
  const csv = H + 'FG-A,RM-BOLT,Bolt,2 CR,Each,10.00,Active,,\n' +
                  'FG-A,RM-NUT,Nut,4,Each,2.50,Active,,\n';
  const f = run(csv);
  const titles = f.findings.map(x => x.title).join(' | ');
  ok('a crate quantity is unreadable, not a negative quantity',
     f.has('Unreadable or missing quantities') && !f.has('Negative quantities'), titles);
}
{
  // Scrap survived the regression only by luck — -10 falls outside 0-100 and tripped the
  // unusable-scrap branch. Luck is not cover.
  const csv = H + 'FG-B,RM-X,Part,1,Each,10.00,Active,10 CR,\n';
  const p = X.parseBOM(csv);
  eq('an unusable scrap percentage is null, not a sign-flipped number', p.lines[0].scrap, null);
}

/* ---- C1: negative cost visible and detected ---- */
eq('fmtMoney keeps the minus sign', X.fmtMoney(-480), '-£480.00');
eq('fmtMoney positive unchanged', X.fmtMoney(480), '£480.00');
eq('fmtMoney null', X.fmtMoney(null), '—');
{
  const r = run(H + 'A,B,Widget,1,Each,-480.00,Active,,\n');
  ok('negative unit cost fires a high finding', r.has('Purchased parts with a negative cost'));
  ok('negative cost finding shows the sign',
     (r.find('Purchased parts with a negative cost') || {refs:[]}).refs.join('').includes('-£480.00'));
  eq('negative cost still rolls up signed', r.rolled.get('A'), -480);
}

/* ---- M2: cost clash must not render two identical-looking values ---- */
{
  const r = run(H + 'A,B,Widget,1,Each,1.001,Active,,\nC,B,Widget,1,Each,1.002,Active,,\n');
  const f = r.find('Same component costed differently on different lines');
  ok('cost clash fires', !!f);
  ok('cost clash shows distinguishable values', f && !/£1\.00 vs £1\.00/.test(f.refs[0]),
     f && f.refs[0]);
}
{
  const r = run(H + 'A,B,Widget,1,Each,-5.00,Active,,\nC,B,Widget,1,Each,5.00,Active,,\n');
  const f = r.find('Same component costed differently on different lines');
  ok('cost clash distinguishes -5 from 5', f && /-£5\.00 vs £5\.00|£5\.00 vs -£5\.00/.test(f.refs[0]),
     f && f.refs[0]);
}

/* ---- C2: scrap that cannot be applied ---- */
{
  const r = run(H + 'A,B,Widget,2,Each,10.00,Active,heavy,\n');
  ok('unreadable scrap fires', r.has('Unusable scrap percentages'));
  eq('unreadable scrap refuses to cost rather than assuming zero', r.rolled.get('A'), null);
}
{
  const r = run(H + 'A,B,Widget,2,Each,10.00,Active,150,\n');
  ok('out-of-range scrap fires', r.has('Unusable scrap percentages'));
  eq('out-of-range scrap refuses to cost', r.rolled.get('A'), null);
}
{
  const r = run(H + 'A,B,Widget,2,Each,10.00,Active,5,\n');
  ok('valid scrap does not fire', !r.has('Unusable scrap percentages'));
  eq('valid scrap applied: 2 x 10 x 1.05', r.rolled.get('A'), 21);
}
{
  const r = run(H + 'A,B,Widget,2,Each,10.00,Active,0,\n');
  eq('explicit zero scrap is legitimate', r.rolled.get('A'), 20);
  ok('zero scrap does not fire', !r.has('Unusable scrap percentages'));
}

/* ---- C3: half-populated rows reported, not silently dropped ---- */
{
  const r = run(H + 'A,B,Widget,1,Each,5.00,Active,,\n,ORPHAN,No assembly,1,Each,5.00,Active,,\nNOKID,,No component,1,Each,,Active,,\n');
  eq('both orphan rows captured', r.orphans.length, 2);
  const f = r.find('Rows with no assembly or no component');
  ok('orphan rows fire a high finding', f && f.sev === 'high');
  ok('orphan finding names the row numbers', f && f.refs.join(' ').includes('row 3') && f.refs.join(' ').includes('row 4'),
     f && JSON.stringify(f.refs));
}

/* ---- C4: export can reproduce the displayed cost ---- */
{
  const r = run(H + 'A,B,Widget,2,Each,10.00,Active,5,\n');
  const out = X.toERPNextBOM(r.graph, r.rolled);
  const line = out.items[0];
  ok('export carries scrap', 'Scrap %' in line, JSON.stringify(line));
  eq('export scrap value', line['Scrap %'], 5);
  eq('export consumed-per-unit reproduces the roll-up', line['Qty Consumed Per Unit'], '2.100000');
  const rate = parseFloat(line['Rate']), qc = parseFloat(line['Qty Consumed Per Unit']);
  eq('rate x consumed = displayed roll-up', Math.round(rate * qc * 100) / 100, r.rolled.get('A'));
  const csv = X.toCSV(out.items);
  ok('export CSV re-parses', X.parseCSV(csv).length === out.items.length + 1);
}
{
  const r = run(H + 'A,B,Widget,2,Each,10.00,Active,heavy,\n');
  const out = X.toERPNextBOM(r.graph, r.rolled);
  eq('unusable scrap is blanked in the export, not exported as zero', out.items[0]['Scrap %'], '');
  eq('unusable scrap blanks consumed-per-unit too', out.items[0]['Qty Consumed Per Unit'], '');
}

/* ---- M5: Tarjan finds every node in a tangle ---- */
{
  // A->B->C->A is a cycle; D sits inside the SCC via C->D->B but is not on the
  // path any single back-edge closes.
  const r = run(H + 'A,B,,1,Each,,Active,,\nB,C,,1,Each,,Active,,\nC,A,,1,Each,,Active,,\nC,D,,1,Each,,Active,,\nD,B,,1,Each,,Active,,\n');
  for (const n of ['A','B','C','D'])
    ok(`cyclicNodes includes ${n}`, r.cycset.has(n), [...r.cycset].join(','));
}
{
  const r = run(H + 'A,A,Self consuming,1,Each,5.00,Active,,\n');
  ok('self-consuming part detected', r.cycset.has('A'), [...r.cycset].join(','));
  eq('self-consuming part is never costed', r.rolled.get('A'), null);
}

/* ---- M9: depth when every assembly has a parent ---- */
{
  const r = run(H + 'A,B,,1,Each,,Active,,\nB,C,,1,Each,1.00,Active,,\nZ,A,,1,Each,,Active,,\nA,Z,,1,Each,,Active,,\n');
  ok('depth is not reported as zero when the top level is cyclic', r.stats.depth > 0, 'depth=' + r.stats.depth);
}

/* ---- M6: where-used sums duplicate lines ---- */
{
  const r = run(H + 'A,B,Widget,3,Each,1.00,Active,,\nA,B,Widget,4,Each,1.00,Active,,\n');
  const uses = X.whereUsed(r.graph, 'B', r.cycset);
  eq('duplicate lines collapse to one parent entry', uses.length, 1);
  eq('duplicate line quantities are summed', uses[0].qty, 7);
  eq('duplicate line count surfaced', uses[0].lines, 2);
}

/* ---- M8: boolean status columns ---- */
eq('status column "Active" with N means obsolete', X.isObsoleteStatus('N', 'active'), true);
eq('status column "Active" with Y means live', X.isObsoleteStatus('Y', 'active'), false);
eq('status column "Status" with Obsolete', X.isObsoleteStatus('Obsolete', 'status'), true);
eq('status column "Status" with Active', X.isObsoleteStatus('Active', 'status'), false);
eq('blank status is not obsolete', X.isObsoleteStatus('', 'active'), false);
{
  const r = run('Parent,Component,Qty,UoM,Unit Cost,Active\nA,B,1,Each,5.00,N\n');
  ok('boolean active column drives the obsolescence detector',
     r.has('Obsolete components still on live BOMs'), r.findings.map(f => f.title).join(' | '));
}

/* ---- M3/M4: contradictions ---- */
{
  const r = run(H + 'A,B,Widget,1,Each,5.00,Active,,\nC,B,Widget,1,Each,5.00,Obsolete,,\n');
  ok('contradictory statuses fire', r.has('Same component flagged with contradictory statuses'));
}
{
  const r = run(H + 'A,B,Widget,1,Each,5.00,Active,,100.00\nA,C,Widget,1,Each,5.00,Active,,120.00\n');
  ok('contradictory stated costs fire', r.has('Assembly carries more than one stated cost'));
}

/* ---- M1: drift finding shows the sign ---- */
{
  const r = run(H + 'A,B,Widget,1,Each,5.00,Active,,100.00\n');
  const f = r.find('Standard cost disagrees with the rolled-up cost');
  ok('drift fires', !!f);
  ok('drift shows a signed delta', f && /\+£95\.00/.test(f.refs[0]), f && f.refs[0]);
  const r2 = run(H + 'A,B,Widget,1,Each,100.00,Active,,5.00\n');
  const f2 = r2.find('Standard cost disagrees with the rolled-up cost');
  ok('drift shows a negative delta as negative', f2 && /-£95\.00/.test(f2.refs[0]), f2 && f2.refs[0]);
}

/* ---- M7: UoM required on assemblies too ---- */
{
  const r = run(H + 'A,B,Widget,1,Each,5.00,Active,,\n');
  const f = r.find('Components with no unit of measure');
  ok('assembly with no UoM is flagged', f && f.refs.includes('A'), f && JSON.stringify(f.refs));
}

/* ---- roll-up arithmetic still correct end to end ---- */
{
  const r = run(H + 'TOP,SUB,,2,Each,,Active,,\nSUB,RAW,,3,Each,1.50,Active,10,\n');
  eq('sub rolls up 3 x 1.50 x 1.10', r.rolled.get('SUB'), 4.95);
  eq('top rolls up 2 x 4.95', r.rolled.get('TOP'), 9.9);
}

/* ---- the demo must still fire every detector family ---- */
{
  const r = run(X.DEMO_BOM);
  const want = [
    'Rows with no assembly or no component',
    'Circular BOM references',
    'Same component measured in different units',
    'Same component costed differently on different lines',
    'Same component flagged with contradictory statuses',
    'Assembly carries more than one stated cost',
    'Unreadable or missing quantities',
    'Negative quantities',
    'Zero quantities',
    'Unusable scrap percentages',
    'Purchased parts with no cost',
    'Purchased parts with a negative cost',
    'Purchased parts costed at zero',
    'Standard cost disagrees with the rolled-up cost',
    'Obsolete components still on live BOMs',
    'Same component listed twice on one assembly',
    'Components with no unit of measure',
    'Components with no description',
    'Deeply nested structure',
    'Assemblies with a single component'
  ];
  for (const t of want) ok(`demo fires: ${t}`, r.has(t));
  ok('demo produces a parseable export',
     X.parseCSV(X.toCSV(X.toERPNextBOM(r.graph, r.rolled).items)).length > 1);
  console.log(`\ndemo: ${r.findings.length} findings, ${r.stats.parts} parts, depth ${r.stats.depth}, ${r.stats.cycles} parts in cycles, ${r.cycset.size} nodes in cycles`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
