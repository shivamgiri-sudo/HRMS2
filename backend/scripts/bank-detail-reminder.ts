/**
 * Reminds active employees with no primary bank record to submit their bank details via the
 * existing self-service flow (POST /api/employees/me/bank-change-request, approval-gated).
 *
 * WHY THIS EXISTS
 *
 * The 2026-08-12 bank-exception-report.ts run found 383 of 1,327 active employees classified
 * MISSING ("no primary bank record") — the largest single reason the payment-release gate is
 * blocked. The submission pipeline itself was checked and works (verified via the
 * profile_update_approval backlog: only 2 pending requests total, both from a demo account —
 * no bottleneck). The gap is that most of these employees have simply never been asked.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not create, guess or infer any bank detail. It does not touch payroll. It sends one
 * factual email per MISSING employee pointing at the existing self-service page, nothing more.
 *
 * SAFETY
 *
 * Dry run by default: prints the exact recipient list and renders the email for the FIRST
 * recipient so the content can be reviewed before anything sends. --apply sends for real,
 * one at a time, and writes an audit row per send via logSensitiveAction. Idempotent per run
 * only in the sense that re-running targets whoever is STILL missing a primary record at that
 * moment — anyone who has since submitted one drops out of the list naturally.
 *
 * Usage:
 *   npx tsx scripts/bank-detail-reminder.ts             # dry run
 *   npx tsx scripts/bank-detail-reminder.ts --apply      # send for real
 */
import { db } from "../src/db/mysql.js";
import { emailService } from "../src/modules/communication/email.service.js";
import { env } from "../src/config/env.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");

function reminderHtml(fullName: string, employeeCode: string, link: string): string {
  return `
  <div style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
      <div style="background:#0f172a;color:#ffffff;padding:22px 26px">
        <h2 style="margin:0;font-size:22px">Action needed: add your bank details</h2>
        <p style="margin:6px 0 0;color:#cbd5e1;font-size:13px">MAS Callnet HRMS</p>
      </div>
      <div style="padding:26px">
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${fullName},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px">
          Our records show no bank account on file for you (employee code ${employeeCode}).
          Salary and reimbursements cannot be released to an account we don't have on record.
        </p>
        <p style="margin:24px 0"><a href="${link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;display:inline-block">Add bank details</a></p>
        <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">
          Log in and open Profile to submit your account details. Changes go through Payroll HO
          approval before taking effect. If you believe this is an error, please contact HR.
        </p>
      </div>
    </div>
  </div>`;
}

function reminderText(fullName: string, employeeCode: string, link: string): string {
  return `Hi ${fullName},\n\nOur records show no bank account on file for you (employee code ${employeeCode}). Salary and reimbursements cannot be released to an account we don't have on record.\n\nAdd your bank details: ${link}\n\nLog in and open Profile to submit your account details. Changes go through Payroll HO approval before taking effect. If you believe this is an error, please contact HR.`;
}

// Same population gate as bank-exception-report.ts (e.active_status = 1 — the authoritative
// employment flag; employment_status can drift from it, e.g. migration 1117 deactivated
// active_status for the E2E fixtures but never touched employment_status). Demo personas
// (EMP-XXX-001, ceo@mascallnet.com etc.) are genuinely active_status=1 and legitimate
// employees for every other purpose, but are not real people to remind about bank details —
// excluded explicitly by the same naming/domain markers migration 1117's own guard used.
//
// COALESCE(e.email,'') matters: a plain `e.email NOT LIKE '...'` is NULL (not TRUE) when
// email is NULL, and NULL AND anything is NULL — so without this, every employee with no
// email at all would silently fail the whole exclusion clause and vanish from BOTH the
// recipient list and the "no email" count. Caught by reconciling this script's own numbers
// against bank-exception-report.ts's 383 before ever sending anything.
const NOT_A_REAL_EMPLOYEE_SQL = `
  e.employee_code NOT REGEXP '^EMP-[A-Z]+-[0-9]+$'
  AND COALESCE(e.email, '') NOT LIKE '%@e2etest.local'
  AND COALESCE(e.email, '') NOT LIKE '%@testmas.local'
  AND COALESCE(e.email, '') NOT LIKE '%@mascallnet.com'
  AND COALESCE(e.full_name, '') NOT LIKE '%E2E%'
  AND COALESCE(e.full_name, '') NOT LIKE 'Test %'
`;

(async () => {
  const [rows] = await db.query<any[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.email
       FROM employees e
      WHERE e.active_status = 1
        AND e.email IS NOT NULL AND e.email <> ''
        AND ${NOT_A_REAL_EMPLOYEE_SQL}
        AND NOT EXISTS (
          SELECT 1 FROM employee_bank_detail b
           WHERE b.employee_id = e.id AND b.is_primary = 1
        )
      ORDER BY e.employee_code`,
  );

  const [noEmail] = await db.query<any[]>(
    `SELECT COUNT(*) n FROM employees e
      WHERE e.active_status = 1
        AND (e.email IS NULL OR e.email = '')
        AND ${NOT_A_REAL_EMPLOYEE_SQL}
        AND NOT EXISTS (SELECT 1 FROM employee_bank_detail b WHERE b.employee_id = e.id AND b.is_primary = 1)`,
  );

  console.log(`mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`MISSING employees with an email on file: ${rows.length}`);
  console.log(`MISSING employees with NO email on file (cannot be reminded this way): ${noEmail[0].n}`);

  if (!rows.length) { console.log("nothing to do"); await db.end(); return; }

  const link = `${env.FRONTEND_URL}/profile`;

  if (!APPLY) {
    console.log(`\n--- sample recipient list (first 15 of ${rows.length}) ---`);
    console.table(rows.slice(0, 15).map((r) => ({ code: r.employee_code, name: r.full_name, email: r.email })));
    console.log(`\n--- rendered email for first recipient (${rows[0].full_name}) ---`);
    console.log(reminderText(rows[0].full_name, rows[0].employee_code, link));
    console.log(`\nDRY RUN — nothing sent. Re-run with --apply to send to all ${rows.length}.`);
    await db.end();
    return;
  }

  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      await emailService.send({
        to: r.email,
        subject: "Action needed: add your bank details",
        html: reminderHtml(r.full_name, r.employee_code, link),
        text: reminderText(r.full_name, r.employee_code, link),
      });
      await logSensitiveAction({
        actor_user_id: "system",
        action_type: "BANK_DETAIL_REMINDER_SENT",
        module_key: "payroll",
        entity_type: "employee",
        entity_id: r.id,
        change_summary: { employee_code: r.employee_code, email: r.email },
      });
      sent++;
    } catch (e: any) {
      failed++;
      console.log(`  FAILED ${r.employee_code}: ${e?.message ?? e}`);
    }
  }
  console.log(`\nsent=${sent} failed=${failed}`);
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
