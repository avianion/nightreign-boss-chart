// Black-box check of index.html against the raw datamined map-pattern CSVs.
//
//   node tools/verify.mjs <index.html> <map_patterns_base.csv> <map_patterns_gh.csv>
//
// Runs the page's own <script> under a stub DOM, drives calc() for every
// Night 1 x Night 2 (x Map, when the page has a map picker) combination, and
// compares the rendered Nightlords and percentages with an oracle computed
// straight from the CSVs. The oracle deliberately keeps its own name table so a
// mapping mistake in tools/build_seeds.py can't hide itself here.
import fs from 'node:fs';
import vm from 'node:vm';

const [htmlPath, baseCsv, ghCsv] = process.argv.slice(2);
if (!htmlPath || !baseCsv || !ghCsv) {
  console.error('usage: node tools/verify.mjs <index.html> <base.csv> <gh.csv>');
  process.exit(2);
}

// ---------------------------------------------------------------- CSV oracle
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const NIGHTLORD = {
  Gladius: 'gladius', Adel: 'adel', Gnoster: 'gnoster', Maris: 'maris', Libra: 'libra',
  Fulghor: 'fulghor', Caligo: 'caligo', Heolstor: 'heolstor', Dreglord: 'dreglord', Harmonia: 'balancers',
};
// Page dropdown value -> every spelling the CSVs use for that boss.
const NIGHT1 = {
  battlefield: ['Battlefield Commander'], bbh: ['Bell Bearing Hunter'], centipede: ['Centipede Demon'],
  demi: ['Demi-Human Queen and Swordmaster', 'Demihuman Queen & Swordmaster'], gaping: ['Gaping Dragon'],
  grafted: ['Grafted Monarch'], cavalry: ["Night's Cavalry Duo", "Night's Cavalries"], revenant: ['Royal Revenant'],
  smelter: ['Smelter Demon'], freja: ["The Duke's Dear Freja", "Duke's Dear Freja"], tibia: ['Tibia Mariner'],
  tree: ['Ulcerated Tree Spirit'], gargoyle: ['Valiant Gargoyle'], wormface: ['Wormface'],
  deathknight: ['Death Knights'], demons: ['Demons'], warrior: ['DBW & Curseblade'], bear: ['Great Red Bear'],
};
const NIGHT2 = {
  ancient: ['Ancient Dragon'], crucible: ['Crucible Knight and Golden Hippopotamus', 'Crucible Knight & Hippo'],
  dancer: ['Dancer of the Boreal Valley', 'Dancer'], deathrite: ['Death Rite Bird'],
  draconic: ['Draconic Tree Sentinel and Royal Cavalrymen', 'Draconic Tree Sentinel'], fallingstar: ['Fallingstar Beast'],
  fell: ['Morgott'], godskin: ['Godskin Duo'], wyrm: ['Great Wyrm'], nameless: ['Nameless King'],
  nox: ['Dragonkin Soldier'], outland: ['Outland Commander'],
  treesent: ['Tree Sentinel and Royal Cavalrymen', 'Tree Sentinel'], artorias: ['Artorias'], lion: ['Dancing Lion'],
  mohg: ['Mohg'], demonprince: ['Demon Prince'],
};
const MAPS = { Default: 'default', Crater: 'crater', Mountaintop: 'mountaintop', 'Rotted Woods': 'rotted', Noklateo: 'noklateo' };

const patterns = [];
for (const [file, isHollow] of [[baseCsv, false], [ghCsv, true]]) {
  for (const r of parseCsv(fs.readFileSync(file, 'utf8'))) {
    const nl = NIGHTLORD[r.Nightlord];
    if (!nl) throw new Error(`oracle: unknown nightlord ${r.Nightlord}`);
    const map = isHollow ? 'hollow' : MAPS[r['Shifting Earth']];
    if (!map) throw new Error(`oracle: unknown map ${r['Shifting Earth']}`);
    const night1 = [r['Night 1 Boss']], night2 = [r['Night 2 Boss']];
    if (r['Extra Night Boss']) {
      if (r['Special Event'] === 'Day 1 Extra Night Boss') night1.push(r['Extra Night Boss']);
      else if (r['Special Event'] === 'Day 2 Extra Night Boss') night2.push(r['Extra Night Boss']);
      else throw new Error(`oracle: extra boss without event in ${r.ID}`);
    }
    patterns.push({ id: r.ID, nl, map, night1, night2 });
  }
}
const totals = {};
for (const p of patterns) totals[p.nl] = (totals[p.nl] || 0) + 1;

function oracleCounts(n1, n2, map) {
  const counts = {};
  for (const p of patterns) {
    if (map && p.map !== map) continue;
    if (n1 && !NIGHT1[n1].some(name => p.night1.includes(name))) continue;
    if (n2 && !NIGHT2[n2].some(name => p.night2.includes(name))) continue;
    counts[p.nl] = (counts[p.nl] || 0) + 1;
  }
  return counts;
}

// ------------------------------------------------------------ page under test
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function parseOptions(id) {
  const m = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`));
  if (!m) return null;
  return [...m[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
    .map(([, value, text]) => ({ value, textContent: text }));
}

class FakeSelect {
  constructor(options) { this.options = options; this.value = ''; this.handlers = {}; }
  get firstChild() { return this.options[0] || null; }
  removeChild(o) { this.options.splice(this.options.indexOf(o), 1); }
  appendChild(o) { this.options.push(o); }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  fire(type) { this.handlers[type]?.(); }
}

const elements = { output: { innerHTML: '' } };
for (const id of ['n1', 'n2', 'depth', 'map']) {
  const opts = parseOptions(id);
  if (opts) elements[id] = new FakeSelect(opts);
}
const hasMap = Boolean(elements.map);
elements.depth.value = 'd3';

const context = vm.createContext({
  document: {
    getElementById: id => elements[id] ?? null,
    createElement: () => ({ value: '', textContent: '' }),
  },
  console,
});
vm.runInContext(`${script}\n;globalThis.__calc = calc; globalThis.__BASE = BASE; globalThis.__EXP = EXPEDITIONS;`, context);
const { __calc: calc, __BASE: BASE, __EXP: EXP } = context;

const nameToKey = Object.fromEntries(Object.entries(EXP).filter(([k]) => !k.startsWith('es_')).map(([k, v]) => [v.name, k]));

function render(n1, n2, map, depth) {
  elements.n1.value = n1; elements.n2.value = n2; elements.depth.value = depth;
  if (hasMap) elements.map.value = map;
  calc();
  const out = elements.output.innerHTML;
  const names = [...out.matchAll(/class="boss-card-name">([^<]+)</g)].map(m => nameToKey[m[1]] ?? m[1]);
  const pcts = [...out.matchAll(/class="boss-card-pct">([\d.]+)%</g)].map(m => Number(m[1]));
  return Object.fromEntries(names.map((k, i) => [k, pcts[i]]));
}

function expectedPct(counts, depth) {
  const prior = BASE[depth];
  const score = {};
  let total = 0;
  for (const [variant, w] of Object.entries(prior)) {
    const nl = variant.replace(/^es_/, '');
    const s = w * (counts[nl] || 0) / totals[nl];
    if (s > 0) { score[nl] = (score[nl] || 0) + s; total += s; }
  }
  return Object.fromEntries(Object.entries(score).map(([k, v]) => [k, (v / total) * 100]));
}

// ------------------------------------------------------------------- checks
let checked = 0;
const failures = [];
const maps = hasMap ? ['', 'default', 'crater', 'mountaintop', 'rotted', 'noklateo', 'hollow'] : [''];
const depths = ['d3', 'd4', 'd5', 'any'];

for (const depth of depths) {
  for (const map of maps) {
    for (const n1 of Object.keys(NIGHT1)) {
      for (const n2 of ['', ...Object.keys(NIGHT2)]) {
        const expected = expectedPct(oracleCounts(n1, n2, map), depth);
        const got = render(n1, n2, map, depth);
        checked++;
        const keys = new Set([...Object.keys(expected), ...Object.keys(got)]);
        const bad = [...keys].filter(k => !(k in got) || !(k in expected) || Math.abs(got[k] - expected[k]) > 0.06);
        if (bad.length) {
          failures.push(`depth=${depth} map=${map || '?'} n1=${n1} n2=${n2 || '-'}: ` +
            bad.map(k => `${k} got ${got[k]?.toFixed(1) ?? 'absent'} want ${expected[k]?.toFixed(1) ?? 'absent'}`).join('; '));
        }
      }
    }
  }
}

// Dropdown filtering: after picking Night 1 (and map), Night 2 must list
// exactly the bosses some pattern pairs with it.
for (const map of maps) {
  for (const n1 of Object.keys(NIGHT1)) {
    elements.depth.value = 'd3';
    if (hasMap) { elements.map.value = map; elements.map.fire('change'); }
    elements.n2.value = ''; elements.n2.fire('change');
    elements.n1.value = n1; elements.n1.fire('change');
    const got = elements.n2.options.map(o => o.value).filter(Boolean).sort();
    const want = Object.keys(NIGHT2).filter(n2 => Object.keys(oracleCounts(n1, n2, map)).length).sort();
    checked++;
    if (got.join() !== want.join()) {
      failures.push(`dropdown map=${map || '?'} n1=${n1}: night 2 options [${got}] want [${want}]`);
    }
  }
}

console.log(`${patterns.length} patterns, ${checked} checks, ${failures.length} failures`);
for (const f of failures.slice(0, 40)) console.log('  FAIL ' + f);
if (failures.length > 40) console.log(`  ... ${failures.length - 40} more`);
process.exit(failures.length ? 1 : 0);
