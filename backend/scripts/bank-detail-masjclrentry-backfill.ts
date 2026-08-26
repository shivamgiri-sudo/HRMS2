/**
 * Backfill employee_bank_detail from db_bill.masjclrentry for employees who have no confirmed
 * salary_data credit to backfill from (see scripts/bank-detail-db-bill-backfill.ts) — almost
 * entirely recent 2026 joiners who joined after db_bill's last confirmed-receipt month
 * (2026-06-30), so db_bill never had a chance to pay them and salary_data has nothing.
 *
 * masjclrentry is db_bill's staff-master record captured at hiring time (AcNo/AcBank/IFSCCode/
 * AccHolder), not a confirmed payment — weaker evidence in the abstract than a confirmed credit,
 * but the only evidence that exists for employees too new to have been paid through db_bill.
 * Every candidate is corroborated before being trusted: an exact EmpCode match to masjclrentry
 * is accepted ONLY if the employee's mas_hrms full_name shares >=50% of its words with
 * masjclrentry.EmpName, OR the two systems' mobile numbers agree exactly. Verified 2026-08-26:
 * 98/98 candidate rows for the initial target population passed this gate with zero borderline
 * cases (68 confirmed by mobile, all 98 by name).
 *
 * Same production-key-parity guard as bank-detail-db-bill-backfill.ts, same reason: off the
 * production host, loadKey() substitutes the all-zeros dev key, and every row written would be
 * permanently unreadable ciphertext — a MISSING record turned invisible, not fixed. This script
 * refuses to run anywhere the guard fails, same as its sibling.
 *
 * Usage (ON THE PRODUCTION HOST ONLY):
 *   cd backend
 *   npx tsx scripts/bank-detail-masjclrentry-backfill.ts            # dry run, writes nothing
 *   npx tsx scripts/bank-detail-masjclrentry-backfill.ts --apply
 *   npx tsx scripts/bank-detail-masjclrentry-backfill.ts --apply --limit=10
 *
 * WHAT IT WILL NOT DO
 *   - Touch an employee who already has an active primary bank record — the NOT EXISTS in the
 *     target query is the whole safety property, identical to the sibling script.
 *   - Accept an EmpCode match with no name/mobile corroboration — an accidental or coincidental
 *     code collision must not become someone else's payment destination.
 *   - Write a record with no usable IFSC, or an implausible account number.
 *   - Mark the record verified=1. Unlike salary_data (proof the money already arrived), this is
 *     staff-master data with a corroboration check, not a confirmed disbursement — it deserves a
 *     real penny drop before payroll should treat it as verified. It is written as active/primary
 *     so Bank Readiness can see and use it, but verified=0 until that happens.
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

const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, "");
const mask = (v: string) => (v.length >= 4 ? `XXXX${v.slice(-4)}` : "XXXX");

function isPlausibleAccount(v: string): boolean {
  if (!v) return false;
  if (/[Ee][+-]?\d/.test(v)) return false;
  if (/^0+$/.test(v)) return false;
  return /^[0-9]{6,20}$/.test(v);
}

function normName(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Word-overlap score 0-100, same metric used by ats.onboarding.service.ts's penny-drop name match. */
function nameOverlap(a: unknown, b: unknown): number {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const wa = new Set(na.split(" ").filter(Boolean));
  const wb = new Set(nb.split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  const common = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return Math.round((common / union) * 100);
}

interface Skip { code: string; reason: string }

async function main(): Promise<void> {
  console.log(`[masjclrentry-backfill] mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (writes nothing)"}`);

  const [ctRows] = await db.query<RowDataPacket[]>(
    `SELECT account_number_enc FROM employee_bank_detail
      WHERE account_number_enc IS NOT NULL AND account_number_enc <> '' LIMIT 25`,
  );
  const parity = checkKeyParity(
    (ctRows as Array<{ account_number_enc: string }>).map((r) => r.account_number_enc),
  );
  console.log(`[masjclrentry-backfill] key parity: ${parity.decrypted}/${parity.sampled} decrypt`);
  if (!parity.ok) {
    console.error(
      "[masjclrentry-backfill] REFUSING TO RUN — the loaded FIELD_ENCRYPTION_KEY cannot read " +
      "ciphertext already stored in this database. Off the production host this is the all-zeros " +
      "dev key, and every row written would be permanently unreadable. Run this on the production host.",
    );
    process.exitCode = 1;
    return;
  }

  const [targets] = await db.query<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
            e.mobile
       FROM employees e
      WHERE e.active_status = 1
        AND NOT EXISTS (SELECT 1 FROM employee_bank_detail b
                         WHERE b.employee_id = e.id AND b.active_status = 1 AND b.is_primary = 1)
      ORDER BY e.employee_code`,
  );
  console.log(`[masjclrentry-backfill] active employees with no primary bank record: ${(targets as unknown[]).length}`);

  const codes = (targets as any[]).map((t) => norm(t.employee_code));
  const staffRows = codes.length
    ? await billQuery<RowDataPacket & {
        EmpCode: string; EmpName: string; AcNo: string; AcBank: string | null;
        BankBranch: string | null; IFSCCode: string | null; Mobile: string | null; Mobile1: string | null;
      }>(
        `SELECT EmpCode, EmpName, AcNo, AcBank, BankBranch, IFSCCode, Mobile, Mobile1
           FROM masjclrentry WHERE EmpCode IN (${codes.map(() => "?").join(",")})`,
        codes,
      )
    : [];
  const staffMap = new Map(staffRows.map((r) => [norm(r.EmpCode).toUpperCase(), r]));

  const skips: Skip[] = [];
  const planned: Array<{ id: string; code: string; account: string; ifsc: string;
                         bank: string | null; branch: string | null; holder: string | null;
                         corroboratedBy: string }> = [];

  for (const t of targets as any[]) {
    const code = norm(t.employee_code).toUpperCase();
    const staff = staffMap.get(code);
    if (!staff) { skips.push({ code, reason: "no row in masjclrentry" }); continue; }
    const account = norm(staff.AcNo);
    if (!isPlausibleAccount(account)) {
      skips.push({ code, reason: `no usable account number (${mask(account) || "(blank)"})` });
      continue;
    }
    const ifsc = norm(staff.IFSCCode).toUpperCase();
    if (!ifsc || ifsc === "0" || ifsc === "NA") {
      skips.push({ code, reason: "no usable IFSC in masjclrentry" });
      continue;
    }
    const mobileMatch = t.mobile && (t.mobile === staff.Mobile || t.mobile === staff.Mobile1);
    const overlap = nameOverlap(t.full_name, staff.EmpName);
    if (!mobileMatch && overlap < 50) {
      skips.push({ code, reason: `name/mobile corroboration failed (name overlap ${overlap}%, mobile ${mobileMatch ? "match" : "no match"})` });
      continue;
    }
    planned.push({
      id: t.id, code, account, ifsc,
      bank: staff.AcBank ?? null, branch: staff.BankBranch ?? null, holder: staff.EmpName ?? null,
      corroboratedBy: mobileMatch ? "mobile" : "name",
    });
  }

  console.log(`\n[masjclrentry-backfill] eligible to create: ${planned.length}`);
  console.log(`[masjclrentry-backfill] skipped:             ${skips.length}`);
  const byReason = new Map<string, number>();
  for (const s of skips) {
    const key = s.reason.replace(/\(.*\)/, "(…)");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }
  const byMobile = planned.filter((p) => p.corroboratedBy === "mobile").length;
  console.log(`\n[masjclrentry-backfill] corroborated by mobile: ${byMobile}, by name only: ${planned.length - byMobile}`);

  console.log(`\n[masjclrentry-backfill] sample of planned rows (accounts masked):`);
  for (const p of planned.slice(0, 15)) {
    console.log(`    ${p.code.padEnd(12)} ${mask(p.account)}  ${p.ifsc.padEnd(12)} corroborated-by-${p.corroboratedBy}  ${p.bank ?? ""}`);
  }

  if (!APPLY) {
    console.log(`\n[masjclrentry-backfill] DRY RUN — nothing written. Re-run with --apply to create ${planned.length} record(s).`);
    return;
  }

  let created = 0;
  const failures: Skip[] = [];
  for (const p of planned.slice(0, LIMIT)) {
    try {
      const [seqRows] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(account_seq), 0) + 1 AS next_seq FROM employee_bank_detail WHERE employee_id = ?`,
        [p.id],
      );
      const nextSeq = Number((seqRows as any[])[0]?.next_seq ?? 1);

      // verified = 0 deliberately — see header. Staff-master + corroboration is enough to stop
      // Bank Readiness reporting MISSING for someone who plainly isn't, but not enough to skip a
      // real penny drop before payroll trusts it as confirmed.
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO employee_bank_detail
           (id, employee_id, is_primary, account_seq, bank_name, account_holder_name, bank_branch,
            account_number_enc, ifsc_code, account_type, verified, active_status)
         VALUES (UUID(), ?, 1, ?, ?, ?, ?, ?, ?, 'Savings', 0, 1)`,
        [p.id, nextSeq, p.bank, p.holder, p.branch, encryptField(p.account), p.ifsc],
      );
      if (result.affectedRows === 1) created++;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      failures.push({ code: p.code, reason: `${e?.code ?? ""} ${e?.message ?? String(err)}`.trim() });
    }
  }

  console.log(`\n[masjclrentry-backfill] created: ${created}`);
  if (failures.length) {
    console.log(`[masjclrentry-backfill] failed:  ${failures.length}`);
    for (const f of failures.slice(0, 20)) console.log(`    ${f.code.padEnd(12)} ${f.reason}`);
  }

  await logSensitiveAction({
    actor_user_id: "system:bank-detail-masjclrentry-backfill",
    action_type: "BANK_DETAIL_BULK_BACKFILL",
    module_key: "payroll",
    entity_type: "employee_bank_detail",
    change_summary: {
      source: "db_bill.masjclrentry, name/mobile corroborated",
      eligible: planned.length,
      created,
      skipped: skips.length,
      failed: failures.length,
    },
  });
  console.log(`[masjclrentry-backfill] audit row written.`);
}

main()
  .catch((err) => {
    const e = err as { name?: string; code?: string; errno?: number; message?: string };
    const parts = [e?.name, e?.code, e?.errno != null ? `errno=${e.errno}` : "", e?.message]
      .filter((p) => p !== undefined && p !== null && String(p).trim() !== "");
    console.error(`[masjclrentry-backfill] FATAL ${parts.join(" | ") || String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as unknown as { end?: () => Promise<void> }).end?.().catch(() => {});
    await closeBillPool().catch(() => {});
  });
