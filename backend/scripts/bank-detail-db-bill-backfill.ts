/**
 * Backfill employee_bank_detail from db_bill's confirmed salary credits.
 *
 * For every ACTIVE employee who has NO active primary bank record in HRMS but DOES have a salary
 * credit in db_bill whose receipt was confirmed (SalaryReceiveStatus = 'YES'), create the primary
 * bank record from the account that credit actually went to.
 *
 * Authorised 2026-08-13 by the payroll owner as a bulk write. It is still dry-run by default —
 * `--apply` is required to write anything.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/bank-detail-db-bill-backfill.ts            # dry run, writes nothing
 *   npx tsx scripts/bank-detail-db-bill-backfill.ts --apply    # writes
 *   npx tsx scripts/bank-detail-db-bill-backfill.ts --apply --limit=10
 *
 * ⚠️ MUST RUN ON THE PRODUCTION HOST
 *   This writes account_number_enc. Off-host, loadKey() silently substitutes the all-zeros
 *   development key, so every row written would be ciphertext production can never decrypt —
 *   and because resolveAccountNumber() falls through a failed decrypt to the legacy column,
 *   which these new rows do not have, the result is not a visible error but ~90 employees who
 *   look banked and resolve to nothing at payment time. That is strictly worse than the MISSING
 *   state being fixed. The script therefore proves it holds the production key by decrypting
 *   ciphertext already stored in this database before it writes anything, and exits otherwise.
 *   Verified working on the production host 2026-08-13: "key parity: 25/25 decrypt".
 *   Same guard, same reason, as scripts/bank-account-encrypt-backfill.ts.
 *
 * WHY ONLY THE CONFIRMED-RECEIPT MONTH
 *   A salary row proves an instruction was issued. SalaryReceiveStatus = 'YES' proves the money
 *   arrived. Only the second is evidence the account belongs to the employee, and this script
 *   creates payment destinations, so it accepts nothing weaker. Measured 2026-08-13: 2026-07-31
 *   carries NULL on all 1,453 rows (receipts not yet stamped) while 2026-06-30 carries 1,227
 *   YES — so the month is resolved by "newest month that HAS confirmed receipts", never MAX().
 *
 * WHAT IT WILL NOT DO
 *   - Touch an employee who already has an active primary record. No overwrite, no "correction".
 *     The 13 employees whose HRMS account disagrees with the credited one are CONFLICTs for a
 *     human to resolve; silently replacing their account with db_bill's is exactly the
 *     unreviewed re-routing of salary this whole module exists to prevent.
 *   - Write a corrupt or implausible account number, or one with no valid IFSC available.
 *   - Write the legacy plaintext column. Only account_number_enc is written, matching both live
 *     write paths; adding new plaintext PII to fix a data gap trades one problem for a worse one.
 *
 * IFSC — AND WHY THE OBVIOUS SOURCE IS THE WRONG ONE
 *   db_bill.salary_data has no IFSC column at all, so it must come from somewhere else.
 *   db_bill.employee_master.IFSCCode is the obvious candidate and is nearly useless here:
 *   measured 2026-08-13, it supplies a valid IFSC for essentially none of the bankless active
 *   employees, because employee_master is dominated by legacy and IDC codes rather than the
 *   current workforce. A first version of this script used it and produced ZERO eligible rows
 *   while looking like it had run correctly.
 *
 *   The source that actually covers them is employees.ifsc_code — the frozen legacy sibling of
 *   employees.bank_account_number. It has no writer in the application either, but it was
 *   populated at migration and holds a valid IFSC for 131 of the 383. employee_master is kept
 *   only as a fallback for the rows it can still answer.
 *
 *   An employee with a confirmed credit but no valid IFSC from either source is REPORTED and
 *   SKIPPED, never written with a blank one: a bank file row without an IFSC is rejected by the
 *   bank, so such a record would convert a visible MISSING into an invisible INVALID.
 *
 * EXPECTED SCALE (dry run ON THE PRODUCTION HOST, 2026-08-13)
 *   383 bankless active employees -> 105 have a confirmed 2026-06-30 credit -> 90 of those also
 *   have a valid IFSC, all 90 from employees.ifsc_code and none from employee_master. 86 of the
 *   90 are independently corroborated, in that employees.bank_account_number holds the same
 *   number the confirmed credit went to; 4 rest on the credit alone. 15 are skipped for having
 *   no valid IFSC from any source, 278 for having no confirmed credit.
 *
 *   So this creates 90 records, not the 155 quoted earlier: that figure counted recoverable
 *   ACCOUNT NUMBERS and silently assumed an IFSC would be available for each.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { checkKeyParity, encryptField } from "../src/shared/fieldEncryption.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const a = process.argv.find((x) => x.startsWith("--limit="));
  return a ? parseInt(a.split("=")[1], 10) : Number.POSITIVE_INFINITY;
})();

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, "");
const mask = (v: string) => (v.length >= 4 ? `XXXX${v.slice(-4)}` : "XXXX");

function isPlausibleAccount(v: string): boolean {
  if (!v) return false;
  if (/[Ee][+-]?\d/.test(v)) return false; // Excel scientific notation — digits are gone
  if (/^0+$/.test(v)) return false;
  return /^[0-9]{6,20}$/.test(v);
}

interface Skip { code: string; reason: string }

async function main(): Promise<void> {
  console.log(`[bank-backfill] mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (writes nothing)"}`);

  // ── 1. Key parity FIRST. Without it every write below is unreadable ciphertext. ──
  const [ctRows] = await db.query<RowDataPacket[]>(
    `SELECT account_number_enc FROM employee_bank_detail
      WHERE account_number_enc IS NOT NULL AND account_number_enc <> '' LIMIT 25`,
  );
  const parity = checkKeyParity(
    (ctRows as Array<{ account_number_enc: string }>).map((r) => r.account_number_enc),
  );
  console.log(`[bank-backfill] key parity: ${parity.decrypted}/${parity.sampled} decrypt`);
  if (!parity.ok) {
    console.error(
      "[bank-backfill] REFUSING TO RUN — the loaded FIELD_ENCRYPTION_KEY cannot read ciphertext " +
      "already stored in this database. Off the production host this is the all-zeros dev key, and " +
      "every row written would be permanently unreadable. Run this on the production host.",
    );
    process.exitCode = 1;
    return;
  }

  // ── 2. Verification month: newest month that actually HAS confirmed receipts ──
  const monthRows = await billQuery<RowDataPacket & { SalDate: string }>(
    `SELECT SalDate FROM salary_data
      WHERE SalaryReceiveStatus = 'YES' AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''
      GROUP BY SalDate ORDER BY SalDate DESC LIMIT 1`,
  );
  const rawMonth = monthRows[0]?.SalDate;
  if (!rawMonth) {
    console.error("[bank-backfill] db_bill has no salary row with a confirmed receipt. Nothing to do.");
    process.exitCode = 1;
    return;
  }
  const month = typeof rawMonth === "string" ? rawMonth : new Date(rawMonth).toISOString().slice(0, 10);
  console.log(`[bank-backfill] verification month: ${month}`);

  // ── 3. Sources ──
  const credits = await billQuery<RowDataPacket & { EmpCode: string; AcNo: string }>(
    `SELECT EmpCode, AcNo FROM salary_data
      WHERE SalDate = ? AND SalaryReceiveStatus = 'YES' AND AcNo IS NOT NULL AND TRIM(AcNo) <> ''`,
    [month],
  );
  const creditMap = new Map<string, string>();
  for (const c of credits) creditMap.set(norm(c.EmpCode).toUpperCase(), norm(c.AcNo));

  const masters = await billQuery<RowDataPacket & {
    EmpCode: string; IFSCCode: string | null; AcBank: string | null;
    AcBranch: string | null; AccHolder: string | null;
  }>(
    `SELECT EmpCode, IFSCCode, AcBank, AcBranch, AccHolder FROM employee_master
      WHERE EmpCode IS NOT NULL AND TRIM(EmpCode) <> ''`,
  );
  const masterMap = new Map(masters.map((m) => [norm(m.EmpCode).toUpperCase(), m]));

  // Active employees with NO active primary bank record. The NOT EXISTS is the whole safety
  // property of this script: an employee who already has a record can never be selected, so
  // there is no code path here that overwrites an existing account.
  const [targets] = await db.query<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
            e.ifsc_code                          AS employees_ifsc,
            e.bank_name                          AS employees_bank,
            CAST(e.bank_account_number AS CHAR)  AS employees_account
       FROM employees e
      WHERE e.active_status = 1
        AND NOT EXISTS (SELECT 1 FROM employee_bank_detail b
                         WHERE b.employee_id = e.id AND b.active_status = 1 AND b.is_primary = 1)
      ORDER BY e.employee_code`,
  );
  console.log(`[bank-backfill] active employees with no primary bank record: ${(targets as unknown[]).length}`);

  // ── 4. Decide, then (optionally) write ──
  const skips: Skip[] = [];
  const planned: Array<{ id: string; code: string; name: string; account: string; ifsc: string;
                         ifscSource: string; corroborated: boolean;
                         bank: string | null; branch: string | null; holder: string | null }> = [];

  for (const t of targets as any[]) {
    const code = norm(t.employee_code).toUpperCase();
    const account = creditMap.get(code);
    if (!account) { skips.push({ code, reason: "no confirmed salary credit in db_bill" }); continue; }
    if (!isPlausibleAccount(account)) {
      skips.push({ code, reason: `credited account is not a usable number (${mask(account)})` });
      continue;
    }
    const m = masterMap.get(code);
    // employees.ifsc_code first — see the IFSC note in the header. employee_master answers for
    // almost none of the current workforce and is a fallback only.
    const employeesIfsc = norm(t.employees_ifsc).toUpperCase();
    const masterIfsc = norm(m?.IFSCCode).toUpperCase();
    const ifsc = IFSC_RE.test(employeesIfsc) ? employeesIfsc : masterIfsc;
    const ifscSource = IFSC_RE.test(employeesIfsc) ? "employees.ifsc_code" : "db_bill.employee_master";
    if (!IFSC_RE.test(ifsc)) {
      skips.push({
        code,
        reason: `no valid IFSC in employees.ifsc_code or db_bill employee_master ('${employeesIfsc || "(empty)"}')`,
      });
      continue;
    }
    // Independent corroboration: does the frozen legacy account column hold the same number the
    // salary actually went to? Not a gate — it is absent for some rows — but it is the difference
    // between one source and two, and the operator should see which they are getting.
    const corroborated = norm(t.employees_account) === account;
    planned.push({
      id: t.id, code, name: String(t.full_name ?? "").trim(), account, ifsc, ifscSource, corroborated,
      bank: m?.AcBank ?? t.employees_bank ?? null,
      branch: m?.AcBranch ?? null,
      holder: m?.AccHolder ?? null,
    });
  }

  console.log(`\n[bank-backfill] eligible to create: ${planned.length}`);
  console.log(`[bank-backfill] skipped:             ${skips.length}`);
  const byReason = new Map<string, number>();
  for (const s of skips) {
    const key = s.reason.replace(/\(.*\)/, "(…)");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }

  const corroboratedCount = planned.filter((p) => p.corroborated).length;
  const fromEmployeesIfsc = planned.filter((p) => p.ifscSource === "employees.ifsc_code").length;
  console.log(`\n[bank-backfill] evidence behind the eligible rows:`);
  console.log(`    ${String(corroboratedCount).padStart(5)}  confirmed credit AND employees.bank_account_number agree (two independent sources)`);
  console.log(`    ${String(planned.length - corroboratedCount).padStart(5)}  confirmed credit only (one source)`);
  console.log(`    ${String(fromEmployeesIfsc).padStart(5)}  IFSC from employees.ifsc_code`);
  console.log(`    ${String(planned.length - fromEmployeesIfsc).padStart(5)}  IFSC from db_bill.employee_master`);

  console.log(`\n[bank-backfill] sample of planned rows (accounts masked):`);
  for (const p of planned.slice(0, 15)) {
    console.log(
      `    ${p.code.padEnd(12)} ${mask(p.account)}  ${p.ifsc.padEnd(12)} ` +
      `${p.corroborated ? "corroborated " : "single-source"}  ${p.bank ?? ""}`,
    );
  }

  if (!APPLY) {
    console.log(
      `\n[bank-backfill] DRY RUN — nothing written. Re-run with --apply to create ${planned.length} record(s).`,
    );
    return;
  }

  let created = 0;
  const failures: Skip[] = [];
  for (const p of planned.slice(0, LIMIT)) {
    try {
      // account_seq has UNIQUE KEY (employee_id, account_seq). These employees have no active
      // primary row, but they may hold ARCHIVED rows from a prior change (is_primary = 0,
      // active_status = 0), so seq 1 can already be taken — take max+1 rather than assuming 1.
      const [seqRows] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(account_seq), 0) + 1 AS next_seq
           FROM employee_bank_detail WHERE employee_id = ?`,
        [p.id],
      );
      const nextSeq = Number((seqRows as any[])[0]?.next_seq ?? 1);

      // verified = 1: this record's account is evidenced by a salary payment that db_bill
      // confirms the employee received, which is stronger evidence than the approval workflow
      // that flag normally represents. The owner authorised this bulk write on that basis.
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO employee_bank_detail
           (id, employee_id, is_primary, account_seq, bank_name, account_holder_name, bank_branch,
            account_number_enc, ifsc_code, account_type, verified, active_status)
         VALUES (UUID(), ?, 1, ?, ?, ?, ?, ?, ?, 'Savings', 1, 1)`,
        [
          p.id, nextSeq, p.bank, p.holder || p.name || null, p.branch,
          encryptField(p.account), p.ifsc,
        ],
      );
      if (result.affectedRows === 1) created++;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      failures.push({ code: p.code, reason: `${e?.code ?? ""} ${e?.message ?? String(err)}`.trim() });
    }
  }

  console.log(`\n[bank-backfill] created: ${created}`);
  if (failures.length) {
    console.log(`[bank-backfill] failed:  ${failures.length}`);
    for (const f of failures.slice(0, 20)) console.log(`    ${f.code.padEnd(12)} ${f.reason}`);
  }

  await logSensitiveAction({
    actor_user_id: "system:bank-detail-db-bill-backfill",
    action_type: "BANK_DETAIL_BULK_BACKFILL",
    module_key: "payroll",
    entity_type: "employee_bank_detail",
    change_summary: {
      source: "db_bill.salary_data confirmed receipts",
      verification_month: month,
      eligible: planned.length,
      created,
      skipped: skips.length,
      failed: failures.length,
    },
  });
  console.log(`[bank-backfill] audit row written.`);
}

main()
  .catch((err) => {
    // A pool connection failure arrives as an AggregateError whose message is the EMPTY STRING,
    // so the obvious console.error(err.message) prints "[bank-backfill] FATAL" and nothing else —
    // indistinguishable from a silent success. Same trap as scripts/bank-exception-report.ts.
    const e = err as { name?: string; code?: string; errno?: number; message?: string };
    const parts = [e?.name, e?.code, e?.errno != null ? `errno=${e.errno}` : "", e?.message]
      .filter((p) => p !== undefined && p !== null && String(p).trim() !== "");
    console.error(`[bank-backfill] FATAL ${parts.join(" | ") || String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // BOTH pools, not just mas_hrms. Closing only db leaves the db_bill pool's idle sockets
    // open and node never exits: observed on the production host 2026-08-13, where the dry run
    // printed its complete report and then sat there until an external timeout killed it at
    // exit code 124. Harmless for a dry run, genuinely bad for --apply — the operator sees a
    // hung process after a write and cannot tell "finished, pool open" from "still writing",
    // and the temptation is to Ctrl-C a script midway through creating payment destinations.
    await (db as unknown as { end?: () => Promise<void> }).end?.().catch(() => {});
    await closeBillPool().catch(() => {});
  });
