import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MandateRecord {
  id: string;
  process_id: string;
  branch_id: string;
  role_group: string;
  hc_type: string;
  mandated_hc: number;
  buffer_pct: number;
  shrinkage_pct: number;
  attrition_buffer_pct: number;
  training_buffer_pct: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
}

export interface CapacitySnapshot {
  mandate: MandateRecord;
  target_hc: number;
  active_eligible_hc: number;
  on_notice_hc: number;
  long_leave_hc: number;
  training_pipeline: number;
  certified_pending_deployment: number;
  joining_confirmed: number;
  active_production: number;
  support_staff_split: Record<string, number>;
  shortage_surplus: number;
  buffer_coverage_pct: number;
  staffing_risk: "green" | "amber" | "red";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRisk(coveragePct: number): "green" | "amber" | "red" {
  if (coveragePct >= 95) return "green";
  if (coveragePct >= 80) return "amber";
  return "red";
}

function toNum(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const workforceMandateService = {
  /**
   * List mandates with optional filters.
   */
  async listMandates(filters: {
    processId?: string;
    branchId?: string;
    active?: boolean;
  }): Promise<RowDataPacket[]> {
    const conds = ["1=1"];
    const params: unknown[] = [];

    if (filters.processId) {
      conds.push("wm.process_id = ?");
      params.push(filters.processId);
    }
    if (filters.branchId) {
      conds.push("wm.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.active !== undefined) {
      conds.push("wm.active_status = ?");
      params.push(filters.active ? 1 : 0);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT wm.*,
              p.process_name,
              b.branch_name
       FROM workforce_mandate wm
       LEFT JOIN process_master p ON p.id = wm.process_id
       LEFT JOIN branch_master b ON b.id = wm.branch_id
       WHERE ${conds.join(" AND ")}
       ORDER BY wm.effective_from DESC, wm.role_group ASC
       LIMIT 500`,
      params
    );
    return rows as RowDataPacket[];
  },

  /**
   * Upsert a mandate record (INSERT ON DUPLICATE KEY UPDATE).
   */
  async upsertMandate(
    input: {
      processId: string;
      branchId?: string;
      roleGroup: string;
      hcType: string;
      mandatedHc: number;
      bufferPct: number;
      shrinkagePct: number;
      attritionBufferPct: number;
      trainingBufferPct: number;
      effectiveFrom: string;
      effectiveTo?: string;
    },
    userId: string
  ): Promise<RowDataPacket> {
    const id = randomUUID();
    const branchId = input.branchId ?? null;
    const effectiveTo = input.effectiveTo ?? null;

    await db.execute(
      `INSERT INTO workforce_mandate
         (id, process_id, branch_id, role_group, hc_type, mandated_hc,
          buffer_pct, shrinkage_pct, attrition_buffer_pct, training_buffer_pct,
          effective_from, effective_to, active_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         hc_type               = VALUES(hc_type),
         mandated_hc           = VALUES(mandated_hc),
         buffer_pct            = VALUES(buffer_pct),
         shrinkage_pct         = VALUES(shrinkage_pct),
         attrition_buffer_pct  = VALUES(attrition_buffer_pct),
         training_buffer_pct   = VALUES(training_buffer_pct),
         effective_to          = VALUES(effective_to),
         active_status         = 1,
         created_by            = VALUES(created_by)`,
      [
        id,
        input.processId,
        branchId,
        input.roleGroup,
        input.hcType,
        input.mandatedHc,
        input.bufferPct,
        input.shrinkagePct,
        input.attritionBufferPct,
        input.trainingBufferPct,
        input.effectiveFrom,
        effectiveTo,
        userId,
      ]
    );

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "WORKFORCE_MANDATE_UPSERTED",
      module_key: "WORKFORCE_MANDATE",
      entity_type: "workforce_mandate",
      entity_id: input.processId,
      change_summary: { role_group: input.roleGroup, mandated_hc: input.mandatedHc },
    });

    // Fetch actual row (ON DUPLICATE KEY may have returned existing id)
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM workforce_mandate
       WHERE process_id = ? AND (branch_id <=> ?) AND role_group = ? AND effective_from = ?
       LIMIT 1`,
      [input.processId, branchId, input.roleGroup, input.effectiveFrom]
    );
    return (rows as RowDataPacket[])[0];
  },

  /**
   * Build a capacity snapshot for each matching mandate.
   */
  async getCapacitySnapshot(
    processId: string,
    branchId?: string
  ): Promise<CapacitySnapshot[]> {
    // 1. Fetch mandates
    const mandateConds = ["wm.process_id = ?", "wm.active_status = 1"];
    const mandateParams: unknown[] = [processId];
    if (branchId) {
      mandateConds.push("wm.branch_id = ?");
      mandateParams.push(branchId);
    }

    const [mandateRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM workforce_mandate WHERE ${mandateConds.join(" AND ")}`,
      mandateParams
    );
    const mandates = mandateRows as MandateRecord[];

    if (mandates.length === 0) return [];

    // 2. Live counts (all scoped to processId + optional branchId)
    const branchCond = branchId ? " AND e.branch_id = ?" : "";
    const branchParams: unknown[] = branchId ? [branchId] : [];

    // active_eligible_hc
    const [activeRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM employees e
       WHERE e.process_id = ?${branchCond} AND LOWER(e.employment_status) = 'active'`,
      [processId, ...branchParams]
    );
    const activeEligibleHc = toNum((activeRows as RowDataPacket[])[0]?.cnt);

    // on_notice_hc — exit_request joined to employees for process scope
    const [noticeRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       WHERE e.process_id = ?${branchCond}
         AND er.status IN ('accepted','notice_serving')`,
      [processId, ...branchParams]
    );
    const onNoticeHc = toNum((noticeRows as RowDataPacket[])[0]?.cnt);

    // long_leave_hc — approved leaves >= 5 days still ongoing today
    const [llRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id
       WHERE e.process_id = ?${branchCond}
         AND lr.status = 'approved'
         AND lr.to_date >= CURDATE()
         AND lr.total_days >= 5`,
      [processId, ...branchParams]
    );
    const longLeaveHc = toNum((llRows as RowDataPacket[])[0]?.cnt);

    // training_pipeline — candidates who applied for this process
    const [pipelineRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM ats_candidate ac
       WHERE ac.applied_for_process = ?
         AND ac.current_stage IN ('Applied','Screened','Selected','Onboarding')`,
      [processId]
    );
    const trainingPipeline = toNum((pipelineRows as RowDataPacket[])[0]?.cnt);

    // joining_confirmed — last 30 days
    const [joiningRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM ats_onboarding_bridge aob
       JOIN employees e ON e.id = aob.employee_id
       WHERE e.process_id = ?${branchCond}
         AND aob.status = 'joined'
         AND aob.bridge_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [processId, ...branchParams]
    );
    const joiningConfirmed = toNum((joiningRows as RowDataPacket[])[0]?.cnt);

    // support_staff_split — fetch ratios then count matching employees
    const [ratioRows] = await db.execute<RowDataPacket[]>(
      `SELECT support_role, ratio_value, ratio_type
       FROM support_role_ratio
       WHERE (process_id = ? OR process_id IS NULL)
         AND active_status = 1
       ORDER BY process_id DESC`,
      [processId]
    );

    const supportSplit: Record<string, number> = {};
    for (const ratio of ratioRows as RowDataPacket[]) {
      const role = ratio.support_role as string;
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM employees e
         WHERE e.process_id = ?${branchCond}
           AND LOWER(e.employment_status) = 'active'
           AND e.designation_name = ?`,
        [processId, ...branchParams, role]
      );
      supportSplit[role] = toNum((empRows as RowDataPacket[])[0]?.cnt);
    }

    // 3. Build snapshot per mandate
    const snapshots: CapacitySnapshot[] = mandates.map((mandate) => {
      const targetHc =
        mandate.mandated_hc *
        (1 + mandate.buffer_pct / 100 + mandate.shrinkage_pct / 100);

      const shortageOrSurplus = activeEligibleHc - targetHc;
      const coveragePct = targetHc > 0 ? (activeEligibleHc / targetHc) * 100 : 0;

      return {
        mandate,
        target_hc: Math.round(targetHc * 100) / 100,
        active_eligible_hc: activeEligibleHc,
        on_notice_hc: onNoticeHc,
        long_leave_hc: longLeaveHc,
        training_pipeline: trainingPipeline,
        certified_pending_deployment: 0, // LMS not wired yet
        joining_confirmed: joiningConfirmed,
        active_production: activeEligibleHc,
        support_staff_split: supportSplit,
        shortage_surplus: Math.round(shortageOrSurplus * 100) / 100,
        buffer_coverage_pct: Math.round(coveragePct * 100) / 100,
        staffing_risk: computeRisk(coveragePct),
      };
    });

    return snapshots;
  },

  /**
   * Per-process leadership summary, red first.
   */
  async getLeadershipSummary(): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         p.id         AS process_id,
         p.process_name,
         SUM(wm.mandated_hc) AS mandated_hc,
         COUNT(DISTINCT e.id) AS active_hc,
         (COUNT(DISTINCT e.id) - SUM(wm.mandated_hc * (1 + wm.buffer_pct/100 + wm.shrinkage_pct/100))) AS shortage_surplus,
         CASE
           WHEN SUM(wm.mandated_hc * (1 + wm.buffer_pct/100 + wm.shrinkage_pct/100)) = 0 THEN 'red'
           WHEN (COUNT(DISTINCT e.id) / SUM(wm.mandated_hc * (1 + wm.buffer_pct/100 + wm.shrinkage_pct/100))) >= 0.95 THEN 'green'
           WHEN (COUNT(DISTINCT e.id) / SUM(wm.mandated_hc * (1 + wm.buffer_pct/100 + wm.shrinkage_pct/100))) >= 0.80 THEN 'amber'
           ELSE 'red'
         END AS staffing_risk
       FROM workforce_mandate wm
       LEFT JOIN process_master p ON p.id = wm.process_id
       LEFT JOIN employees e
         ON e.process_id = wm.process_id AND LOWER(e.employment_status) = 'active'
       WHERE wm.active_status = 1
       GROUP BY p.id, p.process_name
       ORDER BY
         FIELD(staffing_risk, 'red', 'amber', 'green'),
         p.process_name ASC`
    );
    return rows as RowDataPacket[];
  },

  /**
   * List support role ratios, optionally filtered by process.
   */
  async getSupportRatios(processId?: string): Promise<RowDataPacket[]> {
    const conds = ["active_status = 1"];
    const params: unknown[] = [];
    if (processId) {
      conds.push("(process_id = ? OR process_id IS NULL)");
      params.push(processId);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM support_role_ratio
       WHERE ${conds.join(" AND ")}
       ORDER BY support_role, process_id IS NULL`,
      params
    );
    return rows as RowDataPacket[];
  },
};
