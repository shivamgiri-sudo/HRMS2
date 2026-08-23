import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { workforceMandateService } from "./workforce.mandate.service.js";
import { getHcFormula } from "./hc-formula.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * GET /api/workforce-mandate
 * List mandates with optional query filters.
 * Roles: admin | hr | wfm | process_manager
 */
router.get(
  "/",
  requireRole("admin", "hr", "wfm", "process_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processId, branchId, active } = req.query as Record<string, string>;
    const filters = {
      processId: processId || undefined,
      branchId: branchId || undefined,
      active: active !== undefined ? active === "true" : undefined,
    };
    const data = await workforceMandateService.listMandates(filters);
    return res.json({ data });
  })
);

/**
 * POST /api/workforce-mandate
 * Upsert a mandate record.
 * Roles: admin | hr
 */
router.post(
  "/",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      processId, branchId, roleGroup, hcType, mandatedHc,
      bufferPct, shrinkagePct, attritionBufferPct, trainingBufferPct,
      effectiveFrom, effectiveTo,
    } = req.body as {
      processId?: string; branchId?: string; roleGroup?: string; hcType?: string;
      mandatedHc?: number; bufferPct?: number; shrinkagePct?: number;
      attritionBufferPct?: number; trainingBufferPct?: number;
      effectiveFrom?: string; effectiveTo?: string;
    };

    if (!processId || !roleGroup || !hcType || mandatedHc === undefined || !effectiveFrom) {
      return res.status(400).json({
        error: "processId, roleGroup, hcType, mandatedHc, and effectiveFrom are required",
      });
    }

    const record = await workforceMandateService.upsertMandate(
      {
        processId,
        branchId,
        roleGroup,
        hcType,
        mandatedHc: Number(mandatedHc),
        bufferPct: Number(bufferPct ?? 10),
        shrinkagePct: Number(shrinkagePct ?? 15),
        attritionBufferPct: Number(attritionBufferPct ?? 5),
        trainingBufferPct: Number(trainingBufferPct ?? 5),
        effectiveFrom,
        effectiveTo,
      },
      req.authUser!.id
    );

    return res.json({ data: record });
  })
);

/**
 * GET /api/workforce-mandate/leadership-summary
 * Per-process summary ordered by staffing risk (red first).
 * Roles: admin | hr | ceo
 */
router.get(
  "/leadership-summary",
  requireRole("admin", "hr", "ceo"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await workforceMandateService.getLeadershipSummary();
    return res.json({ data });
  })
);

/**
 * GET /api/workforce-mandate/support-ratios
 * List support role ratio rules.
 * Roles: admin | hr | wfm
 */
router.get(
  "/support-ratios",
  requireRole("admin", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processId } = req.query as { processId?: string };
    const data = await workforceMandateService.getSupportRatios(processId);
    return res.json({ data });
  })
);

/**
 * GET /api/workforce-mandate/capacity/:processId
 * Full capacity snapshot for a process.
 * Roles: admin | hr | wfm | process_manager | ceo
 */
router.get(
  "/capacity/:processId",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processId } = req.params;
    const { branchId } = req.query as { branchId?: string };
    const data = await workforceMandateService.getCapacitySnapshot(processId, branchId);
    return res.json({ data });
  })
);

/**
 * GET /api/workforce-mandate/hc-formula
 * Full BPO HC formula output for active mandates in scope.
 * Query params: processId (optional), branchId (optional)
 * Roles: hr | admin | super_admin | wfm | manager
 */
router.get(
  "/hc-formula",
  requireRole("hr", "admin", "super_admin", "wfm", "manager"),
  (req, res, next) => {
    getHcFormula(req, res).catch(next);
  }
);

/**
 * GET /api/workforce-mandate/capacity-summary
 * Aggregated capacity dashboard summary across all active mandates.
 * Roles: hr | admin | super_admin | wfm | ceo
 */
router.get(
  "/capacity-summary",
  requireRole("hr", "admin", "super_admin", "wfm", "ceo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { branchId } = req.query as { branchId?: string };

    const [mandates] = await (await import("../../db/mysql.js")).db.execute<any[]>(
      `SELECT
         wm.id, wm.process_id, wm.branch_id, wm.mandated_hc,
         wm.shrinkage_pct, wm.attrition_buffer_pct, wm.training_buffer_pct,
         p.process_name, b.branch_name
       FROM workforce_mandate wm
       LEFT JOIN process_master p ON p.id = wm.process_id
       LEFT JOIN branch_master b ON b.id = wm.branch_id
       WHERE wm.active_status = 1
         ${branchId ? 'AND wm.branch_id = ?' : ''}`,
      branchId ? [branchId] : []
    );

    const { db } = await import("../../db/mysql.js");

    // Aggregate live HC counts
    const [activeRows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS cnt FROM employees WHERE active_status = 1 ${branchId ? 'AND branch_id = ?' : ''}`,
      branchId ? [branchId] : []
    );
    const [onNoticeRows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS cnt FROM exit_request er
       JOIN employees e ON er.employee_id = e.id
       WHERE er.status IN ('accepted','notice_serving') ${branchId ? 'AND e.branch_id = ?' : ''}`,
      branchId ? [branchId] : []
    );
    const [longLeaveRows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS cnt FROM leave_request lr
       JOIN employees e ON lr.employee_id = e.id
       WHERE lr.status = 'approved' AND lr.to_date >= CURDATE() AND lr.total_days >= 5
       ${branchId ? 'AND e.branch_id = ?' : ''}`,
      branchId ? [branchId] : []
    );
    const [inTrainingRows] = await db.execute<any[]>(
      `SELECT COUNT(*) AS cnt FROM ats_candidate
       WHERE current_stage IN ('Applied','Screened','Selected','Onboarding')`,
      []
    );

    const activeHc = Number(activeRows[0]?.cnt ?? 0);
    const onNoticeHc = Number(onNoticeRows[0]?.cnt ?? 0);
    const longLeaveHc = Number(longLeaveRows[0]?.cnt ?? 0);
    const inTrainingHc = Number(inTrainingRows[0]?.cnt ?? 0);
    const availableProductionHc = Math.max(0, activeHc - onNoticeHc - longLeaveHc - inTrainingHc);

    // Aggregate mandate totals
    const totalMandatedHc = mandates.reduce((s: number, m: any) => s + Number(m.mandated_hc || 0), 0);
    const avgShrinkage = mandates.length > 0
      ? mandates.reduce((s: number, m: any) => s + Number(m.shrinkage_pct || 15), 0) / mandates.length
      : 15;
    const avgAttritionBuffer = mandates.length > 0
      ? mandates.reduce((s: number, m: any) => s + Number(m.attrition_buffer_pct || 5), 0) / mandates.length
      : 5;
    const avgTrainingBuffer = mandates.length > 0
      ? mandates.reduce((s: number, m: any) => s + Number(m.training_buffer_pct || 5), 0) / mandates.length
      : 5;

    // BPO formula
    const denominator = 1 - avgAttritionBuffer / 100 - avgTrainingBuffer / 100;
    const safeDenom = denominator > 0 ? denominator : 0.01;
    const requiredStaffedHc = Math.round(totalMandatedHc * (1 + avgShrinkage / 100) / safeDenom);
    const netGap = requiredStaffedHc - availableProductionHc;
    const hiringDemand = Math.max(0, netGap) + onNoticeHc;
    const coveragePct = requiredStaffedHc > 0 ? Math.round((availableProductionHc / requiredStaffedHc) * 100) : 100;

    // Per-process breakdown for hiring demand
    const hiringByProcess = mandates.map((m: any) => {
      const mandatedHc = Number(m.mandated_hc || 0);
      const shrinkage = Number(m.shrinkage_pct || 15);
      const attrition = Number(m.attrition_buffer_pct || 5);
      const training = Number(m.training_buffer_pct || 5);
      const denom = 1 - attrition / 100 - training / 100;
      const required = Math.round(mandatedHc * (1 + shrinkage / 100) / (denom > 0 ? denom : 0.01));
      return {
        processId: m.process_id,
        processName: m.process_name,
        branchName: m.branch_name,
        mandatedHc,
        requiredHc: required,
        priority: mandatedHc >= 50 ? 'HIGH' : mandatedHc >= 20 ? 'MEDIUM' : 'LOW',
      };
    }).sort((a: any, b: any) => b.requiredHc - a.requiredHc);

    return res.json({
      summary: {
        totalMandatedHc,
        requiredStaffedHc,
        activeHc,
        onNoticeHc,
        longLeaveHc,
        inTrainingHc,
        availableProductionHc,
        netGap,
        hiringDemand,
        coveragePct,
        riskSignal: coveragePct >= 95 ? 'green' : coveragePct >= 80 ? 'amber' : 'red',
      },
      formula: {
        mandatedHc: totalMandatedHc,
        shrinkagePct: Math.round(avgShrinkage * 10) / 10,
        attritionBufferPct: Math.round(avgAttritionBuffer * 10) / 10,
        trainingBufferPct: Math.round(avgTrainingBuffer * 10) / 10,
      },
      hiringByProcess,
    });
  })
);

export { router as workforceMandateRouter };
