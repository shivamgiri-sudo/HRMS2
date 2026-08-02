/**
 * Finds CREATE TABLE statements whose collation will not match the rest of the schema.
 *
 * There are three ways to write the table footer in this repository and they do NOT all
 * produce the same collation on MySQL 8.0:
 *
 *   1. ) ENGINE=InnoDB;
 *      No charset given, so the table inherits the DATABASE default. The migration runner
 *      creates mas_hrms as utf8mb4_unicode_ci, so this is correct.
 *
 *   2. ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
 *      Explicit and correct.
 *
 *   3. ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *      The trap. Naming a charset overrides the database default with the CHARSET's own
 *      default collation — utf8mb4_0900_ai_ci on MySQL 8.0, not utf8mb4_unicode_ci. It
 *      reads like a harmless clarification and silently opts the table out.
 *
 * Form 3 is invisible until a foreign key crosses between a form-3 table and a form-1 or
 * form-2 one, at which point InnoDB refuses it:
 *
 *   Referencing column 'branch_id' and referenced column 'id' in foreign key constraint
 *   'biometric_device_master_ibfk_1' are incompatible
 *
 * which names neither collation. 55 declarations across 20 files were in form 3 when this
 * was written, and the migration chain died on the first one it reached, at manifest #69.
 *
 * Note this cannot be fixed by a server setting. collation_server changes what form 1
 * inherits; it does not change a charset's own default collation, which is what form 3 uses.
 * The only fix is to say COLLATE explicitly, or not to name the charset at all.
 *
 * Run:  node scripts/audit-migration-collations.mjs
 * Exit: 0 clean, 1 if any form-3 declaration is found.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "sql");
const REQUIRED = "utf8mb4_unicode_ci";

// CHARSET named with no COLLATE following it.
const BARE_CHARSET = /DEFAULT\s+CHARSET\s*=\s*(\w+)(?!\s+COLLATE)(?![\w])/gi;

// Table-level COLLATE only — the `COLLATE=` form used in a table or column definition.
//
// Deliberately does NOT match the expression form, `COLLATE utf8mb4_x` without an equals
// sign, which appears in comparisons and INSERT ... SELECT casts. Those coerce a value for
// one operation and cannot cause the foreign-key rejection this audit exists to prevent;
// 208_leave_2026_ml_el_accrual_seed.sql uses three of them to bridge a mismatch that
// migration 1038 later fixed properly. Flagging them would be noise, and an audit that
// reports things nobody should act on gets ignored.
const WRONG_COLLATE = /COLLATE\s*=\s*(utf8mb4_\w+)/gi;

/** Strip `--` line comments and block comments so a rollback note is not read as DDL. */
function stripComments(sql) {
  // Replaced with spaces rather than removed, so reported line numbers stay correct.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

const findings = [];
let scanned = 0;

for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"))) {
  const sql = stripComments(readFileSync(join(SQL_DIR, file), "utf8"));
  scanned++;

  for (const m of sql.matchAll(BARE_CHARSET)) {
    findings.push({
      file,
      line: sql.slice(0, m.index).split("\n").length,
      problem: `DEFAULT CHARSET=${m[1]} with no COLLATE — resolves to that charset's default, not the database's`,
    });
  }

  for (const m of sql.matchAll(WRONG_COLLATE)) {
    if (m[1].toLowerCase() === REQUIRED) continue;
    findings.push({
      file,
      line: sql.slice(0, m.index).split("\n").length,
      problem: `COLLATE=${m[1]} — the database is ${REQUIRED}, so foreign keys across this table will be rejected`,
    });
  }
}

console.log(`Scanned ${scanned} migration files.`);
console.log(`Declarations that will not match the database collation: ${findings.length}\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  ${f.problem}`);
}
if (findings.length) {
  console.log(
    `\nFix by naming the collation explicitly:\n` +
      `  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${REQUIRED};\n` +
      `or by omitting the charset entirely so the table inherits the database default.\n`,
  );
}

process.exit(findings.length ? 1 : 0);
