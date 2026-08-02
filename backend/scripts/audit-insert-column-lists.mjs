/**
 * Finds INSERT statements whose column list disagrees with the CREATE TABLE that defines
 * the table, anywhere in the migration manifest.
 *
 * Migration 038 failed twice in a row on exactly this, one column per CI run: its seed
 * INSERTs into survey_question named `id` and `display_order` while the CREATE fifty lines
 * above them declared `question_id` and `question_order`. On a database where the table
 * predates the migration under older column names the INSERT matches, so the mismatch is
 * invisible until something builds the schema from scratch.
 *
 * Only tables created within the manifest are checked, and only literal column lists.
 * An INSERT into a table this scan cannot see the definition of is skipped rather than
 * guessed at — a false alarm here would be worse than a miss, because it would train people
 * to ignore the output.
 *
 * Run:  node scripts/audit-insert-column-lists.mjs
 * Exit: 0 clean, 1 if any mismatch is found.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_DIR = join(BACKEND, "sql");

function readManifest() {
  const src = readFileSync(join(BACKEND, "src/db/runPendingMigrations.ts"), "utf8");
  const start = src.indexOf("const MIGRATION_MANIFEST");
  return [...src.slice(start, src.indexOf("];", start)).matchAll(/["']([^"']+\.sql)["']/g)].map((m) => m[1]);
}

const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*(?:ENGINE|;)/gi;
const INSERT_RE = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*\(([^)]*?)\)\s*(?:VALUES|SELECT)/gi;
const NON_COLUMN = /^(PRIMARY|UNIQUE|FOREIGN|INDEX|KEY|CONSTRAINT|CHECK|FULLTEXT|SPATIAL)\b/i;

function columnsOf(body) {
  const cols = new Set();
  let depth = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    // Track parenthesis depth so ENUM('a','b') spanning lines cannot be read as a column.
    const atTop = depth === 0;
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    if (!atTop || !line || line.startsWith("--") || NON_COLUMN.test(line)) continue;
    const m = line.match(/^`?(\w+)`?\s+\S/);
    if (m) cols.add(m[1].toLowerCase());
  }
  return cols;
}

const manifest = readManifest();
const known = new Map(); // table -> Set(columns), first definition wins
const findings = [];

// ALTER ... ADD COLUMN is how most columns arrive after the initial CREATE, so a table's
// real shape is the CREATE plus every later addition. Without this the scan would flag
// perfectly good INSERTs that use a column added by a subsequent migration.
//
// One ALTER frequently adds several columns at once —
//   ALTER TABLE employees ADD COLUMN a ..., ADD COLUMN b ..., ADD INDEX ...
// so every ADD COLUMN in the statement has to be collected, not just the first. An earlier
// version took only the first and reported five columns of 041 as missing, which is the
// exact false alarm that makes an audit worth ignoring.
const ALTER_RE = /ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?)(?=;|ALTER\s+TABLE\s|$)/gi;
const ADD_COL_RE = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi;

/** Every column any ALTER in this file adds, keyed by table. */
function creditAlters(sql, known) {
  for (const alter of sql.matchAll(ALTER_RE)) {
    const table = alter[1].toLowerCase();
    if (!known.has(table)) continue;
    for (const col of alter[2].matchAll(ADD_COL_RE)) {
      known.get(table).add(col[1].toLowerCase());
    }
  }
}

/**
 * Blank out INSERTs that already sit inside a column-existence guard.
 *
 * Several seeds are wrapped as `SET @sql = IF(@has_col > 0, '<INSERT ...>', 'SELECT ...')`
 * so a fresh database skips them rather than dying on a column that does not exist there.
 * Those are resolved. Continuing to report them would leave the audit permanently red, and
 * an audit that is always red is one nobody reads.
 *
 * Replaced with spaces rather than deleted so reported line numbers stay accurate.
 */
function blankGuardedSeeds(sql) {
  return sql.replace(/SET\s+@sql\s*=\s*IF\([\s\S]*?\);/gi, (m) => m.replace(/[^\n]/g, " "));
}

for (const file of manifest) {
  const path = join(SQL_DIR, file);
  if (!existsSync(path)) continue;
  // Credit CREATEs and ALTERs from the RAW text. blankGuardedSeeds removes guarded blocks,
  // and most ALTERs in this repository live inside exactly such a block — blanking before
  // crediting made 041 contribute nothing and reported five of its columns as missing.
  const raw = readFileSync(path, "utf8");
  const sql = blankGuardedSeeds(raw);

  for (const m of raw.matchAll(CREATE_RE)) {
    const t = m[1].toLowerCase();
    if (!known.has(t)) known.set(t, columnsOf(m[2]));
  }
  creditAlters(raw, known);

  for (const m of sql.matchAll(INSERT_RE)) {
    const t = m[1].toLowerCase();
    if (!known.has(t)) continue; // definition not visible in the manifest — do not guess
    const used = m[2]
      .split(",")
      .map((c) => c.trim().replace(/`/g, "").toLowerCase())
      .filter(Boolean);
    const missing = used.filter((c) => /^\w+$/.test(c) && !known.get(t).has(c));
    if (missing.length) {
      findings.push({ file, line: sql.slice(0, m.index).split("\n").length, table: t, missing });
    }
  }
}

// Files that exist in sql/ but are absent from the manifest are scanned too. They do not run
// today, so they cannot break the chain — but a migration staged for a future release is
// exactly where a wrong column name hides until the night it is applied. Two of the files
// prepared during this stabilisation (1061, 1062) were written against a page_id foreign key
// that does not exist; nothing would have caught that before someone ran them by hand.
const staged = [];
for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql") && !manifest.includes(f))) {
  const sql = blankGuardedSeeds(readFileSync(join(SQL_DIR, file), "utf8"));
  for (const m of sql.matchAll(INSERT_RE)) {
    const t = m[1].toLowerCase();
    if (!known.has(t)) continue;
    const missing = m[2]
      .split(",")
      .map((c) => c.trim().replace(/`/g, "").toLowerCase())
      .filter((c) => /^\w+$/.test(c) && !known.get(t).has(c));
    if (missing.length) {
      staged.push({ file, line: sql.slice(0, m.index).split("\n").length, table: t, missing });
    }
  }
}

console.log(`Scanned ${manifest.length} manifest migrations, ${known.size} table definitions.`);
console.log(`INSERTs naming a column their table does not have: ${findings.length}\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  INSERT INTO ${f.table} uses ${f.missing.join(", ")}`);
}

if (staged.length) {
  console.log(`\nStaged files (present in sql/, absent from the manifest): ${staged.length}`);
  for (const f of staged) {
    console.log(`  ${f.file}:${f.line}  INSERT INTO ${f.table} uses ${f.missing.join(", ")}`);
  }
}

process.exit(findings.length || staged.length ? 1 : 0);
