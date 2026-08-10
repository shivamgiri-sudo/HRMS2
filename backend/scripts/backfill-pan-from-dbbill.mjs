#!/usr/bin/env node
/**
 * Backfill employees.pan_number from db_bill, for the employees whose PAN is missing or
 * malformed — and only where the match is on an identity key.
 *
 * 222 active employees have no usable PAN, between them carrying 3,254 payroll lines.
 * An unusable PAN is not cosmetic: it drives Form 16 and the TDS return, where it means
 * deduction at the higher rate under s206AA.
 *
 * Only 22 of the 222 are actually recoverable, and the reason the rest are not is worth
 * stating: 122 joined in 2025 or later, and only 2 of the 222 came through the candidate
 * journey at all (the rest were created via manual Add Employee), so their PAN was never
 * collected anywhere. db_bill closes about a tenth of this gap; the rest is a collection
 * task, not a data-recovery one.
 *
 * MATCHING — identity keys only, deliberately:
 *   EmpCode  masjclrentry, his_masjsclrentry
 *   mobile   Interview_master (which carries no employee code)
 *
 * Matching on NAME is not done, though it appears to find 62 rather than 22. Of those
 * 62, **33 map to more than one distinct PAN** — masjclrentry alone returns 287
 * name-matched PANs for 222 people. A name is not an identity key here, and writing
 * another person's PAN onto an employee is materially worse than leaving the field
 * blank: it puts a real taxpayer's identity on someone else's Form 16.
 *
 * Refuses to write when sources disagree, and never overwrites a PAN that is already
 * valid. Dry run unless --apply is passed. PAN values are masked in all output, because
 * this prints to a terminal and scrolls into logs.
 *
 *   node scripts/backfill-pan-from-dbbill.mjs            # report only
 *   node scripts/backfill-pan-from-dbbill.mjs --apply    # write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const norm = (v) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const digits = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);
const mask = (pan) => `${pan.slice(0, 2)}****${pan.slice(-1)}`;
const chunk = (arr, n) => (arr.length ? [arr.slice(0, n), ...chunk(arr.slice(n), n)] : []);

function env(key) {
  const raw = fs.readFileSync(path.join(BACKEND, ".env"), "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

/**
 * Both databases answer on a LAN address or a public one depending on which network the
 * machine is on, and it flips mid-session — twice while this was being written. Try each
 * in turn rather than failing on a timeout that looks like the database being down.
 */
async function connect(label, hosts, database) {
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({
        host, port: 3306, database, user: env("DB_USER") ?? "shivam_user",
        password: env(label === "bill" ? "BILL_DB_PASSWORD" : "DB_PASSWORD") ?? env("DB_PASSWORD"),
        connectTimeout: 12_000,
      });
      console.log(`  ${label}: ${host}`);
      return c;
    } catch (e) {
      console.log(`  ${label}: ${host} unavailable (${e.code ?? e.message})`);
    }
  }
  throw new Error(`no route to ${label}`);
}

console.log(APPLY ? "MODE: APPLY (will write)" : "MODE: dry run (no writes)");
const hrms = await connect("mas_hrms", [env("DB_HOST"), "192.168.10.6", "122.184.128.90"].filter(Boolean), "mas_hrms");
const bill = await connect("bill", [env("BILL_DB_HOST"), "192.168.10.22", "14.97.30.236"].filter(Boolean), "db_bill");

const [needy] = await hrms.query(
  `SELECT id, employee_code, full_name, mobile FROM employees
    WHERE active_status = 1
      AND (pan_number IS NULL OR TRIM(pan_number) = ''
           OR UPPER(TRIM(pan_number)) NOT REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$')`,
);
console.log(`\nactive employees without a usable PAN: ${needy.length}`);

const byCode = new Map(needy.map((e) => [norm(e.employee_code), e]));
const byMobile = new Map();
for (const e of needy) {
  const m = digits(e.mobile);
  if (m.length === 10) byMobile.set(m, norm(e.employee_code));
}

/** code -> Map(pan -> Set(source)) */
const candidates = new Map();
const offer = (code, source, pan) => {
  if (!PAN_RE.test(pan) || !byCode.has(code)) return;
  if (!candidates.has(code)) candidates.set(code, new Map());
  const forCode = candidates.get(code);
  if (!forCode.has(pan)) forCode.set(pan, new Set());
  forCode.get(pan).add(source);
};

for (const [table, column] of [["masjclrentry", "PanNo"], ["his_masjsclrentry", "PanNo"]]) {
  for (const part of chunk([...byCode.keys()], 300)) {
    const [rows] = await bill.query(
      `SELECT EmpCode, \`${column}\` AS pan FROM \`${table}\`
        WHERE EmpCode IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rows) offer(norm(r.EmpCode), table, norm(r.pan));
  }
}
for (const part of chunk([...byMobile.keys()], 300)) {
  const marks = part.map(() => "?").join(",");
  const [rows] = await bill.query(
    `SELECT Mobile_No, Mobile_Number, Pan_Number AS pan FROM Interview_master
      WHERE RIGHT(REPLACE(COALESCE(Mobile_No,''),' ',''),10) IN (${marks})
         OR RIGHT(REPLACE(COALESCE(Mobile_Number,''),' ',''),10) IN (${marks})`, [...part, ...part]);
  for (const r of rows) {
    const code = byMobile.get(digits(r.Mobile_No)) ?? byMobile.get(digits(r.Mobile_Number));
    if (code) offer(code, "Interview_master", norm(r.pan));
  }
}
await bill.end();

const agreed = [];
const conflicted = [];
for (const [code, pans] of candidates) {
  if (pans.size === 1) {
    const [pan, sources] = [...pans.entries()][0];
    agreed.push({ code, pan, sources: [...sources].join("+") });
  } else {
    conflicted.push({ code, distinct: pans.size });
  }
}

console.log(`\nrecoverable with sources agreeing : ${agreed.length}`);
console.log(`sources DISAGREE — skipped        : ${conflicted.length}`);
for (const c of conflicted) console.log(`  ! ${c.code}: ${c.distinct} different PANs offered`);

console.log("\nplan:");
for (const a of agreed) {
  const e = byCode.get(a.code);
  console.log(`  ${a.code.padEnd(10)} ${String(e.full_name).slice(0, 26).padEnd(28)} ${mask(a.pan)}  [${a.sources}]`);
}

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --apply to write ${agreed.length} PANs.`);
  await hrms.end();
  process.exit(0);
}

let written = 0;
for (const a of agreed) {
  // Re-assert the precondition inside the write, so a PAN filled in by anyone between
  // the read above and this statement is never overwritten.
  const [res] = await hrms.execute(
    `UPDATE employees SET pan_number = ?, updated_at = NOW()
      WHERE id = ? AND active_status = 1
        AND (pan_number IS NULL OR TRIM(pan_number) = ''
             OR UPPER(TRIM(pan_number)) NOT REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$')`,
    [a.pan, byCode.get(a.code).id],
  );
  if (res.affectedRows === 1) written++;
}
console.log(`\nwritten: ${written} of ${agreed.length}`);
await hrms.end();
