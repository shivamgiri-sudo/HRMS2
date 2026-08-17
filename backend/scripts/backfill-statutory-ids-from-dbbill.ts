/**
 * Recover UAN and ESIC IP numbers for HRMS-active employees who have none, from db_bill.
 *
 * WHY
 *   Measured live 2026-08-17 against 1,327 active employees:
 *
 *     UAN  (12 digits)   467 present   860 absent   0 malformed
 *     ESIC (10 digits)   382 present   933 absent  12 malformed
 *
 *   db_bill carries a further 244 valid UANs and 200 valid ESIC numbers for those same people.
 *   Applying this brings coverage to 711 UAN and 582 ESIC — which is exactly where earlier
 *   reporting already claimed HRMS stood. It never did: those were the post-backfill figures,
 *   and the backfill had not been run.
 *
 *   Every db_bill table carrying a UAN or ESICNo column was swept, not a hand-picked few — the
 *   lesson from the unbanked-248 recovery, where reasoning from `employee_master` alone concluded
 *   wrongly that the data did not exist. 22 tables carry one of those columns; two hold recoverable
 *   values for active employees (masjclrentry, and his_masjsclrentry which adds 2 UAN and 2 ESIC
 *   the first would have missed). `employee_master` contributes nothing — it is stale, its codes
 *   stopping well below this population.
 *
 * WHAT THIS DOES NOT DECIDE
 *   Applicability. This fills in an identifier where one demonstrably exists; it does not assert
 *   that PF or ESIC applies to anyone, and it must not be read as doing so. ESIC coverage is
 *   wage-linked and PF has its own rules, so an employee legitimately outside coverage has no
 *   number and needs none. After this runs, 616 actives still have no UAN and 745 no ESIC — how
 *   many of those are real gaps is an applicability question (see pf-applicability.service.ts for
 *   PF; ESIC has no equivalent resolver yet), NOT a data-recovery one. Do not convert the residue
 *   into a "missing" count without it.
 *
 * SAFETY
 *   - DRY RUN unless --apply. The dry run touches nothing and prints exactly what would change.
 *   - Only ever fills a BLANK or malformed value. An employee who already has a well-formed
 *     identifier is skipped, so re-running cannot clobber a value HR curated by hand.
 *   - Refuses any employee whose donors disagree. Verified zero conflicts on 2026-08-17 across
 *     both donor tables, but that was measured, not assumed, and it is re-measured on every run.
 *   - Never repairs a malformed identifier. A UAN or ESIC number is a government member ID; a
 *     "corrected" one silently files a contribution against the wrong person's account. The 12
 *     malformed ESIC values (lengths 1, 7, 8 and 14) are reported for HR to collect, not guessed.
 *   - Writes nothing else. No status, no applicability flag, no contribution row.
 *
 * USAGE
 *   cd /var/www/HRMS2/backend
 *   ./node_modules/.bin/tsx scripts/backfill-statutory-ids-from-dbbill.ts            # dry run
 *   ./node_modules/.bin/tsx scripts/backfill-statutory-ids-from-dbbill.ts --apply
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getBillPool, closeBillPool } from "../src/db/billDb.js";

const APPLY = process.argv.includes("--apply");

/** EPFO Universal Account Number: exactly 12 digits. */
const UAN_RE = /^[0-9]{12}$/;
/** ESIC Insured Person number: exactly 10 digits. */
const ESIC_RE = /^[0-9]{10}$/;

/**
 * Donor tables, in preference order.
 *
 * Discovered by querying information_schema for every table carrying a UAN or ESICNo column
 * rather than by listing the ones that seemed likely. Order matters only for reporting which
 * donor supplied a value; a disagreement between donors is refused, never resolved by rank.
 */
const DONORS = ["masjclrentry", "his_masjsclrentry"] as const;

type Field = "uan" | "esic";
type Verdict = "FILL" | "ALREADY_SET" | "CONFLICT" | "MALFORMED_IN_HRMS" | "NOT_IN_DB_BILL";

interface Candidate {
  employeeId: string;
  code: string;
  name: string;
  field: Field;
  current: string;
  incoming: string;
  donor: string;
  verdict: Verdict;
  reason: string;
}

const mask = (v: string) => (v.length <= 4 ? "*".repeat(v.length) : "*".repeat(v.length - 4) + v.slice(-4));

async function main(): Promise<void> {
  // ── 1. HRMS-active population ──────────────────────────────────────────────
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name,
            COALESCE(uan_number, '')  AS uan,
            COALESCE(esic_number, '') AS esic
       FROM employees
      WHERE active_status = 1 AND employee_code IS NOT NULL AND TRIM(employee_code) <> ''`,
  );
  const actives = new Map<string, { id: string; name: string; uan: string; esic: string }>();
  for (const r of empRows as Array<Record<string, unknown>>) {
    actives.set(String(r.employee_code).trim().toUpperCase(), {
      id: String(r.id),
      name: String(r.full_name ?? ""),
      uan: String(r.uan ?? "").trim(),
      esic: String(r.esic ?? "").trim(),
    });
  }

  const needs = (field: Field, cur: string) => !(field === "uan" ? UAN_RE : ESIC_RE).test(cur);

  // ── 2. Collect every donor value, keyed by (code, field) ───────────────────
  const offered = new Map<string, Map<string, Set<string>>>(); // code -> field -> values
  const donorOf = new Map<string, string>();                   // code|field -> donor table
  const bill = await getBillPool();

  for (const table of DONORS) {
    const [rows] = await bill.query<RowDataPacket[]>(
      `SELECT UPPER(TRIM(EmpCode)) AS code, TRIM(UAN) AS uan, TRIM(ESICNo) AS esic
         FROM \`${table}\`
        WHERE EmpCode IS NOT NULL AND TRIM(EmpCode) <> ''`,
    );
    for (const r of rows as Array<Record<string, unknown>>) {
      const code = String(r.code ?? "");
      const emp = actives.get(code);
      if (!emp) continue;

      for (const field of ["uan", "esic"] as Field[]) {
        const raw = String(r[field] ?? "").trim();
        const re = field === "uan" ? UAN_RE : ESIC_RE;
        if (!re.test(raw)) continue;              // junk in the donor is simply not a candidate
        if (!needs(field, emp[field])) continue;  // HRMS already holds a good value
        if (!offered.has(code)) offered.set(code, new Map());
        const byField = offered.get(code)!;
        if (!byField.has(field)) byField.set(field, new Set());
        byField.get(field)!.add(raw);
        if (!donorOf.has(`${code}|${field}`)) donorOf.set(`${code}|${field}`, table);
      }
    }
  }

  // ── 3. Adjudicate ──────────────────────────────────────────────────────────
  const candidates: Candidate[] = [];
  for (const [code, emp] of actives) {
    for (const field of ["uan", "esic"] as Field[]) {
      const current = emp[field];
      const base = { employeeId: emp.id, code, name: emp.name, field, current };

      if (!needs(field, current)) {
        candidates.push({ ...base, incoming: "", donor: "", verdict: "ALREADY_SET", reason: "HRMS already holds a well-formed value" });
        continue;
      }
      const values = offered.get(code)?.get(field);
      if (!values || values.size === 0) {
        candidates.push({
          ...base, incoming: "", donor: "",
          // A non-empty current value that failed the format test is a distinct problem from a
          // blank one: something IS recorded and it is wrong, which HR must reconcile rather than
          // simply collect.
          verdict: current ? "MALFORMED_IN_HRMS" : "NOT_IN_DB_BILL",
          reason: current ? `recorded as "${current}" (${current.length} chars) — not a valid ${field.toUpperCase()}` : "no valid value in any donor",
        });
        continue;
      }
      if (values.size > 1) {
        candidates.push({ ...base, incoming: "", donor: "", verdict: "CONFLICT", reason: `donors disagree: ${[...values].join(" vs ")}` });
        continue;
      }
      candidates.push({
        ...base,
        incoming: [...values][0],
        donor: donorOf.get(`${code}|${field}`) ?? "",
        verdict: "FILL",
        reason: `recovered from ${donorOf.get(`${code}|${field}`)}`,
      });
    }
  }

  // ── 4. Report ──────────────────────────────────────────────────────────────
  const pick = (f: Field, v: Verdict) => candidates.filter((c) => c.field === f && c.verdict === v);
  console.log(`\nStatutory identifier recovery — ${actives.size} active employees\n`);

  for (const field of ["uan", "esic"] as Field[]) {
    const label = field.toUpperCase();
    const set = pick(field, "ALREADY_SET").length;
    const fill = pick(field, "FILL");
    const conflict = pick(field, "CONFLICT");
    const malformed = pick(field, "MALFORMED_IN_HRMS");
    const absent = pick(field, "NOT_IN_DB_BILL");
    console.log(`  ── ${label} ──`);
    console.log(`     already set        : ${set}`);
    console.log(`     recoverable        : ${fill.length}   -> coverage ${set} becomes ${set + fill.length}`);
    console.log(`     donors disagree    : ${conflict.length}`);
    console.log(`     malformed in HRMS  : ${malformed.length}   (HR must reconcile — never auto-repaired)`);
    console.log(`     no donor value     : ${absent.length}   (applicability unknown — NOT necessarily a gap)`);
    for (const c of malformed) console.log(`        ${c.code.padEnd(10)} ${c.reason}`);
    for (const c of conflict) console.log(`        ${c.code.padEnd(10)} ${c.reason}`);
    for (const c of fill.slice(0, 10)) console.log(`        ${c.code.padEnd(10)} ${mask(c.incoming)} from ${c.donor}`);
    if (fill.length > 10) console.log(`        ... and ${fill.length - 10} more`);
    console.log("");
  }

  const writable = candidates.filter((c) => c.verdict === "FILL");
  console.log(`  ── Would write ${writable.length} identifier(s) across ${new Set(writable.map((c) => c.code)).size} employee(s) ──`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply on the server to write.`);
    return;
  }

  // ── 5. Apply ───────────────────────────────────────────────────────────────
  let written = 0;
  let failed = 0;
  for (const c of writable) {
    try {
      const column = c.field === "uan" ? "uan_number" : "esic_number";
      // Re-assert the blank/malformed precondition in the UPDATE itself. Between the read above
      // and this write, HR may have entered the real value by hand; that value is better than
      // this one and must win.
      const [res] = await db.execute<import("mysql2").ResultSetHeader>(
        `UPDATE employees
            SET ${column} = ?
          WHERE id = ?
            AND (${column} IS NULL OR ${column} NOT REGEXP ?)`,
        [c.incoming, c.employeeId, c.field === "uan" ? "^[0-9]{12}$" : "^[0-9]{10}$"],
      );
      if (res.affectedRows === 1) written++;
      else console.log(`  SKIPPED ${c.code} ${c.field} — a valid value appeared since the read`);
    } catch (err: unknown) {
      failed++;
      console.error(`  FAILED ${c.code} ${c.field}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nAPPLIED — ${written} written, ${failed} failed.`);
  console.log(`This filled identifiers only. It asserted nothing about whether PF or ESIC applies to anyone.`);
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  // Both pools, or the process hangs after printing a complete report and dies to a timeout —
  // which on a WRITE script is genuinely dangerous, because the operator cannot tell "finished"
  // from "still writing".
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
