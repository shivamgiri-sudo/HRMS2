import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeRiskSignal(coveragePct: number): "green" | "amber" | "red" {
  if (coveragePct >= 95) return "green";
  if (coveragePct >= 80) return "amber";
  return "red";
}

// ── HC Formula output shape ───────────────────────────────────────────────────

interface HcFormulaResult {
  scope: {
    process_id: string | null;
    process_name: string | null;
    branch_id: string | null;
    branch_name: string | null;
  };
  mandate: {
    mandate_id: string;
    mandated_hc: number;
    shrinkage_pct: number;
    attrition_buffer_pct: number;
    training_buffer_pct: number;
    effective_from: string;
  };
  derived_live: {
    rolling_30d_attrition_rate: number;
    rolling_60d_shrinkage_pct: number;
  };
  formula_output: {
    required_staffed_hc: number;
    active_hc: number;
    on_notice_hc: number;
    long_leave_hc: number;
    in_training_hc: number;
    available_production_hc: number;
    net_gap: number;
    hiring_demand: number;
    coverage_pct: number;
    risk_signal: "green" | "amber" | "red";
  };
}

// ── Live counter queries ──────────────────────────────────────────────────────

async function fetchActiveHc(processId: string, branchId: string | null): Promise<number> {
  const conds = ["e.process_id = ?", "e.active_status = 1"];
  const params: unknown[] = [processId];
  if (branchId) {
    conds.push("e.branch_id = ?");
    params.push(branchId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM employees e WHERE ${conds.join(" AND ")}`,
    params
  );
  return toNum((rows as RowDataPacket[])[0]?.cnt);
}

async function fetchOnNoticeHc(processId: string, branchId: string | null): Promise<number> {
  const branchCond = branchId ? " AND e.branch_id = ?" : "";
  const params: unknown[] = [processId, ...(branchId ? [branchId] : [])];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM exit_request er
     JOIN employees e ON e.id = er.employee_id
     WHERE e.process_id = ?${branchCond}
       AND er.status IN ('accepted', 'notice_serving')`,
    params
  );
  return toNum((rows as RowDataPacket[])[0]?.cnt);
}

async function fetchLongLeaveHc(processId: string, branchId: string | null): Promise<number> {
  const branchCond = branchId ? " AND e.branch_id = ?" : "";
  const params: unknown[] = [processId, ...(branchId ? [branchId] : [])];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM leave_request lr
     JOIN employees e ON e.id = lr.employee_id
     WHERE e.process_id = ?${branchCond}
       AND lr.status = 'approved'
       AND lr.to_date >= CURDATE()
       AND lr.total_days >= 5`,
    params
  );
  return toNum((rows as RowDataPacket[])[0]?.cnt);
}

async function fetchInTrainingHc(processId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM ats_candidate
     WHERE applied_for_process = ?
       AND current_stage IN ('Applied', 'Screened', 'Selected', 'Onboarding')`,
    [processId]
  );
  return toNum((rows as RowDataPacket[])[0]?.cnt);
}

/**
 * rolling_30d_attrition_rate:
 *   COUNT(exits in last 30 days in scope) / active_hc × 100
 */
async function fetchRolling30dAttritionRate(
  processId: string,
  branchId: string | null,
  activeHc: number
): Promise<number> {
  if (activeHc === 0) return 0;
  const branchCond = branchId ? " AND e.branch_id = ?" : "";
  const params: unknown[] = [processId, ...(branchId ? [branchId] : [])];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM employees e
     WHERE e.process_id = ?${branchCond}
       AND e.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       AND e.date_of_exit IS NOT NULL`,
    params
  );
  const exits = toNum((rows as RowDataPacket[])[0]?.cnt);
  return round2((exits / activeHc) * 100);
}

/**
 * rolling_60d_shrinkage_pct:
 *   (emp_days - present_days - half_day_days - week_off_worked_days)
 *   / emp_days × 100
 *   using attendance_daily_record for last 60 days in scope.
 *
 * Falls back to the mandate's shrinkage_pct if no attendance data exists.
 */
async function fetchRolling60dShrinkagePct(
  processId: string,
  branchId: string | null,
  fallbackShrinkagePct: number
): Promise<number> {
  const branchCond = branchId ? " AND e.branch_id = ?" : "";
  const params: unknown[] = [processId, ...(branchId ? [branchId] : [])];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                         AS emp_days,
       SUM(CASE WHEN adr.status IN ('P','present')               THEN 1 ELSE 0 END) AS present_days,
       SUM(CASE WHEN adr.status IN ('HD','half_day')              THEN 0.5 ELSE 0 END) AS half_day_days,
       SUM(CASE WHEN adr.status IN ('WW','week_off_worked')        THEN 1 ELSE 0 END) AS wow_days
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     WHERE e.process_id = ?${branchCond}
       AND adr.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)`,
    params
  );
  const r = (rows as RowDataPacket[])[0];
  const empDays = toNum(r?.emp_days);
  if (empDays === 0) return fallbackShrinkagePct;

  const presentDays = toNum(r?.present_days);
  const halfDayDays = toNum(r?.half_day_days);
  const wowDays = toNum(r?.wow_days);
  const productive = presentDays + halfDayDays + wowDays;
  const shrinkageDays = empDays - productive;
  return round2((shrinkageDays / empDays) * 100);
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/workforce-mandate/hc-formula
 * Query params: processId (optional), branchId (optional)
 *
 * Returns BPO HC formula output for each active mandate in scope.
 * If no processId given, returns all active mandates.
 */
export async function getHcFormula(req: Request, res: Response): Promise<Response> {
  const { processId, branchId } = req.query as Record<string, string>;

  try {
    // ── Fetch active mandates in scope ────────────────────────────────────────
    const conds = ["wm.active_status = 1"];
    const params: unknown[] = [];

    if (processId) {
      conds.push("wm.process_id = ?");
      params.push(processId);
    }
    if (branchId) {
      conds.push("wm.branch_id = ?");
      params.push(branchId);
    }

    const [mandateRows] = await db.execute<RowDataPacket[]>(
      `SELECT wm.*,
              p.process_name,
              b.branch_name
       FROM workforce_mandate wm
       LEFT JOIN process_master p ON p.id = wm.process_id
       LEFT JOIN branch_master b  ON b.id = wm.branch_id
       WHERE ${conds.join(" AND ")}
       ORDER BY wm.effective_from DESC, wm.process_id ASC`,
      params
    );
    const mandates = mandateRows as RowDataPacket[];

    if (mandates.length === 0) {
      return res.json({ data: [], message: "No active mandates found for scope" });
    }

    // ── Compute formula for each mandate ──────────────────────────────────────
    const results: HcFormulaResult[] = await Promise.all(
      mandates.map(async (m): Promise<HcFormulaResult> => {
        const pid = String(m.process_id);
        const bid = m.branch_id ? String(m.branch_id) : null;

        const mandatedHc      = toNum(m.mandated_hc);
        const shrinkagePct    = toNum(m.shrinkage_pct);
        const attritionBufPct = toNum(m.attrition_buffer_pct);
        const trainingBufPct  = toNum(m.training_buffer_pct);

        // Live counts (run in parallel for performance)
        const [
          activeHc,
          onNoticeHc,
          longLeaveHc,
          inTrainingHc,
        ] = await Promise.all([
          fetchActiveHc(pid, bid),
          fetchOnNoticeHc(pid, bid),
          fetchLongLeaveHc(pid, bid),
          fetchInTrainingHc(pid),
        ]);

        // Derived rates (depend on activeHc for attrition denominator)
        const [rolling30dAttrition, rolling60dShrinkage] = await Promise.all([
          fetchRolling30dAttritionRate(pid, bid, activeHc),
          fetchRolling60dShrinkagePct(pid, bid, shrinkagePct),
        ]);

        // ── BPO formula ───────────────────────────────────────────────────────
        // Required Staffed HC = mandated_hc × (1 + shrinkage/100) / (1 - attrition/100 - training/100)
        const denominator = 1 - attritionBufPct / 100 - trainingBufPct / 100;
        const safeDenominator = denominator > 0 ? denominator : 0.01; // guard division by zero
        const requiredStaffedHc = round2(mandatedHc * (1 + shrinkagePct / 100) / safeDenominator);

        // Available Production HC = active_hc - on_notice_hc - long_leave_hc - in_training_hc
        const availableProductionHc = Math.max(
          0,
          activeHc - onNoticeHc - longLeaveHc - inTrainingHc
        );

        const netGap = round2(requiredStaffedHc - availableProductionHc);

        // Hiring Demand = MAX(0, Net Gap) + on_notice_hc
        const hiringDemand = round2(Math.max(0, netGap) + onNoticeHc);

        // Coverage Pct = Available Production HC / Required Staffed HC × 100
        const coveragePct =
          requiredStaffedHc > 0
            ? round2((availableProductionHc / requiredStaffedHc) * 100)
            : 0;

        return {
          scope: {
            process_id: pid,
            process_name: m.process_name ? String(m.process_name) : null,
            branch_id: bid,
            branch_name: m.branch_name ? String(m.branch_name) : null,
          },
          mandate: {
            mandate_id: String(m.id),
            mandated_hc: mandatedHc,
            shrinkage_pct: shrinkagePct,
            attrition_buffer_pct: attritionBufPct,
            training_buffer_pct: trainingBufPct,
            effective_from: m.effective_from
              ? new Date(m.effective_from).toISOString().slice(0, 10)
              : String(m.effective_from),
          },
          derived_live: {
            rolling_30d_attrition_rate: rolling30dAttrition,
            rolling_60d_shrinkage_pct: rolling60dShrinkage,
          },
          formula_output: {
            required_staffed_hc: requiredStaffedHc,
            active_hc: activeHc,
            on_notice_hc: onNoticeHc,
            long_leave_hc: longLeaveHc,
            in_training_hc: inTrainingHc,
            available_production_hc: availableProductionHc,
            net_gap: netGap,
            hiring_demand: hiringDemand,
            coverage_pct: coveragePct,
            risk_signal: computeRiskSignal(coveragePct),
          },
        };
      })
    );

    return res.json({ data: results });
  } catch (err: unknown) {
    console.error("[hc-formula] getHcFormula error:", err);
    return res.status(500).json({ error: "Failed to compute HC formula" });
  }
}
