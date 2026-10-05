/**
 * Why HRMS P&L revenue/cost differs from db_bill, per cost centre, Apr-Aug 2026. READ-ONLY (SELECT only).
 * Prints, one line per row:
 *   HD_SNAP   freshness / counts of the db_bill snapshot tables the P&L reads
 *   HD_REV    per cost-centre + period: particulars, provision, billing_amt, revenue_active, credit notes, invoice-header total, cost_centre_master state
 *   HD_RUN    salary_prep_run list
 *   HD_SAL    per run + cost centre: gross, employer pf/esic, gratuity, other deductions, headcount
 *   HD_CC     cost centres in db_bill (snapshot) that are missing from / inactive in cost_centre_master
 *
 *   npx tsx scripts/hrms-vs-dbbill-diagnose.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { PROCESS_BY_COST_CENTRE } from "../src/modules/process-pnl/pnl-actuals.service.js";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const out = (tag: string, rows: unknown[]) => { for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); };
const PERIODS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const IN = PERIODS.map(() => "?").join(",");
const run = async (tag: string, sql: string, p: unknown[] = []) => {
  try { out(tag, await q(sql, p)); } catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};

(async () => {
  for (const t of ["billing_provision_snapshot", "billing_invoice_particular_snapshot", "billing_credit_note_snapshot"]) {
    await run("HD_SNAP", `SELECT '${t}' t, period_code p, COUNT(*) n, MAX(synced_at) last_sync FROM ${t} WHERE period_code IN (${IN}) GROUP BY period_code ORDER BY period_code`, PERIODS)
      .catch(() => undefined);
  }
  // invoice header snapshot has no period_code: use month_label
  await run("HD_SNAP", `SELECT 'billing_invoice_snapshot' t, month_label p, COUNT(*) n, MAX(synced_at) last_sync FROM billing_invoice_snapshot WHERE invoice_date >= '2026-03-01' GROUP BY month_label ORDER BY MIN(invoice_date)`);

  await run("HD_REV", `
    SELECT x.period_code p, x.cc, ccm.id ccm_id, ccm.company_name, ccm.active_status ccm_active, ccm.revenue_flag, ccm.branch_id, bm.branch_name,
           pc.process_id modal_process_id, ccm.process_id ccm_process_id, pmm.process_name modal_process, pmc.process_name ccm_process,
           SUM(x.particulars) particulars, SUM(x.prov) provision, SUM(x.bill) billing_amt, MAX(x.rev_active) revenue_active, SUM(x.credit) credit_note
      FROM (
        SELECT period_code, cost_centre_code COLLATE utf8mb4_unicode_ci cc, SUM(amount) particulars, 0 prov, 0 bill, NULL rev_active, 0 credit
          FROM billing_invoice_particular_snapshot WHERE period_code IN (${IN}) GROUP BY period_code, cost_centre_code
        UNION ALL
        SELECT period_code, cost_centre_code COLLATE utf8mb4_unicode_ci, 0, SUM(provision_amt), SUM(billing_amt), MAX(revenue_active), 0
          FROM billing_provision_snapshot WHERE period_code IN (${IN}) GROUP BY period_code, cost_centre_code
        UNION ALL
        SELECT period_code, cost_centre_code COLLATE utf8mb4_unicode_ci, 0, 0, 0, NULL, SUM(CASE WHEN is_approved = 1 THEN total_amt ELSE 0 END)
          FROM billing_credit_note_snapshot WHERE period_code IN (${IN}) GROUP BY period_code, cost_centre_code
      ) x
      LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = x.cc
      LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
      LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      LEFT JOIN process_master pmm ON pmm.id = pc.process_id
      LEFT JOIN process_master pmc ON pmc.id = ccm.process_id
     GROUP BY x.period_code, x.cc, ccm.id, ccm.company_name, ccm.active_status, ccm.revenue_flag, ccm.branch_id, bm.branch_name, pc.process_id, ccm.process_id, pmm.process_name, pmc.process_name
     ORDER BY x.period_code, x.cc`, [...PERIODS, ...PERIODS, ...PERIODS]);

  await run("HD_RUN", `SELECT id, run_month, run_kind, status, total_employees, total_gross, scope_kind, branch_id, process_id FROM salary_prep_run WHERE run_month IN (${IN}) ORDER BY run_month, id`, PERIODS);
  await run("HD_SAL", `
    SELECT r.run_month p, spl.run_id, ccm.cost_centre_code cc, COUNT(*) n, SUM(COALESCE(spl.gross_salary,0)) gross, SUM(COALESCE(spl.pf_employer,0)) pf_er,
           SUM(COALESCE(spl.esic_employer,0)) esic_er, SUM(COALESCE(spl.gratuity,0)) gratuity,
           SUM(COALESCE(spl.other_deductions,0)+COALESCE(spl.loan_emi,0)+COALESCE(spl.advance_recovery,0)) other_ded, SUM(COALESCE(spl.lwp_deduction,0)) lwp
      FROM salary_prep_line spl JOIN salary_prep_run r ON r.id = spl.run_id
      LEFT JOIN cost_centre_master ccm ON ccm.id = spl.cost_centre_id
     WHERE r.run_month IN (${IN}) GROUP BY r.run_month, spl.run_id, ccm.cost_centre_code ORDER BY r.run_month, spl.run_id, ccm.cost_centre_code`, PERIODS);
  await run("HD_CC", `
    SELECT DISTINCT s.cost_centre_code cc, ccm.id ccm_id, ccm.company_name, ccm.active_status, ccm.revenue_flag
      FROM billing_provision_snapshot s LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = s.cost_centre_code COLLATE utf8mb4_unicode_ci
     WHERE s.period_code IN (${IN}) AND (ccm.id IS NULL OR ccm.active_status <> 1)`, PERIODS);
  await new Promise((resolve) => process.stdout.write("HD_DONE\n", resolve));
  process.exit(0);
})();
