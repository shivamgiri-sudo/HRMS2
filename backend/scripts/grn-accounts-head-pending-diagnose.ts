/**
 * GRN "Accounts Head" pending-bucket diagnosis. READ-ONLY.
 *
 * Lists every grn_request row sitting at status='branch_head_approved' (the Accounts Head
 * bucket), with branch, submitter, branch-head reviewer, and whether it was a Head Office
 * bypass. Also resolves a given user's active roles and flags, per GRN, whether that user
 * would be blocked by either the role gate (missing accounts_head) or the maker-checker
 * self-review guard (submitted_by / branch_head_reviewed_by === that user).
 *
 *   npx tsx scripts/grn-accounts-head-pending-diagnose.ts <user_email>
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const EMAIL = process.argv[2];
if (!EMAIL) {
  console.error("Usage: npx tsx scripts/grn-accounts-head-pending-diagnose.ts <user_email>");
  process.exit(1);
}

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const [user] = (await q(
    `SELECT au.id, au.email, e.full_name
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
      WHERE au.email = ? LIMIT 1`,
    [EMAIL]
  )) as any[];

  if (!user) {
    console.log(`No auth_user found for ${EMAIL}`);
  } else {
    console.log(`\n== user ${EMAIL} ==`);
    console.table([user]);

    const roles = await q(
      `SELECT role_key, active_status, granted_at FROM user_roles WHERE user_id = ?`,
      [user.id]
    );
    console.log(`\n== roles for ${EMAIL} ==`);
    console.table(roles);
  }

  const pending = await q(
    `SELECT gr.id, gr.grn_number, gr.grn_type, gr.status, gr.branch_id, bm.branch_name,
            gr.vendor_name, gr.amount, gr.amount_with_tax,
            gr.submitted_by, su.email AS submitted_by_email,
            gr.branch_head_reviewed_by, bu.email AS branch_head_reviewed_by_email,
            gr.branch_head_review_note,
            DATE_FORMAT(gr.submitted_at, '%Y-%m-%d %H:%i') AS submitted_at,
            DATE_FORMAT(gr.branch_head_reviewed_at, '%Y-%m-%d %H:%i') AS branch_head_reviewed_at
       FROM grn_request gr
       LEFT JOIN branch_master bm ON bm.id = gr.branch_id
       LEFT JOIN auth_user su ON su.id = gr.submitted_by
       LEFT JOIN auth_user bu ON bu.id = gr.branch_head_reviewed_by
      WHERE gr.status = 'branch_head_approved'
      ORDER BY gr.submitted_at ASC`
  );

  console.log(`\n== ${pending.length} GRN(s) pending at Accounts Head bucket ==`);
  console.table(
    (pending as any[]).map((r) => ({
      id: r.id,
      grn_number: r.grn_number,
      branch: r.branch_name,
      type: r.grn_type,
      amount: r.amount_with_tax ?? r.amount,
      submitted_by: r.submitted_by_email,
      branch_head_reviewed_by: r.branch_head_reviewed_by_email,
      head_office_bypass: r.branch_head_review_note?.includes("Auto-approved") ? "yes" : "no",
    }))
  );

  if (user) {
    console.log(`\n== would ${EMAIL} be blocked on each, and why ==`);
    const blocked = (pending as any[]).map((r) => {
      const isSubmitter = String(r.submitted_by) === String(user.id);
      const isBranchHeadReviewer = String(r.branch_head_reviewed_by) === String(user.id);
      let reason = "none (role gate is the only thing to check separately)";
      if (isSubmitter) reason = "maker-checker: is the submitter";
      else if (isBranchHeadReviewer) reason = "maker-checker: performed the Branch Head review";
      return {
        id: r.id,
        grn_number: r.grn_number,
        branch: r.branch_name,
        maker_checker_block: isSubmitter || isBranchHeadReviewer ? "yes" : "no",
        reason,
      };
    });
    console.table(blocked);

    const mcBlockedCount = blocked.filter((b) => b.maker_checker_block === "yes").length;
    console.log(
      `\n${mcBlockedCount} of ${pending.length} would hit the maker-checker guard for ${EMAIL}; ` +
        `the remaining ${pending.length - mcBlockedCount} are blocked only by the role gate ` +
        `(resolveFinanceStageRole requiring 'accounts_head').`
    );
  }

  const ahHolders = await q(
    `SELECT au.id, au.email, e.full_name, ur.active_status
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
      WHERE ur.role_key = 'accounts_head'`
  );
  console.log(`\n== everyone currently holding the accounts_head role ==`);
  console.table(ahHolders);

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
