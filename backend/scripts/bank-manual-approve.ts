/**
 * Approve named joiners' manual-review bank accounts, exactly as the Approve button in Payment
 * Disbursal Center -> Manual review does (approveManualReviewBankDetail: refuses an account number
 * the bank never checked, idempotent against an existing primary row), with the same audit entry.
 * For decisions the owner gave outside the screen. Dry run unless --apply.
 *
 *   npx tsx scripts/bank-manual-approve.ts MAS63527 MAS63523 [--apply]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { approveManualReviewBankDetail, getManualReviewBankGaps } from "../src/modules/payroll/bank-manual-review.service.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");
const CODES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ACTOR_EMAIL = "shivam.giri@teammas.in";

(async () => {
  const [actorRows] = await db.execute<RowDataPacket[]>(`SELECT id FROM auth_user WHERE email = ? LIMIT 1`, [ACTOR_EMAIL]);
  const actorId = String((actorRows as RowDataPacket[])[0]?.id ?? "");
  if (!actorId) throw new Error(`no auth_user for ${ACTOR_EMAIL}`);

  const queue = await getManualReviewBankGaps();
  for (const code of CODES) {
    const row = queue.find((r) => r.employee_code === code);
    if (!row) { console.log(`${code}\tnot in the manual review queue`); continue; }
    console.log(`${code}\tqueue status=${row.verification_status} account_changed=${row.account_changed} bank_name_returned=${row.bank_registered_name ? "yes" : "no"}`);
    if (row.account_changed) { console.log(`${code}\tskipped: number on file is not the verified one`); continue; }
    if (!APPLY) { console.log(`${code}\twould approve`); continue; }
    const result = await approveManualReviewBankDetail({ employeeId: row.employee_id });
    console.log(`${code}\t${result.status}`);
    if (result.status === "inserted") {
      await logSensitiveAction({
        actor_user_id: actorId,
        action_type: "BANK_MANUAL_REVIEW_APPROVED",
        module_key: "payroll",
        entity_type: "employee_bank_detail",
        entity_id: row.employee_id,
        change_summary: { source: "candidate_bank_verification.manual_review", via: "ops script bank-manual-approve", decided_by: ACTOR_EMAIL },
      } as never);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
