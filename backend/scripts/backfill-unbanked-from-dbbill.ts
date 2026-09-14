/**
 * Recover bank details for HRMS-active employees who have none, from db_bill.
 *
 * WHY
 *   248 active employees have no bank account in either `employees.bank_account_number` or
 *   `employee_bank_detail`, so they cannot be paid. Investigated 2026-08-17: 221 of them have a
 *   COMPLETE record (account number + valid IFSC + bank name) in `db_bill.masjclrentry`, the
 *   joining-clearance table. Not in `employee_master`, whose codes stop at 36031 while these
 *   employees are 57701-63150 — which is why an earlier search concluded, wrongly, that the data
 *   did not exist. The lesson is in the query below: sweep every table that carries the column,
 *   do not reason from a hand-picked few.
 *
 * SAFETY
 *   - DRY RUN unless --apply. The dry run touches nothing and prints exactly what would change.
 *   - Refuses to --apply under the all-zeros dev encryption key. Writing dev-key ciphertext into
 *     the shared database produces rows production can never decrypt, and nothing looks broken
 *     at the time. Run this on the server, with the real key.
 *   - Never writes a CORRECTED IFSC unless --allow-corrections is also passed. Three employees
 *     have a malformed IFSC whose intended value is inferable; a wrong IFSC routes salary to the
 *     wrong bank, so inference alone is not sufficient authority.
 *   - Skips anyone who already has a bank row, so re-running cannot clobber better data.
 *   - Refuses any employee whose account number disagrees between masjclrentry and salary_data.
 *     Verified zero conflicts on 2026-08-17, but that was measured, not assumed.
 *   - Writes verified = 0. An imported account has been verified by nobody; penny-drop is a
 *     separate act.
 *
 * USAGE
 *   cd /var/www/HRMS2/backend
 *   ./node_modules/.bin/tsx scripts/backfill-unbanked-from-dbbill.ts            # dry run
 *   ./node_modules/.bin/tsx scripts/backfill-unbanked-from-dbbill.ts --apply
 *   ./node_modules/.bin/tsx scripts/backfill-unbanked-from-dbbill.ts --apply --allow-corrections
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getBillPool, closeBillPool } from "../src/db/billDb.js";
import { encryptAccountForSync } from "../src/shared/syncPiiEncryption.js";
import { blindIndex, isUsingDevBlindIndexKey, isUsingDevEncryptionKey } from "../src/shared/fieldEncryption.js";

const APPLY = process.argv.includes("--apply");
const ALLOW_CORRECTIONS = process.argv.includes("--allow-corrections");

/** RBI IFSC: 4 letters, a literal zero, then 6 alphanumerics. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * IFSCs that are malformed in db_bill but whose intended value is recoverable.
 *
 * Each is listed explicitly rather than derived by a rule, because a rule that rewrites IFSCs is
 * a rule that can silently mis-route salary. `attestedBy` is the number of OTHER masjclrentry
 * records already using the corrected value — independent corroboration, counted on 2026-08-17.
 */
const IFSC_CORRECTIONS: Record<string, { from: string; to: string; bank: string; attestedBy: number; note: string }> = {
  MAS63220: { from: "INB0000005",  to: "INDB0000005", bank: "INDUSLAND BANK", attestedBy: 265, note: "IndusInd is INDB; missing D" },
  "63149C": { from: "BKI00002036", to: "BKID0002036", bank: "BANK OF INDIA",  attestedBy: 3,   note: "Bank of India is BKID; missing D" },
  MAS63127: { from: "BARBOLOHIYA", to: "BARB0LOHIYA", bank: "BANK OF BARODA", attestedBy: 0,   note: "letter O typed for zero — NOT independently attested, verify against passbook" },
};

type Verdict = "DIRECT" | "CORRECTION" | "COLLECT" | "NOT_REAL" | "SKIP_HAS_BANK" | "CONFLICT";

interface Candidate {
  employeeId: string;
  code: string;
  name: string;
  branch: string;
  accountNumber: string;
  ifsc: string;
  bank: string;
  verdict: Verdict;
  reason: string;
}

/** Demo/seed rows sitting in the active headcount — they are not people and need no bank. */
const isSeedAccount = (code: string) => /^EMP-[A-Z]+-\d+$/.test(code);

async function main() {
  if (APPLY && isUsingDevEncryptionKey()) {
    console.error(
      "REFUSING to --apply: FIELD_ENCRYPTION_KEY is the all-zeros dev key.\n" +
      "Ciphertext written now could never be decrypted in production. Run this on the server."
    );
    process.exitCode = 1;
    return;
  }
  // This script writes account_number_blind_index directly (below), but only checked the
  // encryption key, not this one. bank-account-blind-index-backfill.ts guards on both — an
  // encryption key set correctly with the blind-index key still on its dev fallback would
  // silently write dev-key indexes for real rows with no error, exactly the failure mode that
  // guard exists to prevent (a lookup built with the wrong key returns nothing, so the
  // duplicate check it feeds would pass everything and never actually detect a collision).
  if (APPLY && isUsingDevBlindIndexKey()) {
    console.error(
      "REFUSING to --apply: FIELD_BLIND_INDEX_KEY is the all-zeros dev key.\n" +
      "A blind index written now would never match a real lookup in production. Run this on the server."
    );
    process.exitCode = 1;
    return;
  }

  // ── 1. Who has no bank details at all ──────────────────────────────────────
  const [unbanked] = await db.execute<RowDataPacket[]>(
    `SELECT em.id AS employee_id, em.employee_code, em.full_name,
            COALESCE(bm.branch_name, '(no branch)') AS branch
       FROM employees em
       LEFT JOIN branch_master bm ON bm.id = em.branch_id
      WHERE em.active_status = 1
        AND (em.bank_account_number IS NULL OR TRIM(em.bank_account_number) = '')
        AND NOT EXISTS (
          SELECT 1 FROM employee_bank_detail bd
           WHERE bd.employee_id = em.id
             AND bd.account_number IS NOT NULL
        )
      ORDER BY em.employee_code`,
  );

  const codes = unbanked.map((r) => String(r.employee_code));
  if (codes.length === 0) {
    console.log("No unbanked active employees. Nothing to do.");
    return;
  }

  // ── 2. Their bank details from db_bill ─────────────────────────────────────
  const bill = await getBillPool();
  const ph = codes.map(() => "?").join(",");

  const [jclr] = await bill.query<RowDataPacket[]>(
    `SELECT TRIM(EmpCode) AS code, TRIM(COALESCE(AcNo,'')) AS ac,
            UPPER(TRIM(COALESCE(IFSCCode,''))) AS ifsc, TRIM(COALESCE(AcBank,'')) AS bank
       FROM masjclrentry WHERE TRIM(EmpCode) IN (${ph})`,
    codes,
  );
  const fromJclr = new Map(jclr.map((r) => [String(r.code), r]));

  // Independent corroboration of the account number.
  const [sal] = await bill.query<RowDataPacket[]>(
    `SELECT TRIM(EmpCode) AS code, MAX(TRIM(COALESCE(AcNo,''))) AS ac
       FROM salary_data WHERE TRIM(EmpCode) IN (${ph}) GROUP BY TRIM(EmpCode)`,
    codes,
  );
  const fromSalary = new Map(sal.map((r) => [String(r.code), String(r.ac ?? "")]));

  // ── 3. Classify ────────────────────────────────────────────────────────────
  const candidates: Candidate[] = [];
  for (const row of unbanked) {
    const code = String(row.employee_code);
    const base = {
      employeeId: String(row.employee_id),
      code,
      name: String(row.full_name ?? ""),
      branch: String(row.branch),
    };

    if (isSeedAccount(code)) {
      candidates.push({ ...base, accountNumber: "", ifsc: "", bank: "", verdict: "NOT_REAL",
        reason: "demo/seed account in the active headcount — not a person" });
      continue;
    }

    const src = fromJclr.get(code);
    const ac = String(src?.ac ?? "").trim();
    if (!ac) {
      candidates.push({ ...base, accountNumber: "", ifsc: "", bank: "", verdict: "COLLECT",
        reason: src ? "masjclrentry row exists but holds no account number" : "absent from every bank-bearing db_bill table" });
      continue;
    }

    const salAc = fromSalary.get(code);
    if (salAc && salAc !== ac) {
      candidates.push({ ...base, accountNumber: ac, ifsc: "", bank: String(src?.bank ?? ""), verdict: "CONFLICT",
        reason: `account number differs between masjclrentry and salary_data — adjudicate, do not guess` });
      continue;
    }

    const rawIfsc = String(src?.ifsc ?? "").trim().toUpperCase();
    if (IFSC_RE.test(rawIfsc)) {
      candidates.push({ ...base, accountNumber: ac, ifsc: rawIfsc, bank: String(src?.bank ?? ""), verdict: "DIRECT", reason: "" });
      continue;
    }

    const fix = IFSC_CORRECTIONS[code];
    if (fix && fix.from === rawIfsc && IFSC_RE.test(fix.to)) {
      candidates.push({ ...base, accountNumber: ac, ifsc: fix.to, bank: String(src?.bank ?? ""), verdict: "CORRECTION",
        reason: `${fix.from} -> ${fix.to} (${fix.note}; attested by ${fix.attestedBy} other record(s))` });
      continue;
    }

    candidates.push({ ...base, accountNumber: ac, ifsc: "", bank: String(src?.bank ?? ""), verdict: "COLLECT",
      reason: `account number present but IFSC is "${rawIfsc}" — not an IFSC` });
  }

  // ── 4. Report ──────────────────────────────────────────────────────────────
  const by = (v: Verdict) => candidates.filter((c) => c.verdict === v);
  const mask = (a: string) => (a.length > 4 ? "***" + a.slice(-4) : a);

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — unbanked active employees: ${candidates.length}\n`);
  console.log(`  DIRECT      (account + valid IFSC)      : ${by("DIRECT").length}`);
  console.log(`  CORRECTION  (IFSC repaired, needs flag) : ${by("CORRECTION").length}`);
  console.log(`  COLLECT     (HR must obtain)            : ${by("COLLECT").length}`);
  console.log(`  NOT_REAL    (demo/seed accounts)        : ${by("NOT_REAL").length}`);
  console.log(`  CONFLICT    (sources disagree)          : ${by("CONFLICT").length}`);

  if (by("CORRECTION").length) {
    console.log(`\n  ── IFSC corrections ${ALLOW_CORRECTIONS ? "(WILL be applied)" : "(withheld — pass --allow-corrections)"} ──`);
    for (const c of by("CORRECTION")) console.log(`    ${c.code.padEnd(10)} ${c.reason}`);
  }
  if (by("CONFLICT").length) {
    console.log(`\n  ── CONFLICTS (never auto-resolved) ──`);
    for (const c of by("CONFLICT")) console.log(`    ${c.code.padEnd(10)} ${c.reason}`);
  }
  console.log(`\n  ── HR must collect (${by("COLLECT").length}) ──`);
  for (const c of by("COLLECT")) console.log(`    ${c.code.padEnd(10)} ${c.name.slice(0, 24).padEnd(25)} ${c.branch.padEnd(22)} ${c.reason}`);
  console.log(`\n  ── Not real employees (${by("NOT_REAL").length}) — review whether these belong in active headcount ──`);
  for (const c of by("NOT_REAL")) console.log(`    ${c.code.padEnd(12)} ${c.name}`);

  const writable = [...by("DIRECT"), ...(ALLOW_CORRECTIONS ? by("CORRECTION") : [])];
  console.log(`\n  ── Would write ${writable.length} bank record(s) ──`);
  for (const c of writable.slice(0, 15)) {
    console.log(`    ${c.code.padEnd(10)} ac=${mask(c.accountNumber).padEnd(9)} ifsc=${c.ifsc.padEnd(12)} ${c.bank.slice(0, 24)}`);
  }
  if (writable.length > 15) console.log(`    ... and ${writable.length - 15} more`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply${by("CORRECTION").length ? " --allow-corrections" : ""} on the server to write.`);
    return;
  }

  // ── 5. Apply ───────────────────────────────────────────────────────────────
  let written = 0;
  let failed = 0;
  for (const c of writable) {
    try {
      const enc = encryptAccountForSync(c.accountNumber, "unbanked-backfill");
      if (!enc) throw new Error("account ciphertext unavailable — refusing to write plaintext only");
      await db.execute(
        `INSERT INTO employee_bank_detail
           (id, employee_id, account_number, account_number_enc, account_number_blind_index,
            bank_name, ifsc_code, account_holder_name, is_primary, verified, active_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, NOW())`,
        [
          randomUUID(),
          c.employeeId,
          Buffer.from(c.accountNumber, "utf8"),
          enc,
          blindIndex(c.accountNumber),
          c.bank || null,
          c.ifsc,
          c.name || null,
        ],
      );
      written++;
    } catch (err: unknown) {
      failed++;
      console.error(`  FAILED ${c.code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nAPPLIED — ${written} written, ${failed} failed. All rows carry verified = 0; penny-drop is still required.`);
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  // Both pools, or the process hangs after printing a complete report and dies to a timeout —
  // which on a WRITE script is genuinely dangerous, because the operator cannot tell "finished"
  // from "still writing".
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
