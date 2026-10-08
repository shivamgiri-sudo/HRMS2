import { Router } from "express";
import { db } from "../../db/mysql.js";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { parseSerial, scopeVouchers } from "./salary-voucher.routes.js";
import { salaryVoucherService, type Voucher } from "./salary-voucher.service.js";
import { postSalaryVoucherToLedger } from "./payroll-journal-posting.service.js";

/**
 * The ONE write action on top of the Tally salary voucher — deliberately its own router and
 * file, mounted alongside the read-only salaryVoucherRouter (same /api/finance/payroll prefix)
 * rather than added to salary-voucher.routes.ts. That file's own contract test
 * (salary-voucher-export.test.ts, "never writes — the voucher is a view of a run that already
 * exists") asserts no INSERT/UPDATE/DELETE and no .post/.put/.patch/.delete route ever appears
 * in it — a real, deliberate architectural guarantee, not an incidental restriction. Keeping the
 * write here means that guarantee stays true and testable, while this capability still exists.
 *
 * finance_head / super_admin ONLY — narrower than the read-only VOUCHER_ROLES (which also grants
 * payroll_hr view access). Posting to the general ledger is a Finance action, not a
 * payroll-viewing one, same distinction GRN approval and Payment Voucher release already draw.
 */
const POST_TO_LEDGER_ROLES = ["finance_head", "super_admin"] as const;

export const payrollLedgerPostingRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

payrollLedgerPostingRouter.use(requireAuth);

/**
 * Posts a run's vouchers to the general ledger. Never a side effect of viewing/generating a
 * voucher (GET /runs/:runId/vouchers in salary-voucher.routes.ts) — that stays a pure view.
 *
 * Each voucher (one per company x branch) posts in its OWN transaction, so one branch's failure
 * (already posted, or a missing ledger account) does not roll back the others — the caller gets
 * a per-voucher result and can retry only the ones that failed.
 */
payrollLedgerPostingRouter.post(
  "/runs/:runId/vouchers/post-to-ledger",
  requireWriteAccess,
  requireRole(...POST_TO_LEDGER_ROLES),
  h(async (req, res) => {
    const actorUserId = String(req.authUser?.id ?? "");
    let generated: { period: string; vouchers: Voucher[]; unassigned: string[]; unpaid: string[] };
    try {
      generated = await salaryVoucherService.generate(req.params.runId, {
        companyCode: req.query.companyCode ? String(req.query.companyCode) : undefined,
        serialFrom: parseSerial(req.query.serialFrom),
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Unable to generate the salary voucher" });
      return;
    }

    const vouchers = await scopeVouchers(req, generated.vouchers);
    const posted: { voucher_no: string; branch_id: string; journal_entry_id: string }[] = [];
    const failed: { voucher_no: string; branch_id: string; error: string }[] = [];

    for (const voucher of vouchers) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const { journalEntryId } = await postSalaryVoucherToLedger(connection, req.params.runId, voucher, actorUserId);
        await connection.commit();
        posted.push({ voucher_no: voucher.voucher_no, branch_id: voucher.branch_id, journal_entry_id: journalEntryId });
        await logSensitiveAction({
          actor_user_id: actorUserId,
          actor_role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
          action_type: "PAYROLL_VOUCHER_POSTED_TO_LEDGER",
          module_key: "FINANCE",
          entity_type: "payroll_ledger_voucher",
          entity_id: journalEntryId,
          change_summary: { voucher_no: voucher.voucher_no, branch_id: voucher.branch_id, amount: voucher.totals.debit },
        }).catch(() => undefined);
      } catch (error) {
        await connection.rollback();
        failed.push({ voucher_no: voucher.voucher_no, branch_id: voucher.branch_id, error: error instanceof Error ? error.message : "Unable to post this voucher" });
      } finally {
        connection.release();
      }
    }

    res.status(failed.length && !posted.length ? 400 : 200).json({ success: failed.length === 0, data: { posted, failed } });
  }),
);

export default payrollLedgerPostingRouter;
