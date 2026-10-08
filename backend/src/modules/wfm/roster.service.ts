import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { WfmRosterPlan, WfmRosterAssignment } from "./wfm.types.js";
import { computeScheduledMinutes, rosterAssignmentColumns } from "./shift-scheduling.util.js";
import { applyRestDecision, isRestPolicyFeatureActive, validateMinimumRest, logRestOverride, withEmployeeRosterLock } from "./rest-policy.service.js";
import { checkEmployeeDateNotLocked } from "../roster/roster-lock-guard.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export interface CreatePlanInput {
  planName: string;
  processId?: string | null;
  branchId?: string | null;
  shiftId?: string | null;
  fromDate: string;
  toDate: string;
  requiredHeadcount?: number;
}

export interface AssignInput {
  employeeId: string;
  rosterDate: string;
  shiftId?: string | null;
  planId?: string | null;
  /** Additive (2026-08-20): FK weekly_roster_cycle.id. Only the new
   *  roster-builder write path sets this today; every other existing
   *  caller omits it and behavior is unchanged — cycle_id is simply never
   *  included in the INSERT/UPDATE column list when absent. */
  cycleId?: string | null;
  /** Additive (2026-08-20): FK wfm_shift_template.id, written into the
   *  wfm_roster_assignment.shift_template_id column — deliberately separate
   *  from `shiftId` above, which writes the legacy shift_id column (FK
   *  wfm_shift_master.id). Confirmed against the live DB (2026-08-20):
   *  wfm_shift_template holds 23 UUID-keyed rows, wfm_shift_master holds 3
   *  string-keyed rows ("shift-eve-001" etc.), zero ID overlap between them —
   *  so a shiftTemplateId can never be safely passed through AssignInput.shiftId.
   *  Only the roster-builder write path sets this today; every other existing
   *  caller omits it and behavior is unchanged, same pattern as cycleId. */
  shiftTemplateId?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  branchName?: string | null;
  processName?: string | null;
  rosterStatus?: string;
  /** Area 2 emergency override — both required together. Only takes effect
   *  when the resolved policy has allows_emergency_override=1; otherwise
   *  insufficient rest blocks the assignment regardless of these fields. */
  restOverrideReason?: string | null;
  restOverrideApprovedBy?: string | null;
}

export class InsufficientRestError extends Error {
  code = "INSUFFICIENT_REST" as const;
  statusCode = 422;
  constructor(public details: { actualRestMinutes?: number; requiredRestMinutes?: number; against?: string; canOverride?: boolean }) {
    super(
      `Assignment blocked: only ${details.actualRestMinutes} minutes rest against the ${details.against} shift ` +
      `(minimum ${details.requiredRestMinutes} minutes required).` +
      (details.canOverride ? " An emergency override is permitted with reason + approver." : " This policy does not permit emergency override.")
    );
  }
}

export class RestPolicyMissingError extends Error {
  code = "REST_POLICY_MISSING" as const;
  statusCode = 422;
  constructor() {
    super("No minimum-rest policy is configured for this employee, process, branch, or organization. Configure one in Admin > Roster Controls > Minimum Rest before assigning shifts.");
  }
}

export interface BulkAssignRow {
  employeeId: string;
  rosterDate: string;
  shiftId?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  branchName?: string | null;
  processName?: string | null;
}

export interface BulkAssignResult {
  assigned: number;
  failed: number;
  errors: string[];
}

export interface PlanListFilters {
  processId?: string;
  branchId?: string;
  planStatus?: string;
  fromDate?: string;
  toDate?: string;
}

export interface AssignmentListFilters {
  planId?: string;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  publishStatus?: string;
  processName?: string;
}

export interface ActualAssignmentFilters {
  processId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export const rosterService = {
  async getFirstProcessWithAssignments(): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.process_id, p.process_name
         FROM wfm_roster_assignment a
         JOIN employees e ON e.id = a.employee_id
         JOIN process_master p ON p.id = e.process_id
        WHERE e.process_id IS NOT NULL
          AND p.active_status = 1
        LIMIT 1`
    );
    return rows[0] ?? null;
  },

  async getPlan(id: string): Promise<WfmRosterPlan> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_roster_plan WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as WfmRosterPlan[])[0];
    if (!rec) throw new Error("Plan not found");
    return rec;
  },

  async createPlan(input: CreatePlanInput, userId: string): Promise<WfmRosterPlan> {
    if (input.toDate < input.fromDate) throw new Error("toDate must be >= fromDate");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_roster_plan
         (id, plan_name, process_id, branch_id, shift_id, from_date, to_date, required_headcount, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.planName,
        input.processId ?? null,
        input.branchId ?? null,
        input.shiftId ?? null,
        input.fromDate,
        input.toDate,
        input.requiredHeadcount ?? 0,
        userId,
      ]
    );
    return this.getPlan(id);
  },

  async listPlans(filters: PlanListFilters): Promise<WfmRosterPlan[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.processId)  { conds.push("process_id = ?");   params.push(filters.processId); }
    if (filters.branchId)   { conds.push("branch_id = ?");    params.push(filters.branchId); }
    if (filters.planStatus) { conds.push("plan_status = ?");  params.push(filters.planStatus); }
    if (filters.fromDate)   { conds.push("to_date >= ?");     params.push(filters.fromDate); }
    if (filters.toDate)     { conds.push("from_date <= ?");   params.push(filters.toDate); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_plan ${where} ORDER BY from_date DESC`,
      params
    );
    return rows as WfmRosterPlan[];
  },

  async assignEmployee(input: AssignInput, userId: string): Promise<WfmRosterAssignment> {
    // Area 2 concurrency fix (2026-08-13): the lock-check, rest-check, and
    // write below are a read-then-write critical section — two
    // near-simultaneous assignEmployee calls for the SAME employee could
    // each read "no conflict" and both commit, producing an impossible pair
    // neither request individually violated. withEmployeeRosterLock holds a
    // MySQL named lock for this employeeId on one dedicated connection for
    // the whole section (same pattern leave.service.ts's submitLeaveRequest
    // already established today for the identical class of problem) — every
    // query below runs through that connection (`conn`), not the pool `db`,
    // so nothing here can race with itself.
    return withEmployeeRosterLock(input.employeeId, async (conn) => {
      // Round 2 (2026-08-13) audit finding: this is the only roster-mutating
      // service in the codebase with no attendance/payroll-lock check at all —
      // an admin (who bypasses the route-level plan-status scope guard
      // entirely, see scopeMiddleware.ts) could silently overwrite an
      // assignment on a date wfm.routes.ts's manager-override endpoints
      // already refuse to touch. Same shared function, same invariant.
      const lockResult = await checkEmployeeDateNotLocked(conn, input.employeeId, input.rosterDate);
      if (lockResult.blocked) {
        throw Object.assign(new Error(lockResult.error), { statusCode: 409, code: "ROSTER_DATE_LOCKED" });
      }

      // Area 2: minimum-rest validation. Manual assignment BLOCKS by default,
      // same as automated generation — the difference is a manual assignment can
      // carry an explicit emergency override (reason + approver), which an
      // automated generation run never supplies on its own. Only runs when both
      // a candidate shift's times are known (nothing to validate a week-off
      // against) and the feature has actually been turned on (migration 1210
      // applied) — otherwise this is a no-op, preserving current behavior.
      if (input.shiftStartTime && input.shiftEndTime && (await isRestPolicyFeatureActive(conn))) {
        const [empRows] = await conn.execute<RowDataPacket[]>(
          "SELECT process_id, branch_id FROM employees WHERE id = ? LIMIT 1", [input.employeeId]
        );
        const emp = empRows[0] as { process_id?: string | null; branch_id?: string | null } | undefined;
        const restCheck = await validateMinimumRest(
          { employeeId: input.employeeId, processId: emp?.process_id ?? null, branchId: emp?.branch_id ?? null, forDate: input.rosterDate },
          { startTime: input.shiftStartTime, endTime: input.shiftEndTime },
          null,
          conn
        );

        if (!restCheck.ok) {
          if (restCheck.reason === "REST_POLICY_MISSING") {
            throw new RestPolicyMissingError();
          }

          // Fixed 2026-08-17 (Section E audit): this path previously always blocked on
          // INSUFFICIENT_REST regardless of the policy's enforcementMode, ignoring WARN mode
          // entirely — the one write path out of five that never called applyRestDecision.
          // Same shared decision as generation/bulk upload/swap now: in WARN the assignment
          // proceeds and a REST_GAP_WARNING is recorded; only BLOCK reaches the existing
          // emergency-override logic below, unchanged from before this fix.
          const restDecision = await applyRestDecision(
            restCheck,
            { employeeId: input.employeeId, rosterDate: input.rosterDate },
            conn,
          );

          if (!restDecision.allowed) {
            // INSUFFICIENT_REST under BLOCK: only proceeds if the resolved policy explicitly
            // allows an emergency override AND the caller supplied both a reason
            // and an approver — matching "override requires reason, approver,
            // timestamp and audit entry" exactly. Anything less than that is a
            // block, not a silent pass.
            const canUseOverride = restCheck.canOverride && input.restOverrideReason && input.restOverrideApprovedBy;
            if (!canUseOverride) {
              throw new InsufficientRestError({
                actualRestMinutes: restCheck.actualRestMinutes, requiredRestMinutes: restCheck.requiredRestMinutes,
                against: restCheck.against, canOverride: restCheck.canOverride,
              });
            }

            const neighbor = restCheck.neighborShift!;
            const candidateStartAt = `${input.rosterDate} ${input.shiftStartTime.slice(0, 5)}:00`;
            const candidateEndAt = `${input.rosterDate} ${input.shiftEndTime.slice(0, 5)}:00`;
            const neighborAt = `${neighbor.date} ${neighbor.time}:00`;
            await logRestOverride({
              employeeId: input.employeeId,
              rosterDate: input.rosterDate,
              previousShiftEndAt: restCheck.against === "previous" ? neighborAt : candidateEndAt,
              nextShiftStartAt: restCheck.against === "next" ? neighborAt : candidateStartAt,
              actualRestMinutes: restCheck.actualRestMinutes!,
              requiredRestMinutes: restCheck.requiredRestMinutes!,
              policyId: restCheck.policy?.id ?? null,
              source: "manual_assignment",
              reason: input.restOverrideReason!,
              requestedBy: userId,
              approvedBy: input.restOverrideApprovedBy!,
            }, conn);
          }
        }
      }

      // shift_version_id/scheduled_minutes only exist once migration
      // 1200_shift_versioning.sql has been applied — probe rather than assume,
      // same pattern as every other Area 4 write path. shiftId is already what
      // gets stored as shift_id, and (per wfm.service.ts's updateShift) a
      // wfm_shift_master row becomes immutable the moment anything references it —
      // so shiftId itself is already the stable, exact-version reference this
      // snapshot needs; no separate lookup required.
      const raCols = await rosterAssignmentColumns(conn);
      const hasShiftVersionId = raCols.has("shift_version_id");
      const hasScheduledMinutes = raCols.has("scheduled_minutes");
      const scheduledMinutes = input.shiftStartTime && input.shiftEndTime
        ? computeScheduledMinutes(input.shiftStartTime.slice(0, 5), input.shiftEndTime.slice(0, 5))
        : null;

      const insertCols = ["id", "employee_id", "shift_id", "plan_id", "roster_date", "roster_status",
        "shift_start_time", "shift_end_time", "branch_name", "process_name"];
      const placeholders = ["UUID()", "?", "?", "?", "?", "?", "?", "?", "?", "?"];
      const params: unknown[] = [
        input.employeeId, input.shiftId ?? null, input.planId ?? null, input.rosterDate,
        input.rosterStatus ?? "Rostered", input.shiftStartTime ?? null, input.shiftEndTime ?? null,
        input.branchName ?? null, input.processName ?? null,
      ];
      const updateClauses = [
        "shift_id = VALUES(shift_id)",
        "shift_start_time = VALUES(shift_start_time)",
        "shift_end_time = VALUES(shift_end_time)",
        "roster_status = VALUES(roster_status)",
      ];
      if (hasShiftVersionId) {
        insertCols.push("shift_version_id");
        placeholders.push("?");
        params.push(input.shiftId ?? null);
        updateClauses.push("shift_version_id = VALUES(shift_version_id)");
      }
      if (hasScheduledMinutes) {
        insertCols.push("scheduled_minutes");
        placeholders.push("?");
        params.push(scheduledMinutes);
        updateClauses.push("scheduled_minutes = VALUES(scheduled_minutes)");
      }
      if (input.cycleId) {
        insertCols.push("cycle_id");
        placeholders.push("?");
        params.push(input.cycleId);
        updateClauses.push("cycle_id = VALUES(cycle_id)");
      }
      if (input.shiftTemplateId && raCols.has("shift_template_id")) {
        insertCols.push("shift_template_id");
        placeholders.push("?");
        params.push(input.shiftTemplateId);
        updateClauses.push("shift_template_id = VALUES(shift_template_id)");
      }

      await conn.execute(
        `INSERT INTO wfm_roster_assignment
           (${insertCols.join(", ")})
         VALUES (${placeholders.join(", ")})
         ON DUPLICATE KEY UPDATE
           ${updateClauses.join(",\n           ")}`,
        params
      );
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ? LIMIT 1",
        [input.employeeId, input.rosterDate]
      );
      const result = (rows as WfmRosterAssignment[])[0];

      // Round 2 governance-matrix finding (2026-08-13): this was the only one
      // of the four real roster-write engines with no audit trail at all for
      // an ordinary assignment — roster-generation.service.ts writes
      // roster_decision_audit per employee/date, auto-roster-synced.service.ts
      // has its own wfm_roster_event_log, this had neither. Fire-and-forget
      // via logSensitiveAction (its own try/catch already ensures an audit
      // write failure can never fail the assignment itself), on the pool
      // connection rather than `conn` — an audit row doesn't need to be in
      // the same named-lock section as the write it's recording.
      logSensitiveAction({
        actor_user_id: userId,
        action_type: "WFM_ROSTER_ASSIGNMENT_UPSERTED",
        module_key: "wfm_roster_assignment",
        entity_type: "wfm_roster_assignment",
        entity_id: result?.id,
        change_summary: {
          employee_id: input.employeeId,
          roster_date: input.rosterDate,
          shift_id: input.shiftId ?? null,
          plan_id: input.planId ?? null,
        },
      }).catch((error) => console.error("[roster.service] audit log write failed (assignment itself already succeeded):", (error as Error)?.message));

      return result;
    });
  },

  async bulkAssign(rows: BulkAssignRow[], planId: string, userId: string): Promise<BulkAssignResult> {
    let assigned = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        await this.assignEmployee(
          {
            employeeId: row.employeeId,
            rosterDate: row.rosterDate,
            shiftId: row.shiftId ?? null,
            planId,
            shiftStartTime: row.shiftStartTime ?? null,
            shiftEndTime: row.shiftEndTime ?? null,
            branchName: row.branchName ?? null,
            processName: row.processName ?? null,
          },
          userId
        );
        assigned++;
      } catch (err) {
        failed++;
        errors.push(`${row.employeeId}/${row.rosterDate}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { assigned, failed, errors };
  },

  async publishPlan(planId: string, _userId: string): Promise<WfmRosterPlan> {
    await this.getPlan(planId); // throws if not found
    await db.execute(
      "UPDATE wfm_roster_plan SET plan_status = 'published' WHERE id = ?",
      [planId]
    );
    await db.execute(
      "UPDATE wfm_roster_assignment SET publish_status = 'published' WHERE plan_id = ?",
      [planId]
    );
    return this.getPlan(planId);
  },

  async listAssignments(filters: AssignmentListFilters): Promise<WfmRosterAssignment[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.planId)        { conds.push("plan_id = ?");         params.push(filters.planId); }
    if (filters.employeeId)    { conds.push("employee_id = ?");     params.push(filters.employeeId); }
    if (filters.fromDate)      { conds.push("roster_date >= ?");    params.push(filters.fromDate); }
    if (filters.toDate)        { conds.push("roster_date <= ?");    params.push(filters.toDate); }
    if (filters.publishStatus) { conds.push("publish_status = ?");  params.push(filters.publishStatus); }
    if (filters.processName)   { conds.push("process_name = ?");    params.push(filters.processName); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_assignment ${where} ORDER BY roster_date ASC, employee_id ASC`,
      params
    );
    return rows as WfmRosterAssignment[];
  },

  async listActualAssignments(filters: ActualAssignmentFilters): Promise<RowDataPacket[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.processId) { conds.push("e.process_id = ?"); params.push(filters.processId); }
    if (filters.fromDate)  { conds.push("a.roster_date >= ?"); params.push(filters.fromDate); }
    if (filters.toDate)    { conds.push("a.roster_date <= ?"); params.push(filters.toDate); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filters.limit ?? 250, 1), 1000);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.id,
              a.employee_id,
              e.process_id,
              e.employee_code,
              TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
              DATE_FORMAT(a.roster_date, '%Y-%m-%d') AS roster_date,
              a.roster_status,
              a.publish_status,
              a.shift_start_time,
              a.shift_end_time,
              COALESCE(sm.shift_code, '') AS shift_code,
              COALESCE(sm.shift_name, '') AS shift_name,
              COALESCE(a.branch_name, b.branch_name) AS branch_name,
              COALESCE(a.process_name, p.process_name) AS process_name
         FROM wfm_roster_assignment a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN wfm_shift_master sm ON sm.id = a.shift_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         ${where}
        ORDER BY a.roster_date DESC, e.employee_code ASC
        LIMIT ${limit}`,
      params
    );
    return rows;
  },
};
