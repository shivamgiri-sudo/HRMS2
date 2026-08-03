/**
 * Finds migration guards that fire against a table that does not exist yet.
 *
 * The pattern is everywhere in this repo and it is correct on an existing database:
 *
 *   SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
 *                WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t' AND COLUMN_NAME='c');
 *   SET @sql = IF(@col=0, 'ALTER TABLE t ADD COLUMN c ...', 'SELECT ''ok''');
 *   PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
 *
 * It means "add the column if it is missing". But a column count of 0 does not
 * distinguish "the table exists and lacks this column" from "the table does not exist
 * at all" — and on a fresh database the second is what is true. The guard then fires an
 * ALTER against a missing table and the whole chain stops, because STOP_ON_FIRST_FAILURE
 * defaults to true.
 *
 * The mirror-image guard, IF(@col>0, 'ALTER ...'), is safe on a fresh database: 0 columns
 * means it does not fire. Only the =0 direction is reported here.
 *
 * A guard is only a real defect if no earlier point in the manifest creates its table, so
 * this walks the manifest in order and reports the ones that are genuinely unreachable —
 * not every instance of the pattern.
 *
 * Run:  node scripts/audit-fresh-db-guards.mjs
 * Exit: 0 clean, 1 if any unsafe guard is found.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, "..");
const SQL_DIR = join(BACKEND, "sql");

// The manifest is the execution order. A directory listing is not: files are numbered
// inconsistently (two 1059s, 010 twice, 013/014 absent) and the manifest deliberately
// runs some out of numeric order.
function readManifest() {
  const src = readFileSync(join(BACKEND, "src/db/runPendingMigrations.ts"), "utf8");
  const start = src.indexOf("const MIGRATION_MANIFEST");
  const end = src.indexOf("];", start);
  return [...src.slice(start, end).matchAll(/["']([^"']+\.sql)["']/g)].map((m) => m[1]);
}

const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi;

// Two SET statements and an IF, tolerant of comments and newlines between them.
/**
 * Four syntaxes in this repository express "add the column if it is missing", and every one
 * of them has the same blind spot. Each was found the hard way, one twelve-minute CI run at
 * a time, so all four are checked here now.
 *
 *   1. SET @col = (SELECT COUNT(*) ... COLUMNS ...);
 *      SET @sql = IF(@col = 0, 'ALTER TABLE t ...', ...);
 *   2. IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS ...) THEN ALTER TABLE t ...
 *      (procedural, inside a stored procedure)
 *   3. IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS ...) THEN
 *        ALTER TABLE t ADD INDEX ...   (index name checked, indexed columns not)
 *   4. SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE t ...', 'SELECT 1') FROM ... COLUMNS ...);
 *
 * A column count of zero is also what a missing table looks like, and an absent index says
 * nothing about whether the columns it names exist. On production both distinctions are
 * invisible because the table and columns have always been there.
 */
const EXTRA_GUARD_FORMS = [
  {
    name: "procedural column guard",
    re: /IF\s+NOT\s+EXISTS\s*\(\s*SELECT[\s\S]{0,300}?information_schema\.COLUMNS[\s\S]{0,300}?TABLE_NAME\s*=\s*'(\w+)'/gi,
  },
  {
    name: "SELECT-wrapped column guard",
    re: /SET\s+@sql\s*=\s*\(\s*SELECT\s+IF\(\s*COUNT\(\*\)\s*=\s*0\s*,[\s\S]{0,600}?FROM\s+information_schema\.COLUMNS\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)\s+AND\s+TABLE_NAME\s*=\s*'(\w+)'/gi,
  },
];

const GUARD_RE = new RegExp(
  String.raw`SET\s+@(\w+)\s*=\s*\(\s*SELECT\s+COUNT\(\*\)\s+FROM\s+INFORMATION_SCHEMA\.COLUMNS` +
    String.raw`[\s\S]*?\)\s*;[\s\S]{0,200}?SET\s+@sql\s*=\s*IF\(\s*@\1\s*=\s*0\s*,\s*'\s*ALTER\s+TABLE\s+` +
    String.raw`` + "`?(\\w+)`?",
  "gi",
);

const manifest = readManifest();

// Tables the migration runner creates itself, in TypeScript, before the manifest starts.
// They exist by the time any migration runs, so guards against them are safe even though no
// migration file creates them.
const CREATED_BY_RUNNER = new Set(["schema_migrations"]);

// A table can also be created by a .sql file that exists on disk but is absent from the
// manifest — which means it never runs. That is worth saying explicitly, because "the guard
// is unsafe" and "the table has no home at all" are different problems with different fixes.
function orphanNote(table) {
  const outside = [];
  for (const path of globSqlOutsideManifest()) {
    if (new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\`?${table}\`?`, "i").test(readFileSync(path, "utf8"))) {
      outside.push(path.slice(SQL_DIR.length + 1).replace(/\\/g, "/"));
    }
  }
  return outside.length
    ? `created only by ${outside.join(", ")}, which is NOT in the manifest and never runs`
    : "never created anywhere in sql/ — the table has no definition at all";
}

let sqlFileCache = null;
function globSqlOutsideManifest() {
  if (sqlFileCache) return sqlFileCache;
  const inManifest = new Set(manifest);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".sql") && !(dir === SQL_DIR && inManifest.has(entry.name))) out.push(full);
    }
  };
  walk(SQL_DIR);
  sqlFileCache = out;
  return out;
}

const createdAt = new Map(); // table -> [fileIndex, offset] of first CREATE
for (const t of CREATED_BY_RUNNER) createdAt.set(t, [-1, -1]);
const findings = [];
let scanned = 0;
let totalGuards = 0;

manifest.forEach((file, fileIndex) => {
  const path = join(SQL_DIR, file);
  if (!existsSync(path)) return; // missing files are the migration runner's problem, not ours
  scanned++;
  const sql = readFileSync(path, "utf8");

  // Record creations first, then evaluate guards against creation points. Within one file
  // a guard placed above the CREATE is still unsafe, so offsets are compared, not just files.
  for (const m of sql.matchAll(CREATE_RE)) {
    const table = m[1].toLowerCase();
    if (!createdAt.has(table)) createdAt.set(table, [fileIndex, m.index]);
  }

  // The three later-discovered syntaxes. Each captures the table name in group 1.
  for (const { name, re } of EXTRA_GUARD_FORMS) {
    for (const m of sql.matchAll(re)) {
      totalGuards++;
      const table = m[1].toLowerCase();
      const created = createdAt.get(table);
      const point = [fileIndex, m.index];
      if (created && (created[0] < point[0] || (created[0] === point[0] && created[1] < point[1]))) continue;
      findings.push({
        file,
        order: fileIndex + 1,
        line: sql.slice(0, m.index).split("\n").length,
        table,
        reason:
          `${name}: ` +
          (created
            ? `created later, in ${manifest[created[0]]} (manifest #${created[0] + 1})`
            : orphanNote(table)),
      });
    }
  }

  for (const m of sql.matchAll(GUARD_RE)) {
    totalGuards++;
    const table = m[2].toLowerCase();
    const created = createdAt.get(table);
    const guardPoint = [fileIndex, m.index];
    const safe =
      created && (created[0] < guardPoint[0] || (created[0] === guardPoint[0] && created[1] < guardPoint[1]));
    if (safe) continue;

    const line = sql.slice(0, m.index).split("\n").length;
    findings.push({
      file,
      order: fileIndex + 1,
      line,
      table,
      reason: created
        ? `created later, in ${manifest[created[0]]} (manifest #${created[0] + 1})`
        : orphanNote(table),
    });
  }
});

console.log(`Scanned ${scanned} of ${manifest.length} manifest migrations.`);
console.log(`Column-absent guards found: ${totalGuards}`);
console.log(`Unsafe on a fresh database: ${findings.length}\n`);

if (findings.length) {
  const width = Math.max(...findings.map((f) => f.file.length));
  for (const f of findings) {
    console.log(
      `  #${String(f.order).padStart(3)} ${f.file.padEnd(width)}:${String(f.line).padEnd(5)} ` +
        `ALTER ${f.table} — ${f.reason}`,
    );
  }
  console.log(
    `\nEach of these stops the migration chain on a fresh database. Guard them on the table\n` +
      `existing as well as the column, e.g.\n` +
      `  SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES\n` +
      `               WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='<table>');\n` +
      `  SET @sql = IF(@tbl>0 AND @col=0, 'ALTER TABLE ...', 'SELECT ''skip'' AS n');\n`,
  );
}

process.exit(findings.length ? 1 : 0);
