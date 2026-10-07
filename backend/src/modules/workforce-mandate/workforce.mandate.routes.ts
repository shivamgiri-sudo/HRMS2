import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { workforceMandateService } from "./workforce.mandate.service.js";
import { getHcFormula } from "./hc-formula.service.js";
import { lmsDb } from "../../db/lms-mysql.js";
import type { RowDataPacket } from "mysql2";
import { lookupLobNames } from "../../shared/lobNames.js";
import {
  assertScopedAccessOrThrow,
  hasAnyRole,
} from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Roles allowed to CHANGE a mandate. Org-wide roles edit anything; the scoped roles are held to
 * their own branch/process through user_assignment_scope (same rule as roster publication).
 */
const MANDATE_EDIT_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "finance_head",
  "finance",
  "process_manager",
  "branch_admin",
  "branch_head",
  "operations_manager",
  "branch_wfm",
];
const MANDATE_ORG_WIDE_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "finance_head",
  "finance",
];

async function assertCanEditMandate(
  userId: string,
  target: { branchId?: string | null; processId?: string | null },
) {
  if (await hasAnyRole(userId, ...MANDATE_ORG_WIDE_ROLES)) return;
  await assertScopedAccessOrThrow(
    userId,
    MANDATE_EDIT_ROLES,
    target,
    "Forbidden: you can only change mandates for your own branch/process",
  );
}

const router = Router();

// 30s in-memory cache of the (user-independent) capacity payload, per branch filter. Mandate
// edits clear it so the editor sees their change immediately.
const capacityCache = new Map<string, { at: number; body: unknown }>();
const CAPACITY_TTL_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}
const h = (fn: Function) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

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
  }),
);

/**
 * POST /api/workforce-mandate
 * Upsert a mandate record.
 * Roles: MANDATE_EDIT_ROLES (scoped roles limited to their own branch/process)
 */
router.post(
  "/",
  requireRole(...MANDATE_EDIT_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      processId,
      branchId,
      roleGroup,
      hcType,
      mandatedHc,
      bufferPct,
      shrinkagePct,
      attritionBufferPct,
      trainingBufferPct,
      effectiveFrom,
      effectiveTo,
    } = req.body as {
      processId?: string;
      branchId?: string;
      roleGroup?: string;
      hcType?: string;
      mandatedHc?: number;
      bufferPct?: number;
      shrinkagePct?: number;
      attritionBufferPct?: number;
      trainingBufferPct?: number;
      effectiveFrom?: string;
      effectiveTo?: string;
    };

    if (
      !processId ||
      !roleGroup ||
      !hcType ||
      mandatedHc === undefined ||
      !effectiveFrom
    ) {
      return res.status(400).json({
        error:
          "processId, roleGroup, hcType, mandatedHc, and effectiveFrom are required",
      });
    }

    await assertCanEditMandate(req.authUser!.id, {
      branchId: branchId ?? null,
      processId,
    });
    capacityCache.clear();

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
      req.authUser!.id,
    );

    return res.json({ data: record });
  }),
);

/**
 * PATCH /api/workforce-mandate/:id
 * Change headcount / buffers of an existing mandate (e.g. client revised the mandate).
 * A reason is mandatory and the before/after values are audited.
 */
router.patch(
  "/:id",
  requireRole(...MANDATE_EDIT_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      mandatedHc,
      shrinkagePct,
      attritionBufferPct,
      trainingBufferPct,
      reason,
    } = req.body as Record<string, unknown>;
    const reasonText = String(reason ?? "").trim();
    if (reasonText.length < 3)
      return res.status(400).json({ error: "reason is required" });

    const pct = (v: unknown) =>
      v === undefined || v === null || v === "" ? undefined : Number(v);
    const next = {
      mandated_hc: pct(mandatedHc),
      shrinkage_pct: pct(shrinkagePct),
      attrition_buffer_pct: pct(attritionBufferPct),
      training_buffer_pct: pct(trainingBufferPct),
    };
    if (
      next.mandated_hc === undefined &&
      next.shrinkage_pct === undefined &&
      next.attrition_buffer_pct === undefined &&
      next.training_buffer_pct === undefined
    ) {
      return res.status(400).json({ error: "nothing to update" });
    }
    if (
      next.mandated_hc !== undefined &&
      (!Number.isInteger(next.mandated_hc) ||
        next.mandated_hc < 0 ||
        next.mandated_hc > 100000)
    ) {
      return res
        .status(400)
        .json({
          error: "mandatedHc must be a whole number between 0 and 100000",
        });
    }
    for (const k of [
      "shrinkage_pct",
      "attrition_buffer_pct",
      "training_buffer_pct",
    ] as const) {
      const v = next[k];
      if (v !== undefined && (!Number.isFinite(v) || v < 0 || v >= 50)) {
        return res.status(400).json({ error: `${k} must be between 0 and 50` });
      }
    }

    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute<any[]>(
      `SELECT id, process_id, branch_id, role_group, mandated_hc, shrinkage_pct, attrition_buffer_pct, training_buffer_pct
         FROM workforce_mandate WHERE id = ? AND active_status = 1 LIMIT 1`,
      [req.params.id],
    );
    const before = rows[0];
    if (!before) return res.status(404).json({ error: "Mandate not found" });

    await assertCanEditMandate(req.authUser!.id, {
      branchId: before.branch_id,
      processId: before.process_id,
    });

    await db.execute(
      `UPDATE workforce_mandate SET
         mandated_hc          = COALESCE(?, mandated_hc),
         shrinkage_pct        = COALESCE(?, shrinkage_pct),
         attrition_buffer_pct = COALESCE(?, attrition_buffer_pct),
         training_buffer_pct  = COALESCE(?, training_buffer_pct)
       WHERE id = ?`,
      [
        next.mandated_hc ?? null,
        next.shrinkage_pct ?? null,
        next.attrition_buffer_pct ?? null,
        next.training_buffer_pct ?? null,
        req.params.id,
      ],
    );

    capacityCache.clear();
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "WORKFORCE_MANDATE_UPDATED",
      module_key: "WORKFORCE_MANDATE",
      entity_type: "workforce_mandate",
      entity_id: String(req.params.id),
      reason: reasonText,
      change_summary: {
        process_id: before.process_id,
        before: {
          mandated_hc: before.mandated_hc,
          shrinkage_pct: before.shrinkage_pct,
          attrition_buffer_pct: before.attrition_buffer_pct,
          training_buffer_pct: before.training_buffer_pct,
        },
        after: next,
      },
    });

    return res.json({ data: { id: req.params.id, ...next } });
  }),
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
  }),
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
  }),
);

/**
 * GET /api/workforce-mandate/capacity/:processId
 * Full capacity snapshot for a process.
 * Roles: admin | hr | wfm | process_manager | ceo
 */
router.get(
  "/capacity/:processId",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req: AuthenticatedRequest & Request, res: Response) => {
    const { processId } = req.params;
    const { branchId } = req.query as { branchId?: string };
    const data = await workforceMandateService.getCapacitySnapshot(
      processId,
      branchId,
    );
    return res.json({ data });
  }),
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
  },
);

/**
 * GET /api/workforce-mandate/capacity-summary
 * Aggregated capacity dashboard summary across all active mandates.
 *
 * Read-only: this endpoint aggregates and returns, it writes nothing.
 *
 * The role list matches the grants on the WFM_CAPACITY_DASHBOARD page code exactly
 * (migration 1688). The two MUST stay in step: a role granted the page but refused here gets a
 * dashboard that loads and then errors, which reads as a broken product rather than as a denied
 * permission. Widened from hr|admin|super_admin|wfm|ceo so branch and process leadership,
 * Training & Quality and the WFM roles who are the page's actual audience can read their own
 * capacity numbers, rather than only HR and the executive.
 *
 * Note this reaches people by ROLE only. Operations staff who hold just the 'employee' role -
 * Team Leaders, Data Analysts, RTMs - cannot be admitted here without also admitting every
 * Operations EXECUTIVE, since they share that role. Their access is a per-person grant.
 */
router.get(
  "/capacity-summary",
  requireRole(
    "hr",
    "admin",
    "super_admin",
    "wfm",
    "ceo",
    "branch_wfm",
    "branch_head",
    "process_manager",
    "manager",
    "assistant_manager",
    "team_leader",
    "tl",
    "tq_head",
    "trainer",
    "qa",
    "finance_head",
    "finance",
    "branch_admin",
    "operations_manager",
    // Designation-based audience that no existing role can express - see migration 1689.
    "capacity_viewer",
  ),
  h(async (req: AuthenticatedRequest & Request, res: Response) => {
    const { branchId } = req.query as { branchId?: string };
    const cacheKey = branchId ?? "__all__";
    const hit = capacityCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CAPACITY_TTL_MS) return res.json(hit.body);

    const [mandates] = await (
      await import("../../db/mysql.js")
    ).db.execute<any[]>(
      `SELECT
         wm.id, wm.process_id, wm.branch_id, wm.mandated_hc,
         wm.shrinkage_pct, wm.attrition_buffer_pct, wm.training_buffer_pct,
         p.process_name, b.branch_name
       FROM workforce_mandate wm
       LEFT JOIN process_master p ON p.id = wm.process_id
       LEFT JOIN branch_master b ON b.id = wm.branch_id
       WHERE wm.active_status = 1
         ${branchId ? "AND wm.branch_id = ?" : ""}`,
      branchId ? [branchId] : [],
    );

    const { db } = await import("../../db/mysql.js");

    // Mandated headcount is an Ops-Executive seat count (role_group='all', hc_type='production'),
    // not "everyone on the process" — TLs/QA/Managers/Trainers hold separate headcount.
    // "Executive Operations profile" (migration 1082): designation REGEXP '^executive( *-.*)?$'
    // AND department = OPERATIONS, plus DATA-ANALYST without a dept gate (GS1 ruling 2026-09-04).
    const PROD_SEAT_SQL = `(
      (LOWER(TRIM(d.designation_name)) REGEXP '^executive( *- *.+)?$'
        AND UPPER(COALESCE(dept.dept_name,'')) = 'OPERATIONS')
      OR d.designation_name = 'DATA-ANALYST'
    )`;
    const processIds = Array.from(
      new Set(mandates.map((m: any) => String(m.process_id))),
    );

    // Read-only breakdown of the same active production seats by LOB (employees.lob_id). Mandates are
    // per process/branch and are NOT LOB-keyed, so this is informational and changes no total above.
    // LOB names come from a separate parameterised lookup (never a JOIN: mixed collations).
    let headcountByLob: Array<{
      lobId: string | null;
      lobName: string | null;
      activeHc: number;
    }> = [];
    const lobTask = (async () => {
      if (processIds.length > 0) {
        try {
          const [lobRows] = await db.query<any[]>(
            `SELECT e.lob_id AS lob_id, COUNT(*) AS cnt FROM employees e
           JOIN designation_master d   ON d.id    = e.designation_id
           LEFT JOIN department_master dept ON dept.id = e.department_id
           WHERE e.active_status = 1 AND ${PROD_SEAT_SQL} AND e.process_id IN (?)
           ${branchId ? "AND e.branch_id = ?" : ""}
           GROUP BY e.lob_id`,
            branchId ? [processIds, branchId] : [processIds],
          );
          const lobNames = await lookupLobNames(
            (lobRows ?? []).map((r: any) =>
              r.lob_id ? String(r.lob_id) : null,
            ),
          );
          headcountByLob = (lobRows ?? [])
            .map((r: any) => ({
              lobId: r.lob_id ? String(r.lob_id) : null,
              lobName: r.lob_id
                ? (lobNames.get(String(r.lob_id)) ?? null)
                : null,
              activeHc: Number(r.cnt ?? 0),
            }))
            .sort((a, b) => b.activeHc - a.activeHc);
        } catch (err: unknown) {
          console.error(
            "[capacity-summary] headcount-by-LOB lookup failed, omitting:",
            err,
          );
        }
      }
    })();
    // Per process+branch split of the same three populations, so the dashboard can show coverage
    // per process instead of one org-wide number. Same PROD_SEAT_SQL / same filters as the totals.
    type PB = {
      active: number;
      notice: number;
      leave: number;
      training: number;
    };
    const pbKey = (pid: unknown, bid: unknown) => `${pid ?? ""}|${bid ?? ""}`;
    const pb = new Map<string, PB>();
    const pbGet = (pid: unknown, bid: unknown): PB => {
      const k = pbKey(pid, bid);
      let v = pb.get(k);
      if (!v) {
        v = { active: 0, notice: 0, leave: 0, training: 0 };
        pb.set(k, v);
      }
      return v;
    };
    // The three counts are independent — run them together. They also supply the org-wide totals
    // (sum of the per-process rows), so there is no second pass over `employees`. Not swallowed:
    // without them the page has nothing true to show, same as the old total queries.
    const pbTask = (async () => {
      if (processIds.length === 0) return;
      const scopeSql = branchId ? "AND e.branch_id = ?" : "";
      const scopeParams = (): unknown[] =>
        branchId ? [processIds, branchId] : [processIds];
      const [[a], [n], [l]] = await Promise.all([
        db.query<any[]>(
          `SELECT e.process_id pid, e.branch_id bid, COUNT(*) cnt FROM employees e
           JOIN designation_master d ON d.id = e.designation_id
           LEFT JOIN department_master dept ON dept.id = e.department_id
           WHERE e.active_status = 1 AND ${PROD_SEAT_SQL} AND e.process_id IN (?) ${scopeSql}
           GROUP BY e.process_id, e.branch_id`,
          scopeParams(),
        ),
        db.query<any[]>(
          `SELECT e.process_id pid, e.branch_id bid, COUNT(*) cnt FROM exit_request er
           JOIN employees e ON er.employee_id = e.id
           JOIN designation_master d ON d.id = e.designation_id
           LEFT JOIN department_master dept ON dept.id = e.department_id
           WHERE er.status IN ('accepted','notice_serving') AND ${PROD_SEAT_SQL} AND e.process_id IN (?) ${scopeSql}
           GROUP BY e.process_id, e.branch_id`,
          scopeParams(),
        ),
        db.query<any[]>(
          `SELECT e.process_id pid, e.branch_id bid, COUNT(*) cnt FROM leave_request lr
           JOIN employees e ON lr.employee_id = e.id
           JOIN designation_master d ON d.id = e.designation_id
           LEFT JOIN department_master dept ON dept.id = e.department_id
           WHERE lr.status = 'approved' AND lr.to_date >= CURDATE() AND lr.total_days >= 5
             AND ${PROD_SEAT_SQL} AND e.process_id IN (?) ${scopeSql}
           GROUP BY e.process_id, e.branch_id`,
          scopeParams(),
        ),
      ]);
      for (const r of a) pbGet(r.pid, r.bid).active += Number(r.cnt);
      for (const r of n) pbGet(r.pid, r.bid).notice += Number(r.cnt);
      for (const r of l) pbGet(r.pid, r.bid).leave += Number(r.cnt);
    })();

    // In Training = live headcount sitting in an active NHT (New Hire Training) batch in the
    // LMS, for the processes actually in view — not the whole ats_candidate table (every
    // process, every branch, the platform's entire application history: 34,905 rows, which
    // floored Available Production HC to 0 on every load). The LMS, not the ATS pipeline, is
    // the system of record for "who is currently in training" (CLAUDE.md's LMS Integration
    // Rule) — user ruling 2026-09-04.
    //
    // trainee_master carries the HRMS process/branch id on ~78% of rows (process_hrms_id /
    // branch_hrms_id); the rest predate that backfill and only have the client/branch name as
    // free text, so a row without the id is matched by name against this scope's own mandates
    // instead of being dropped. batch_master.total_trainees is a denormalised counter that can
    // drift from reality (measured live: one active batch showed 0 there against 10 real rows
    // in trainee_master) — counting trainee_master rows directly is the source of truth.
    //
    // Read-only, wrapped and never thrown: an LMS outage must not take down the rest of this
    // dashboard, which is otherwise entirely HRMS-local. Failure -> 0, same as "no data yet".
    let inTrainingHc = 0;
    const lmsTask = (async () => {
      if (processIds.length > 0) {
        try {
          // Bounded: a slow LMS must not hold the whole dashboard open.
          const [lmsRows] = await withTimeout(
            lmsDb.query<RowDataPacket[]>(
              `SELECT tm.process_hrms_id, tm.branch_hrms_id, tm.process AS process_name,
                  tm.branch AS branch_name, COUNT(*) AS cnt
           FROM trainee_master tm
           JOIN batch_master bm ON bm.batch_no = tm.batch_no
           WHERE bm.batch_type = 'NHT' AND bm.batch_status = 'Active'
           GROUP BY tm.process_hrms_id, tm.branch_hrms_id, tm.process, tm.branch`,
            ),
            4000,
          );

          const inScopeProcessIds = new Set<string>(processIds);
          const inScopeProcessNames = new Set<string>(
            mandates
              .map((m: any) =>
                String(m.process_name ?? "")
                  .trim()
                  .toLowerCase(),
              )
              .filter(Boolean),
          );
          const branchNameFilter = branchId
            ? String(
                mandates.find((m: any) => String(m.branch_id) === branchId)
                  ?.branch_name ?? "",
              )
                .trim()
                .toLowerCase() || null
            : null;

          for (const row of lmsRows as any[]) {
            const rowProcessId = row.process_hrms_id
              ? String(row.process_hrms_id)
              : null;
            const matchesProcess = rowProcessId
              ? inScopeProcessIds.has(rowProcessId)
              : inScopeProcessNames.has(
                  String(row.process_name ?? "")
                    .trim()
                    .toLowerCase(),
                );
            if (!matchesProcess) continue;

            if (branchId) {
              const rowBranchId = row.branch_hrms_id
                ? String(row.branch_hrms_id)
                : null;
              const matchesBranch = rowBranchId
                ? rowBranchId === branchId
                : branchNameFilter !== null &&
                  String(row.branch_name ?? "")
                    .trim()
                    .toLowerCase() === branchNameFilter;
              if (!matchesBranch) continue;
            }

            inTrainingHc += Number(row.cnt ?? 0);
            // Attribute to the mandate row(s) of that process (by id, else by name) for the per-process view.
            const target = mandates.find(
              (m: any) =>
                (rowProcessId
                  ? String(m.process_id) === rowProcessId
                  : String(m.process_name ?? "")
                      .trim()
                      .toLowerCase() ===
                    String(row.process_name ?? "")
                      .trim()
                      .toLowerCase()) &&
                (!m.branch_id ||
                  !row.branch_hrms_id ||
                  String(m.branch_id) === String(row.branch_hrms_id)),
            );
            if (target)
              pbGet(target.process_id, target.branch_id).training += Number(
                row.cnt ?? 0,
              );
          }
        } catch (err: unknown) {
          console.error(
            "[capacity-summary] LMS in-training lookup failed, defaulting to 0:",
            err,
          );
          inTrainingHc = 0;
        }
      }
    })();

    await Promise.all([lobTask, pbTask, lmsTask]);

    let activeHc = 0,
      onNoticeHc = 0,
      longLeaveHc = 0;
    for (const v of pb.values()) {
      activeHc += v.active;
      onNoticeHc += v.notice;
      longLeaveHc += v.leave;
    }
    const availableProductionHc = Math.max(
      0,
      activeHc - onNoticeHc - longLeaveHc - inTrainingHc,
    );

    // Aggregate mandate totals
    const totalMandatedHc = mandates.reduce(
      (s: number, m: any) => s + Number(m.mandated_hc || 0),
      0,
    );
    const avgShrinkage =
      mandates.length > 0
        ? mandates.reduce(
            (s: number, m: any) => s + Number(m.shrinkage_pct || 15),
            0,
          ) / mandates.length
        : 15;
    const avgAttritionBuffer =
      mandates.length > 0
        ? mandates.reduce(
            (s: number, m: any) => s + Number(m.attrition_buffer_pct || 5),
            0,
          ) / mandates.length
        : 5;
    const avgTrainingBuffer =
      mandates.length > 0
        ? mandates.reduce(
            (s: number, m: any) => s + Number(m.training_buffer_pct || 5),
            0,
          ) / mandates.length
        : 5;

    // BPO formula
    const denominator = 1 - avgAttritionBuffer / 100 - avgTrainingBuffer / 100;
    const safeDenom = denominator > 0 ? denominator : 0.01;
    const requiredStaffedHc = Math.round(
      (totalMandatedHc * (1 + avgShrinkage / 100)) / safeDenom,
    );
    const netGap = requiredStaffedHc - availableProductionHc;
    const hiringDemand = Math.max(0, netGap) + onNoticeHc;
    const coveragePct =
      requiredStaffedHc > 0
        ? Math.round((availableProductionHc / requiredStaffedHc) * 100)
        : 100;

    // Per-process breakdown for hiring demand
    const hiringByProcess = mandates
      .map((m: any) => {
        const mandatedHc = Number(m.mandated_hc || 0);
        const shrinkage = Number(m.shrinkage_pct || 15);
        const attrition = Number(m.attrition_buffer_pct || 5);
        const training = Number(m.training_buffer_pct || 5);
        const denom = 1 - attrition / 100 - training / 100;
        const required = Math.round(
          (mandatedHc * (1 + shrinkage / 100)) / (denom > 0 ? denom : 0.01),
        );
        return {
          processId: m.process_id,
          processName: m.process_name,
          branchName: m.branch_name,
          mandatedHc,
          requiredHc: required,
          priority:
            mandatedHc >= 50 ? "HIGH" : mandatedHc >= 20 ? "MEDIUM" : "LOW",
        };
      })
      .sort((a: any, b: any) => b.requiredHc - a.requiredHc);

    // One row per process+branch; mandate rows of the same key (different role_group) are summed and
    // kept under `mandates` so the UI can edit the exact row.
    const grouped = new Map<string, any>();
    for (const m of mandates as any[]) {
      const k = pbKey(m.process_id, m.branch_id);
      let g = grouped.get(k);
      if (!g) {
        g = {
          processId: m.process_id,
          processName: m.process_name,
          branchId: m.branch_id ?? null,
          branchName: m.branch_name ?? null,
          mandatedHc: 0,
          mandates: [] as any[],
        };
        grouped.set(k, g);
      }
      g.mandatedHc += Number(m.mandated_hc || 0);
      g.mandates.push({
        id: m.id,
        mandatedHc: Number(m.mandated_hc || 0),
        shrinkagePct: Number(m.shrinkage_pct ?? 15),
        attritionBufferPct: Number(m.attrition_buffer_pct ?? 5),
        trainingBufferPct: Number(m.training_buffer_pct ?? 5),
      });
    }
    const byProcess = Array.from(grouped.entries())
      .map(([k, g]) => {
        const c = pb.get(k) ?? { active: 0, notice: 0, leave: 0, training: 0 };
        const ms = g.mandates as any[];
        const avg = (f: string) => ms.reduce((t, x) => t + x[f], 0) / ms.length;
        const denom =
          1 - avg("attritionBufferPct") / 100 - avg("trainingBufferPct") / 100;
        const required = Math.round(
          (g.mandatedHc * (1 + avg("shrinkagePct") / 100)) /
            (denom > 0 ? denom : 0.01),
        );
        const available = Math.max(
          0,
          c.active - c.notice - c.leave - c.training,
        );
        const coverage =
          required > 0 ? Math.round((available / required) * 100) : 100;
        return {
          processId: g.processId,
          processName: g.processName,
          branchId: g.branchId,
          branchName: g.branchName,
          mandatedHc: g.mandatedHc,
          requiredHc: required,
          activeHc: c.active,
          onNoticeHc: c.notice,
          longLeaveHc: c.leave,
          inTrainingHc: c.training,
          availableHc: available,
          gap: required - available,
          coveragePct: coverage,
          riskSignal:
            coverage >= 95 ? "green" : coverage >= 80 ? "amber" : "red",
          mandates: ms,
        };
      })
      .sort((a, b) => b.gap - a.gap);

    const payload = {
      byProcess,
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
        riskSignal:
          coveragePct >= 95 ? "green" : coveragePct >= 80 ? "amber" : "red",
      },
      formula: {
        mandatedHc: totalMandatedHc,
        shrinkagePct: Math.round(avgShrinkage * 10) / 10,
        attritionBufferPct: Math.round(avgAttritionBuffer * 10) / 10,
        trainingBufferPct: Math.round(avgTrainingBuffer * 10) / 10,
      },
      hiringByProcess,
      headcountByLob,
    };
    capacityCache.set(cacheKey, { at: Date.now(), body: payload });
    return res.json(payload);
  }),
);

export { router as workforceMandateRouter };
