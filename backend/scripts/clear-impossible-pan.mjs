#!/usr/bin/env node
/**
 * Clear pan_number where the stored value cannot be a PAN under any correction.
 *
 * A placeholder in this column is worse than a NULL. NULL reads as "still to collect";
 * '0' reads as collected, satisfies every presence check, and reaches Form 16 and the
 * TDS return. Four active employees currently share the single character '0' as their
 * PAN — four different people, two branches, 60-65 payroll lines each — and that is also
 * the only duplicate-PAN group left in the database.
 *
 * NARROW BY DESIGN. Of the 16 invalid PANs, most are near-miss typos that still encode
 * the real thing — 'AAAA9999A' is a PAN missing its leading letter, 'AAAAA9999' one
 * missing its trailing letter. Those characters are evidence; guessing at them would be
 * inventing a taxpayer identity, and blanking them would destroy the only record of what
 * HR needs to correct. They are left alone and reported.
 *
 * Only three shapes are cleared, each impossible rather than merely wrong:
 *
 *   length <= 2       a placeholder, carrying no information ('0')
 *   contains a space  a PAN has no spaces — these are names typed into the field
 *   no letters at all a PAN is 5 letters, 4 digits, 1 letter; an all-digit value is a
 *                     mobile or Aadhaar in the wrong column, which is also PII sitting
 *                     somewhere it is not expected to be
 *
 * Dry run unless --apply. Values are shown as shapes, never printed.
 *
 *   node scripts/clear-impossible-pan.mjs           # report
 *   node scripts/clear-impossible-pan.mjs --apply   # clear
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");

function env(key) {
  const raw = fs.readFileSync(path.join(BACKEND, ".env"), "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

async function connect(hosts) {
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({
        host, port: 3306, database: "mas_hrms",
        user: env("DB_USER") ?? "shivam_user", password: env("DB_PASSWORD"),
        connectTimeout: 12_000,
      });
      console.log(`  mas_hrms: ${host}`);
      return c;
    } catch (e) {
      console.log(`  ${host} unavailable (${e.code ?? e.message})`);
    }
  }
  throw new Error("no route to mas_hrms");
}

const shape = (v) => String(v).replace(/[A-Za-z]/g, "A").replace(/[0-9]/g, "9");

console.log(APPLY ? "MODE: APPLY (will clear)" : "MODE: dry run (no writes)");
const db = await connect([env("DB_HOST"), "192.168.10.6", "122.184.128.90"].filter(Boolean));

// Impossible, not merely invalid — see the header.
const IMPOSSIBLE = `
  active_status = 1
  AND pan_number IS NOT NULL AND TRIM(pan_number) <> ''
  AND UPPER(TRIM(pan_number)) NOT REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'
  AND (
        CHAR_LENGTH(TRIM(pan_number)) <= 2
     OR TRIM(pan_number) LIKE '% %'
     OR UPPER(TRIM(pan_number)) NOT REGEXP '[A-Z]'
  )`;

const [targets] = await db.query(
  `SELECT id, employee_code, full_name, pan_number FROM employees WHERE ${IMPOSSIBLE}`,
);

console.log(`\nimpossible PAN values found: ${targets.length}`);
for (const t of targets) {
  const v = String(t.pan_number).trim();
  const why = v.length <= 2 ? "placeholder" : v.includes(" ") ? "contains a space (a name?)" : "no letters (mobile/Aadhaar?)";
  console.log(`  ${String(t.employee_code).padEnd(11)} ${String(t.full_name).slice(0, 26).padEnd(28)} shape ${shape(v).padEnd(12)} ${why}`);
}

const [leave] = await db.query(
  `SELECT COUNT(*) n FROM employees
    WHERE active_status = 1 AND pan_number IS NOT NULL AND TRIM(pan_number) <> ''
      AND UPPER(TRIM(pan_number)) NOT REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'
      AND NOT (CHAR_LENGTH(TRIM(pan_number)) <= 2 OR TRIM(pan_number) LIKE '% %'
               OR UPPER(TRIM(pan_number)) NOT REGEXP '[A-Z]')`,
);
console.log(`\nnear-miss typos left untouched for HR to correct: ${leave[0].n}`);

if (!APPLY) {
  console.log(`\nDry run — nothing cleared. Re-run with --apply.`);
  await db.end();
  process.exit(0);
}

// Re-asserts the predicate inside the UPDATE, so a value corrected between the read and
// the write is never clobbered, and a second run is a no-op.
const [res] = await db.query(
  `UPDATE employees SET pan_number = NULL, updated_at = NOW() WHERE ${IMPOSSIBLE}`,
);
console.log(`\ncleared: ${res.affectedRows}`);
await db.end();
