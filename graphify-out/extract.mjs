/**
 * Knowledge-graph extractor for mas_hrms / PeopleOS. READ-ONLY over the repo.
 * Regex-based on purpose: one pass over ~1,295 files. Where a pattern cannot be
 * sure, it counts nothing rather than guessing.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC  = path.join(ROOT, 'backend/src');
const OUT  = path.join(ROOT, 'graphify-out');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(p, acc);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}
const files = walk(SRC);

const SQL_NOISE = new Set(['select','from','where','and','or','as','on','set','values','dual',
 'if','case','when','then','else','end','null','not','exists','in','join','left','right','inner',
 'outer','cross','union','all','order','group','by','having','limit','offset','asc','desc',
 'distinct','information_schema','tmp','temp','sub','unnest','lateral','recursive']);
const isTable = (n) => {
  if (!n) return false;
  const l = n.toLowerCase();
  if (SQL_NOISE.has(l)) return false;
  if (n.includes('_') && /^[a-z][a-z0-9_]{2,}$/i.test(n)) return true;
  return /^[a-z][a-z0-9]{4,}$/i.test(n);
};

const CROSS_DB = { billQuery:'db_bill', getBillPool:'db_bill', getLegacyPool:'db_bill',
 legacyQuery:'db_bill', dialerQuery:'dialer_db', getDialerPool:'dialer_db',
 masmisQuery:'db_masmis', getMasmisPool:'db_masmis', aprQuery:'apr', getAprPool:'apr',
 ncosecQuery:'ncosec', getNcosecPool:'ncosec', shivamgiriQuery:'Shivamgiri', lmsQuery:'lms' };

const modules = new Map();
const routeRows = [], tableRefRows = [], crossDbRows = [];

const moduleOf = (f) => {
  const parts = path.relative(SRC, f).split(path.sep);
  return parts[0] === 'modules' ? parts[1] : '_' + parts[0];
};

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const mod = moduleOf(file);
  if (!modules.has(mod)) modules.set(mod, { files:0, loc:0, routes:[],
    reads:new Set(), writes:new Set(), roles:new Set(), crossDb:new Set() });
  const M = modules.get(mod);
  M.files++; M.loc += src.split('\n').length;

  const routeRe = /(?:router|[A-Za-z0-9_]*Router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(?:\n\s*)?["'`]([^"'`]*)["'`]([\s\S]{0,400}?)(?:h\(|async\s*\(|\(req)/g;
  let m;
  while ((m = routeRe.exec(src))) {
    const [, method, rpath, tail] = m;
    const roles = [];
    const rr = /requireRole\(([^)]*)\)/.exec(tail || '');
    if (rr) {
      for (const r of rr[1].matchAll(/["'`]([a-z_]+)["'`]/gi)) roles.push(r[1]);
      if (/\.\.\.[A-Za-z0-9_]+/.test(rr[1])) roles.push('<spread>');
    }
    roles.forEach(r => M.roles.add(r));
    M.routes.push({ method: method.toUpperCase(), path: rpath, roles, file: rel });
    routeRows.push([mod, method.toUpperCase(), rpath, roles.join('|'), rel].join('\t'));
  }

  for (const t of src.matchAll(/\b(?:FROM|JOIN)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/gi))
    if (isTable(t[1])) { M.reads.add(t[1]); tableRefRows.push([mod,t[1],'read',rel].join('\t')); }

  // `ON DUPLICATE KEY UPDATE <col>` is not a write target - strip those first,
  // otherwise every upsert column is mistaken for a table name.
  const wsrc = src.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, 'ON_DUP_KEY');
  for (const t of wsrc.matchAll(/\b(?:INSERT\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/gi))
    if (isTable(t[1])) { M.writes.add(t[1]); tableRefRows.push([mod,t[1],'write',rel].join('\t')); }

  for (const [fn, db] of Object.entries(CROSS_DB))
    if (new RegExp('\\b' + fn + '\\s*[(<]').test(src)) {
      M.crossDb.add(db); crossDbRows.push([mod, db, fn, rel].join('\t'));
    }
}

const W = (f, s) => fs.writeFileSync(path.join(OUT, f), s);
W('routes.tsv',    'module\tmethod\tpath\troles\tfile\n' + routeRows.join('\n') + '\n');
W('table_refs.tsv','module\ttable\tmode\tfile\n' + [...new Set(tableRefRows)].join('\n') + '\n');
W('cross_db.tsv',  'module\tdatabase\tvia\tfile\n' + [...new Set(crossDbRows)].join('\n') + '\n');

W('modules.tsv', 'module\tfiles\tloc\troutes\ttables_read\ttables_written\tcross_db\troles\n' +
  [...modules.entries()].sort((a,b)=>b[1].loc-a[1].loc).map(([k,v]) =>
    [k,v.files,v.loc,v.routes.length,v.reads.size,v.writes.size,
     [...v.crossDb].join('|')||'-', [...v.roles].sort().join('|')||'-'].join('\t')).join('\n') + '\n');

const owners = new Map();
for (const [mod,v] of modules) for (const t of v.writes) {
  if (!owners.has(t)) owners.set(t, new Set());
  owners.get(t).add(mod);
}
W('table_owners.tsv','table\twriter_modules\twriter_count\n' +
  [...owners.entries()].sort().map(([t,s])=>[t,[...s].sort().join('|'),s.size].join('\t')).join('\n') + '\n');

W('graph.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  scale: { modules: modules.size, files: files.length,
    loc: [...modules.values()].reduce((s,v)=>s+v.loc,0), routes: routeRows.length },
  modules: Object.fromEntries([...modules.entries()].map(([k,v])=>[k,{
    files:v.files, loc:v.loc, routes:v.routes.length,
    tables_read:[...v.reads].sort(), tables_written:[...v.writes].sort(),
    cross_db:[...v.crossDb], roles:[...v.roles].sort() }])),
}, null, 2));

console.log('modules ............ ' + modules.size);
console.log('files .............. ' + files.length);
console.log('loc ................ ' + [...modules.values()].reduce((s,v)=>s+v.loc,0));
console.log('routes ............. ' + routeRows.length);
console.log('table refs ......... ' + new Set(tableRefRows).size);
console.log('cross-db refs ...... ' + new Set(crossDbRows).size);
console.log('tables with writer . ' + owners.size);
