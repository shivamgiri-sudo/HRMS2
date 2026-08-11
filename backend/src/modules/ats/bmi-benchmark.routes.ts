import { Router } from 'express';
import { excludeEmployeeShapedCandidatesSql } from './ats-reporting-scope.js';
import type { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';

export /**
 * ats_candidate holds 29,926 legacy EMPLOYEE records beside 7,760 genuine candidates. This
 * benchmark board counted them in every sourced/stage figure, so its funnel described the
 * employee roster rather than the hiring pipeline.
 */
const EXCLUDE_AC = excludeEmployeeShapedCandidatesSql('ats_candidate');

const bmiBenchmarkRouter = Router();

bmiBenchmarkRouter.use(requireAuth);
bmiBenchmarkRouter.use(requireRole(
  'super_admin', 'admin', 'ceo',
  'hr', 'hr_admin', 'manager', 'process_manager', 'branch_head',
  'finance', 'wfm'
));

// ── helpers ──────────────────────────────────────────────────────────────────

/** Returns last N calendar months ending with last completed month.
 *  e.g. today = 2026-08-05, months=6 → ['2026-02','2026-03',...,'2026-07']
 */
function getMonthRange(months = 6): string[] {
  const result: string[] = [];
  const now = new Date();
  // Start from last completed month
  for (let i = months; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push(m);
  }
  return result;
}

type CellMap = Record<string, number | null>;

function buildRow(
  key: string,
  label: string,
  section: string,
  format: 'number' | 'currency' | 'days' | 'percent' | 'hours',
  editable: boolean,
  data: CellMap,
  months: string[],
  unavailableTooltip?: string
) {
  const cells: Record<string, { value: number | null; source: string; tooltip?: string }> = {};
  let total = 0;
  let hasAny = false;

  for (const m of months) {
    const v = data[m] ?? null;
    if (v !== null) { total += v; hasAny = true; }
    cells[m] = {
      value: v,
      source: editable ? 'manual' : (unavailableTooltip && v === null ? 'unavailable' : 'auto'),
      tooltip: unavailableTooltip && v === null ? unavailableTooltip : undefined,
    };
  }

  return { key, label, section, format, editable, cells, total: hasAny ? total : null };
}

// ── main GET endpoint ─────────────────────────────────────────────────────────

bmiBenchmarkRouter.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.query.branch_id as string) || null;

    /**
     * applied_for_branch holds branch NAMES, not ids — verified on production: of the 361
     * onboarding-bridge candidates, 347 of their applied_for_branch values match
     * branch_master.branch_name and only 8 match an id. Every ats_candidate leg of this board
     * compared the incoming branch_id against that column, so a branch-filtered benchmark
     * matched nothing on those rows while the job_requisition and employees legs — which do
     * use real ids — matched correctly. The result was a board with real numbers on some rows
     * and zeros on others, which reads as "this branch sources nobody" rather than as a bug.
     *
     * Resolved once here, accepting either an id or a name. If it resolves to neither, the
     * sentinel matches no row: failing closed keeps a filtered view from silently widening to
     * the whole organisation.
     */
    let branchName: string | null = null;
    if (branchId) {
      const [bm] = await db.execute<RowDataPacket[]>(
        `SELECT branch_name FROM branch_master WHERE id = ? OR branch_name = ? LIMIT 1`,
        [branchId, branchId],
      );
      branchName = (bm[0]?.branch_name as string | undefined) ?? "__UNRESOLVED_BRANCH__";
    }
    const months = getMonthRange(6);

    // ── FUNNEL queries ────────────────────────────────────────────────────────

    // 1. New hires required (demand raised via job_requisition)
    const [demandRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(jr.created_at, '%Y-%m') AS mo, COUNT(*) AS cnt
       FROM job_requisition jr
       WHERE jr.created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND jr.branch_id = ?' : ''}
       GROUP BY mo`,
      branchId ? [branchId] : []
    );
    const demandMap: CellMap = {};
    for (const r of demandRows) demandMap[r.mo as string] = Number(r.cnt);

    // 2–5. Candidates by channel type
    const channelTypes: Record<string, string> = {
      sourced_portal: 'portal',
      sourced_agency: 'agency',
      sourced_referral: 'referral',
      sourced_walk_in: 'walk_in',
    };
    const sourcedMaps: Record<string, CellMap> = {
      sourced_portal: {},
      sourced_agency: {},
      sourced_referral: {},
      sourced_walk_in: {},
    };

    const [sourcedRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ac.created_at, '%Y-%m') AS mo,
              asc2.channel_type,
              COUNT(DISTINCT ac.id) AS cnt
       FROM ats_candidate ac
       -- COUNT(DISTINCT ac.id): ats_sourcing_channel.channel_code is not guaranteed unique,
       -- and a duplicate channel row would otherwise count the same candidate once per match.
       JOIN ats_sourcing_channel asc2 ON asc2.channel_code = ac.sourcing_channel
       WHERE ac.created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         AND ${EXCLUDE_AC}
         ${branchId ? 'AND ac.applied_for_branch = ?' : ''}
       GROUP BY mo, asc2.channel_type`,
      branchName ? [branchName] : []
    );
    for (const r of sourcedRows) {
      const ct = r.channel_type as string;
      const mo = r.mo as string;
      for (const [key, type] of Object.entries(channelTypes)) {
        if (ct === type) { sourcedMaps[key][mo] = (sourcedMaps[key][mo] ?? 0) + Number(r.cnt); }
      }
    }

    // 6. Screened by HR (moved past 'applied' stage)
    const [screenedRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(sl.stage_date, '%Y-%m') AS mo, COUNT(DISTINCT sl.candidate_id) AS cnt
       FROM ats_candidate_stage_log sl
       WHERE sl.from_stage = 'applied'
         AND sl.stage_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND sl.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const screenedMap: CellMap = {};
    for (const r of screenedRows) screenedMap[r.mo as string] = Number(r.cnt);

    // 7. Passed HR screening (reached shortlisted+)
    const PASSED_STAGES = "'shortlisted','interview_1','interview_2','selected','bgv_pending','bgv_verified','payroll_validated','offer_pending','offer_accepted','offer_approved','joined'";
    const [passedRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(sl.stage_date, '%Y-%m') AS mo, COUNT(DISTINCT sl.candidate_id) AS cnt
       FROM ats_candidate_stage_log sl
       WHERE sl.to_stage IN (${PASSED_STAGES})
         AND sl.from_stage IN ('applied','screening')
         AND sl.stage_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND sl.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const passedMap: CellMap = {};
    for (const r of passedRows) passedMap[r.mo as string] = Number(r.cnt);

    // 8. Appeared for ops interview
    const [interviewRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ir.interviewed_at, '%Y-%m') AS mo, COUNT(DISTINCT ir.candidate_id) AS cnt
       FROM ats_interview_result ir
       WHERE ir.interviewed_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND ir.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const interviewMap: CellMap = {};
    for (const r of interviewRows) interviewMap[r.mo as string] = Number(r.cnt);

    // 9. Selected by ops
    const [selectedRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ir.interviewed_at, '%Y-%m') AS mo, COUNT(DISTINCT ir.candidate_id) AS cnt
       FROM ats_interview_result ir
       WHERE ir.interview_status = 'selected'
         AND ir.interviewed_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND ir.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const selectedMap: CellMap = {};
    for (const r of selectedRows) selectedMap[r.mo as string] = Number(r.cnt);

    // 10. Offers made (entered offer_pending stage)
    const [offersMadeRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(sl.stage_date, '%Y-%m') AS mo, COUNT(DISTINCT sl.candidate_id) AS cnt
       FROM ats_candidate_stage_log sl
       WHERE sl.to_stage = 'offer_pending'
         AND sl.stage_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND sl.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const offersMadeMap: CellMap = {};
    for (const r of offersMadeRows) offersMadeMap[r.mo as string] = Number(r.cnt);

    // 11. Offers accepted
    const [offersAccRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(sl.stage_date, '%Y-%m') AS mo, COUNT(DISTINCT sl.candidate_id) AS cnt
       FROM ats_candidate_stage_log sl
       WHERE sl.to_stage = 'offer_accepted'
         AND sl.stage_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND sl.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const offersAccMap: CellMap = {};
    for (const r of offersAccRows) offersAccMap[r.mo as string] = Number(r.cnt);

    // 12. Actually joined day-1
    const [joinedRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m') AS mo, COUNT(*) AS cnt
       FROM employees e
       WHERE e.date_of_joining >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         AND e.employee_code IS NOT NULL
         ${branchId ? 'AND e.branch_id = ?' : ''}
       GROUP BY mo`,
      branchId ? [branchId] : []
    );
    const joinedMap: CellMap = {};
    for (const r of joinedRows) joinedMap[r.mo as string] = Number(r.cnt);

    // 13. Avg days: demand raised → joining (per month of joining)
    const [avgDaysRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ob.joining_date, '%Y-%m') AS mo,
              ROUND(AVG(DATEDIFF(ob.joining_date, jr.created_at)), 1) AS avg_days
       FROM ats_onboarding_bridge ob
       JOIN ats_candidate ac ON ac.id = ob.candidate_id
       JOIN job_requisition jr ON jr.id = ac.requisition_id
       WHERE ob.joining_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         AND jr.created_at IS NOT NULL
         ${branchId ? 'AND ac.applied_for_branch = ?' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const avgDaysMap: CellMap = {};
    for (const r of avgDaysRows) avgDaysMap[r.mo as string] = Number(r.avg_days) || null;

    // ── COSTS queries ─────────────────────────────────────────────────────────

    // Portal + ad costs from grn_request
    const HIRING_HEADS = "'Hiring Charges','Staff Training & Recruitment'";
    const [grnPortalRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(g.bill_date, '%Y-%m') AS mo, SUM(g.amount) AS total
       FROM grn_request g
       WHERE g.head IN (${HIRING_HEADS})
         AND (g.sub_head LIKE '%Advertisement%' OR g.sub_head LIKE '%Portal%' OR g.sub_head LIKE '%Naukri%')
         AND g.status IN ('approved','submitted')
         AND g.bill_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND g.branch_id = ?' : ''}
       GROUP BY mo`,
      branchId ? [branchId] : []
    );
    const portalCostMap: CellMap = {};
    for (const r of grnPortalRows) portalCostMap[r.mo as string] = Number(r.total);

    // Consultant/agency fees from grn_request
    const [grnConsultRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(g.bill_date, '%Y-%m') AS mo, SUM(g.amount) AS total
       FROM grn_request g
       WHERE g.head IN (${HIRING_HEADS})
         AND (g.sub_head LIKE '%Consultancy%' OR g.sub_head LIKE '%Agency%' OR g.sub_head LIKE '%Brokerage%')
         AND g.status IN ('approved','submitted')
         AND g.bill_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND g.branch_id = ?' : ''}
       GROUP BY mo`,
      branchId ? [branchId] : []
    );
    const consultCostMap: CellMap = {};
    for (const r of grnConsultRows) consultCostMap[r.mo as string] = Number(r.total);

    // Referral bonuses from incentive_upload_line
    const [refBonusRows] = await db.execute<RowDataPacket[]>(
      `SELECT iub.pay_month AS mo, SUM(iul.amount) AS total
       FROM incentive_upload_line iul
       JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
       JOIN incentive_master im ON im.id = iub.incentive_id
       WHERE im.incentive_code = 'REF'
         AND iub.status IN ('approved','applied','finance_approved')
         AND iub.pay_month >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m')
         ${branchId ? 'AND iub.branch_id = ?' : ''}
       GROUP BY iub.pay_month`,
      branchId ? [branchId] : []
    );
    const refBonusMap: CellMap = {};
    for (const r of refBonusRows) refBonusMap[r.mo as string] = Number(r.total);

    // HR department CTC from payroll
    const hrCtcMap: CellMap = {};
    for (const mo of months) {
      const [runRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_prep_run WHERE run_month = ? ORDER BY created_at DESC LIMIT 1`,
        [mo]
      );
      if (runRows.length) {
        const runId = (runRows[0] as { id: string }).id;
        const qArgs: (string | null)[] = [runId];
        if (branchId) qArgs.push(branchId);
        const [ctcRows] = await db.execute<RowDataPacket[]>(
          `SELECT SUM(spl.gross_salary) AS total
           FROM salary_prep_line spl
           JOIN employees e ON e.id = spl.employee_id
           JOIN department_master dm ON dm.id = e.department_id
           WHERE spl.run_id = ?
             AND dm.dept_code = 'HR'
             ${branchId ? 'AND e.branch_id = ?' : ''}`,
          qArgs
        );
        const raw = (ctcRows[0] as { total: string | null })?.total;
        hrCtcMap[mo] = raw != null && raw !== '' ? Number(raw) : null;
      }
    }

    // ── QUALITY queries ───────────────────────────────────────────────────────

    // Early attrition: joined in month, left within N days
    const makeAttritionQuery = (minDays: number, maxDays: number) =>
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m') AS mo, COUNT(*) AS cnt
         FROM employees e
         JOIN exit_request er ON er.employee_id = e.id
         WHERE e.date_of_joining >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
           AND DATEDIFF(
             COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed),
             e.date_of_joining
           ) BETWEEN ? AND ?
           ${branchId ? 'AND e.branch_id = ?' : ''}
         GROUP BY mo`,
        branchId ? [minDays, maxDays, branchId] : [minDays, maxDays]
      );

    const [[left30Rows], [left60Rows], [left90Rows]] = await Promise.all([
      makeAttritionQuery(0, 30),
      makeAttritionQuery(31, 60),
      makeAttritionQuery(61, 90),
    ]);

    const left30Map: CellMap = {};
    for (const r of left30Rows) left30Map[r.mo as string] = Number(r.cnt);
    const left60Map: CellMap = {};
    for (const r of left60Rows) left60Map[r.mo as string] = Number(r.cnt);
    const left90Map: CellMap = {};
    for (const r of left90Rows) left90Map[r.mo as string] = Number(r.cnt);

    // Offer accepted but never joined (ghosts) — by month of offer_accepted transition
    const [ghostRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(sl.stage_date, '%Y-%m') AS mo, COUNT(DISTINCT sl.candidate_id) AS cnt
       FROM ats_candidate_stage_log sl
       WHERE sl.to_stage = 'offer_accepted'
         AND sl.stage_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         AND sl.candidate_id NOT IN (
           SELECT candidate_id FROM ats_onboarding_bridge WHERE candidate_id IS NOT NULL
         )
         ${branchId ? 'AND sl.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const ghostMap: CellMap = {};
    for (const r of ghostRows) ghostMap[r.mo as string] = Number(r.cnt);

    // HR screening rejection % = candidates who reached 'shortlisted' then went to 'rejected'/'rejected_by_branch_head'
    //   WITHOUT passing through interview_1
    const [hrRejRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(rej.stage_date, '%Y-%m') AS mo,
              COUNT(DISTINCT rej.candidate_id) AS rejected,
              COUNT(DISTINCT sh.candidate_id) AS shortlisted
       FROM ats_candidate_stage_log sh
       JOIN ats_candidate_stage_log rej ON rej.candidate_id = sh.candidate_id
         AND rej.to_stage IN ('rejected','rejected_by_branch_head')
         AND rej.stage_date > sh.stage_date
       LEFT JOIN ats_candidate_stage_log iv ON iv.candidate_id = sh.candidate_id
         AND iv.to_stage = 'interview_1'
         AND iv.stage_date BETWEEN sh.stage_date AND rej.stage_date
       WHERE sh.to_stage = 'shortlisted'
         AND sh.stage_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         AND iv.candidate_id IS NULL
         ${branchId ? 'AND sh.candidate_id IN (SELECT id FROM ats_candidate WHERE applied_for_branch = ? AND ${EXCLUDE_AC})' : ''}
       GROUP BY mo`,
      branchName ? [branchName] : []
    );
    const hrRejMap: CellMap = {};
    for (const r of hrRejRows) {
      const sh = Number(r.shortlisted);
      hrRejMap[r.mo as string] = sh > 0 ? Math.round((Number(r.rejected) / sh) * 100) : null;
    }

    // ── SPEED queries ─────────────────────────────────────────────────────────

    // Avg days a seat stayed vacant = avg DATEDIFF(fulfilled or NOW, target_joining_date) per month of target
    const [vacancyDaysRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(jr.target_joining_date, '%Y-%m') AS mo,
              ROUND(AVG(DATEDIFF(
                COALESCE(ob.joining_date, CURDATE()),
                jr.target_joining_date
              )), 1) AS avg_days
       FROM job_requisition jr
       LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id IN (
         SELECT id FROM ats_candidate WHERE requisition_id = jr.id
       )
       WHERE jr.target_joining_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         ${branchId ? 'AND jr.branch_id = ?' : ''}
       GROUP BY mo`,
      branchId ? [branchId] : []
    );
    const vacancyDaysMap: CellMap = {};
    for (const r of vacancyDaysRows) vacancyDaysMap[r.mo as string] = Number(r.avg_days) || null;

    // Billing rate per seat per day — pick most recent process_billing_rate for branch's processes
    const billingRateMap: CellMap = {};
    if (branchId) {
      const [brateRows] = await db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(pbr.effective_from, '%Y-%m') AS mo,
                ROUND(AVG(pbr.rate_amount / 30), 2) AS daily_rate
         FROM process_billing_rate pbr
         JOIN process_master pm ON pm.id = pbr.process_id
         WHERE pbr.unit = 'seat'
           AND pm.branch_id = ?
           AND pbr.effective_from >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 MONTH), '%Y-%m-01')
         GROUP BY mo`,
        [branchId]
      );
      for (const r of brateRows) billingRateMap[r.mo as string] = Number(r.daily_rate) || null;
    }

    // Overtime paid from salary_prep_line
    const overtimeMap: CellMap = {};
    for (const mo of months) {
      const [runRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_prep_run WHERE run_month = ? ORDER BY created_at DESC LIMIT 1`, [mo]
      );
      if (runRows.length) {
        const runId = (runRows[0] as { id: string }).id;
        const qArgs: (string | null)[] = [runId];
        if (branchId) qArgs.push(branchId);
        const [otRows] = await db.execute<RowDataPacket[]>(
          `SELECT SUM(spl.overtime_pay) AS total
           FROM salary_prep_line spl
           JOIN employees e ON e.id = spl.employee_id
           WHERE spl.run_id = ?
             ${branchId ? 'AND e.branch_id = ?' : ''}`,
          qArgs
        );
        const rawOt = (otRows[0] as { total: string | null })?.total;
        overtimeMap[mo] = rawOt != null && rawOt !== '' ? Number(rawOt) : null;
      }
    }

    // ── Manual inputs ─────────────────────────────────────────────────────────

    const [manualRows] = await db.execute<RowDataPacket[]>(
      `SELECT period_month, metric_key, value
       FROM bmi_manual_input
       WHERE period_month IN (${months.map(() => '?').join(',')})
         ${branchId ? 'AND branch_id = ?' : ''}`,
      branchId ? [...months, branchId] : months
    );

    const manualMaps: Record<string, CellMap> = {
      hr_hours_week: {},
      ops_hours_week: {},
      tl_hours_week: {},
      sla_penalty: {},
    };
    for (const r of manualRows) {
      const k = r.metric_key as string;
      if (manualMaps[k]) manualMaps[k][r.period_month as string] = Number(r.value);
    }

    // ── Assemble response ─────────────────────────────────────────────────────

    const funnel = [
      buildRow('demand_raised',    'New hires required (demand raised)',       'SOURCING', 'number',   false, demandMap,        months),
      buildRow('sourced_portal',   'Candidates sourced — job portals',         'SOURCING', 'number',   false, sourcedMaps.sourced_portal,   months),
      buildRow('sourced_agency',   'Candidates sourced — consultants',         'SOURCING', 'number',   false, sourcedMaps.sourced_agency,   months),
      buildRow('sourced_referral', 'Candidates sourced — referrals',           'SOURCING', 'number',   false, sourcedMaps.sourced_referral, months),
      buildRow('sourced_walk_in',  'Candidates sourced — walk-ins',            'SOURCING', 'number',   false, sourcedMaps.sourced_walk_in,  months),
      buildRow('screened_hr',      'Screened by HR (calls/interviews done)',   'FUNNEL',   'number',   false, screenedMap,      months),
      buildRow('passed_screening', 'Passed HR screening',                      'FUNNEL',   'number',   false, passedMap,        months),
      buildRow('ops_interview',    'Appeared for ops interview',               'FUNNEL',   'number',   false, interviewMap,     months),
      buildRow('ops_selected',     'Selected by ops',                          'FUNNEL',   'number',   false, selectedMap,      months),
      buildRow('offers_made',      'Offers made',                              'FUNNEL',   'number',   false, offersMadeMap,    months),
      buildRow('offers_accepted',  'Offers accepted',                          'FUNNEL',   'number',   false, offersAccMap,     months),
      buildRow('joined_day1',      'Actually joined day-1',                    'FUNNEL',   'number',   false, joinedMap,        months),
      buildRow('certified',        'Completed training & certified',           'FUNNEL',   'number',   false, {},               months, 'Pending LMS integration (Phase 6)'),
      buildRow('avg_days_demand_join', 'Avg days: demand raised to joining',  'TIME',     'days',     false, avgDaysMap,       months),
      buildRow('avg_days_join_floor',  'Avg days: joining to billable on floor','TIME',   'days',     false, {},               months, 'Pending KPI data population'),
    ];

    const costs = [
      buildRow('portal_cost',      'Job portal cost (Naukri etc.) allocated',  'DIRECT SPEND', 'currency', false, portalCostMap,   months),
      buildRow('consultant_cost',  'Consultant/agency fees paid',              'DIRECT SPEND', 'currency', false, consultCostMap,  months),
      buildRow('referral_bonus',   'Referral bonuses paid',                    'DIRECT SPEND', 'currency', false, refBonusMap,     months),
      buildRow('hr_hours_week',    'HR hours/week on hiring',                  'TIME SPENT',   'hours',    true,  manualMaps.hr_hours_week,  months),
      buildRow('ops_hours_week',   'Ops interviewer hours/week on interviews', 'TIME SPENT',   'hours',    true,  manualMaps.ops_hours_week, months),
      buildRow('tl_hours_week',    'TL/manager hours/week on coordination',    'TIME SPENT',   'hours',    true,  manualMaps.tl_hours_week,  months),
      buildRow('hr_ctc',           'HR monthly CTC (from payroll)',            'SALARY',       'currency', false, hrCtcMap,        months),
    ];

    const quality = [
      buildRow('left_30d',         'Joiners who left within 30 days',          'EARLY ATTRITION', 'number',  false, left30Map,  months),
      buildRow('left_60d',         'Left within 31–60 days',                   'EARLY ATTRITION', 'number',  false, left60Map,  months),
      buildRow('left_90d',         'Left within 61–90 days',                   'EARLY ATTRITION', 'number',  false, left90Map,  months),
      buildRow('cert_pass_pct',    'First-attempt certification pass %',       'PERFORMANCE',     'percent', false, {},         months, 'Pending LMS integration (Phase 6)'),
      buildRow('kpi_30d_pct',      '% meeting floor KPI at 30 days',          'PERFORMANCE',     'percent', false, {},         months, 'No KPI scores found for this period'),
      buildRow('hr_reject_pct',    'HR-screened candidates rejected by ops %', 'SCREENING',      'percent', false, hrRejMap,   months),
      buildRow('ghosts',           'Offer accepted but never joined (ghosts)', 'SCREENING',       'number',  false, ghostMap,   months),
    ];

    const speed = [
      buildRow('vacancy_days',     'Avg days a seat stayed vacant',            'VACANCY', 'days',     false, vacancyDaysMap, months),
      buildRow('billing_rate',     'Billing rate per seat per day (Rs)',       'VACANCY', 'currency', false, billingRateMap, months, branchId ? undefined : 'Select a branch to see billing rate'),
      buildRow('overtime_paid',    'Overtime paid to cover vacancies (Rs)',    'VACANCY', 'currency', false, overtimeMap,   months),
      buildRow('sla_penalty',      'SLA penalties/credits from understaffing', 'VACANCY', 'currency', true,  manualMaps.sla_penalty, months),
    ];

    res.json({ ok: true, data: { months, funnel, costs, quality, speed } });
  } catch (err) {
    console.error('[bmi-benchmark] GET error:', err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST manual input ─────────────────────────────────────────────────────────

bmiBenchmarkRouter.post('/manual', async (req: Request, res: Response) => {
  try {
    const { branch_id, period_month, metric_key, value } = req.body as {
      branch_id: string; period_month: string; metric_key: string; value: number | null;
    };

    const ALLOWED_KEYS = ['hr_hours_week', 'ops_hours_week', 'tl_hours_week', 'sla_penalty'];
    if (!ALLOWED_KEYS.includes(metric_key)) {
      return res.status(400).json({ ok: false, error: 'Invalid metric_key' });
    }
    if (!branch_id || !period_month || !/^\d{4}-\d{2}$/.test(period_month)) {
      return res.status(400).json({ ok: false, error: 'branch_id and period_month (YYYY-MM) are required' });
    }

    const userId = (req as Request & { user?: { id: string } }).user?.id ?? null;

    await db.execute(
      `INSERT INTO bmi_manual_input (id, branch_id, period_month, metric_key, value, updated_by)
       VALUES (UUID(), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [branch_id, period_month, metric_key, value ?? null, userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[bmi-benchmark] POST manual error:', err);
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
