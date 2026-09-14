import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { checkEmployeeDateNotLocked } from "../roster/roster-lock-guard.js";
import { rosterAssignmentColumns } from "../wfm/shift-scheduling.util.js";
import { validateMinimumRest, isRestPolicyFeatureActive, logRestOverride } from "../wfm/rest-policy.service.js";
import type { Request } from "express";

type ScopeFilter = { sql?: string; params?: unknown[] };

function monthBounds(month?: string) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const from = `${month}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: next.toISOString().slice(0, 10) };
}

function exitTypeFromPayload(data: any): string {
  if (data.exit_type) return String(data.exit_type);
  const reason = String(data.reason_category ?? "");
  if (["absconding", "contract_end"].includes(reason)) return reason;
  if (reason === "termination") return "involuntary";
  return data.is_voluntary === false ? "involuntary" : "voluntary";
}

export const rosterSwapService = {
  async list(filters: { status?: string; employee_id?: string } & ScopeFilter) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.status) { conds.push("s.status = ?"); params.push(filters.status); }
    if (filters.employee_id) { conds.push("(s.requester_emp_id = ? OR s.swap_with_emp_id = ?)"); params.push(filters.employee_id, filters.employee_id); }
    if (filters.sql) {
      const requesterScope = filters.sql.replace(/\be\./g, "e1.");
      const targetScope = filters.sql.replace(/\be\./g, "e2.");
      conds.push(`((${requesterScope}) OR (${targetScope}))`);
      params.push(...(filters.params ?? []), ...(filters.params ?? []));
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.id,
              s.requester_emp_id AS requester_employee_id,
              s.swap_with_emp_id AS target_employee_id,
              DATE_FORMAT(s.swap_date, '%Y-%m-%d') AS swap_date,
              '' AS shift_id,
              '' AS shift_name,
              s.reason,
              s.status,
              s.created_at,
              COALESCE(NULLIF(e1.full_name, ''), CONCAT_WS(' ', e1.first_name, e1.last_name)) AS requester_name,
              COALESCE(NULLIF(e2.full_name, ''), CONCAT_WS(' ', e2.first_name, e2.last_name)) AS target_name
         FROM wfm_roster_swap_request s
         JOIN employees e1 ON e1.id = s.requester_emp_id
         JOIN employees e2 ON e2.id = s.swap_with_emp_id
        WHERE ${conds.join(" AND ")}
        ORDER BY s.created_at DESC
        LIMIT 200`,
      params,
    );
    return rows;
  },

  async create(data: { requester_emp_id: string; swap_with_emp_id: string; swap_date: string; reason?: string }) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_roster_swap_request (id, requester_emp_id, swap_with_emp_id, swap_date, reason) VALUES (?, ?, ?, ?, ?)`,
      [id, data.requester_emp_id, data.swap_with_emp_id, data.swap_date, data.reason ?? null],
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM wfm_roster_swap_request WHERE id = ? LIMIT 1", [id]);
    return rows[0];
  },

  /**
   * Counterpart (swap_with_emp_id) accepts or declines — the lifecycle step
   * that never existed before round 2: a manager could previously approve a
   * swap the second employee never agreed to, because nothing recorded
   * their side at all. Requires migration 1212 (counterpart_status column);
   * degrades to a clear error rather than silently no-op if that column
   * isn't present yet.
   */
  async respond(id: string, response: "accepted" | "declined", userId: string, req?: Request) {
    const emp = await getEmployeeForUser(userId);
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM wfm_roster_swap_request WHERE id = ? LIMIT 1", [id]);
    const swap = rows[0] as any;
    if (!swap) throw Object.assign(new Error("Swap request not found"), { statusCode: 404 });
    if (!emp || emp.id !== swap.swap_with_emp_id) {
      throw Object.assign(new Error("Only the employee named as the swap counterpart can respond to this request"), { statusCode: 403 });
    }
    if (swap.status !== "pending") {
      throw Object.assign(new Error(`Cannot respond — this request is already ${swap.status}`), { statusCode: 409 });
    }
    if (swap.counterpart_status === undefined) {
      throw Object.assign(new Error("Counterpart-response tracking is not available on this database yet (migration 1212 not applied)"), { statusCode: 501 });
    }
    if (swap.counterpart_status !== "pending") {
      throw Object.assign(new Error(`Already responded (${swap.counterpart_status})`), { statusCode: 409 });
    }
    await db.execute(
      "UPDATE wfm_roster_swap_request SET counterpart_status = ?, counterpart_responded_at = NOW() WHERE id = ?",
      [response, id]
    );
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_SWAP_COUNTERPART_RESPONDED", module_key: "WFM", entity_type: "wfm_roster_swap_request", entity_id: id, change_summary: { response }, req });
    const [after] = await db.execute<RowDataPacket[]>("SELECT * FROM wfm_roster_swap_request WHERE id = ? LIMIT 1", [id]);
    return after[0];
  },

  /**
   * status='rejected': unchanged in spirit (just flips the flag), but now
   * idempotency-guarded — a second call against an already-processed
   * request 409s instead of silently re-writing reviewed_by/reviewed_at.
   * status='approved': delegates to applyApprovedSwap(), which is where the
   * actual roster mutation, validation, and transactional apply happens —
   * review() no longer just flips a status column and stops there (the root
   * cause of the dead swap workflow: it had a decision but never a roster
   * write to make it real).
   */
  async review(
    id: string,
    status: "approved" | "rejected",
    reviewedBy: string,
    req?: Request,
    opts?: { forceWithoutCounterpartAcceptance?: boolean; restOverrideReason?: string }
  ) {
    if (status === "rejected") {
      const [result] = await db.execute<ResultSetHeader>(
        "UPDATE wfm_roster_swap_request SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
        [reviewedBy, id]
      );
      if ((result as ResultSetHeader).affectedRows === 0) {
        throw Object.assign(new Error("Request not found, or already processed"), { statusCode: 409 });
      }
      await logSensitiveAction({ actor_user_id: reviewedBy, action_type: "ROSTER_SWAP_REVIEWED", module_key: "WFM", entity_type: "wfm_roster_swap_request", entity_id: id, change_summary: { status }, req });
      return { status: "rejected" as const, applied: false };
    }
    return rosterSwapService.applyApprovedSwap(id, reviewedBy, req, opts);
  },

  /**
   * The actual "approve → validate → mutate the roster → audit" apply,
   * transactional: both assignment rows are updated or neither is. Guards,
   * in order:
   *  1. Row lock (SELECT ... FOR UPDATE) + status='pending' check — this is
   *     both the stale/double-approval guard AND the concurrency guard: a
   *     second concurrent call blocks on the row lock until the first
   *     commits, then sees status='approved' and 409s. Replaying an
   *     already-applied approval can never re-run the swap.
   *  2. Counterpart must have accepted, unless the caller is privileged and
   *     explicitly passes forceWithoutCounterpartAcceptance (matches the
   *     established isPrivileged-bypass pattern used elsewhere in this
   *     codebase's manager-override endpoints).
   *  3. Both employees must actually have a wfm_roster_assignment row on
   *     swap_date — nothing to exchange otherwise.
   *  4. Neither may be a week-off day (nothing to swap).
   *  5. Neither date may be attendance/payroll-locked (roster-lock-guard.ts,
   *     the same shared function wfm.routes.ts's manager-override endpoints
   *     use).
   *  6. Minimum-rest re-validated for BOTH employees against the shift
   *     they're about to receive — an emergency override is honored only
   *     if the resolved policy explicitly allows it and a reason was
   *     supplied, and is logged to wfm_rest_override_log with source
   *     'shift_swap' exactly as rest-policy.service.ts's own RestOverrideInput
   *     type already anticipated.
   *  7. Same-process required for both employees unless the caller is
   *     privileged — no existing swap-specific eligibility rule was found
   *     in this codebase's audit, so this is a conservative default, not a
   *     rediscovered requirement; revisit if a real business rule exists.
   */
  async applyApprovedSwap(
    id: string,
    reviewedBy: string,
    req?: Request,
    opts?: { forceWithoutCounterpartAcceptance?: boolean; restOverrideReason?: string }
  ) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [lockRows] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM wfm_roster_swap_request WHERE id = ? FOR UPDATE",
        [id]
      );
      const swap = lockRows[0] as any;
      if (!swap) throw Object.assign(new Error("Swap request not found"), { statusCode: 404 });
      if (swap.status !== "pending") {
        throw Object.assign(new Error(`Cannot approve — this request is already ${swap.status}`), { statusCode: 409 });
      }

      if (swap.counterpart_status !== undefined && swap.counterpart_status !== "accepted" && !opts?.forceWithoutCounterpartAcceptance) {
        throw Object.assign(
          new Error(`Cannot approve — the counterpart employee has not accepted this swap (status: ${swap.counterpart_status})`),
          { statusCode: 409 }
        );
      }

      const [reqEmpRows] = await conn.execute<RowDataPacket[]>("SELECT process_id FROM employees WHERE id = ? LIMIT 1", [swap.requester_emp_id]);
      const [tgtEmpRows] = await conn.execute<RowDataPacket[]>("SELECT process_id FROM employees WHERE id = ? LIMIT 1", [swap.swap_with_emp_id]);
      const isPrivileged = await hasRole(reviewedBy, "admin", "hr");
      if (!isPrivileged && reqEmpRows[0]?.process_id !== tgtEmpRows[0]?.process_id) {
        throw Object.assign(new Error("Requester and counterpart are in different processes — cross-process swaps require admin/hr approval"), { statusCode: 409 });
      }

      const [reqAssignRows] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ? LIMIT 1",
        [swap.requester_emp_id, swap.swap_date]
      );
      const [tgtAssignRows] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ? LIMIT 1",
        [swap.swap_with_emp_id, swap.swap_date]
      );
      const reqAssign = reqAssignRows[0] as any;
      const tgtAssign = tgtAssignRows[0] as any;
      if (!reqAssign || !tgtAssign) {
        throw Object.assign(new Error("Both employees must have a roster assignment on the swap date to apply this swap"), { statusCode: 409 });
      }
      if (Number(reqAssign.is_week_off) === 1 || Number(tgtAssign.is_week_off) === 1) {
        throw Object.assign(new Error("Cannot swap a week-off day — there is no shift to exchange"), { statusCode: 409 });
      }

      const swapDateStr = String(swap.swap_date).slice(0, 10);
      const lockReq = await checkEmployeeDateNotLocked(conn, swap.requester_emp_id, swapDateStr, "Requester's roster date");
      if (lockReq.blocked) throw Object.assign(new Error(lockReq.error), { statusCode: 409 });
      const lockTgt = await checkEmployeeDateNotLocked(conn, swap.swap_with_emp_id, swapDateStr, "Counterpart's roster date");
      if (lockTgt.blocked) throw Object.assign(new Error(lockTgt.error), { statusCode: 409 });

      let restOverrideUsed = false;
      if (await isRestPolicyFeatureActive(conn)) {
        const checks: Array<{ label: string; employeeId: string; assignmentId: string; candidate: any }> = [
          { label: "requester", employeeId: swap.requester_emp_id, assignmentId: reqAssign.id, candidate: tgtAssign },
          { label: "counterpart", employeeId: swap.swap_with_emp_id, assignmentId: tgtAssign.id, candidate: reqAssign },
        ];
        for (const check of checks) {
          if (!check.candidate.shift_start_time || !check.candidate.shift_end_time) continue;
          const result = await validateMinimumRest(
            { employeeId: check.employeeId, forDate: swapDateStr },
            { startTime: String(check.candidate.shift_start_time).slice(0, 5), endTime: String(check.candidate.shift_end_time).slice(0, 5) },
            check.assignmentId,
            conn
          );
          if (!result.ok) {
            if (result.reason === "REST_POLICY_MISSING" || !result.canOverride || !opts?.restOverrideReason) {
              throw Object.assign(
                new Error(`Swap would leave the ${check.label} with insufficient rest (${result.reason}${result.reason === "INSUFFICIENT_REST" ? `: ${result.actualRestMinutes}min actual vs ${result.requiredRestMinutes}min required` : ""}).`),
                { statusCode: 409, restViolation: result }
              );
            }
            restOverrideUsed = true;
            if (result.neighborShift) {
              const isAgainstPrevious = result.against === "previous";
              await logRestOverride({
                employeeId: check.employeeId,
                rosterDate: swapDateStr,
                previousShiftEndAt: isAgainstPrevious ? `${result.neighborShift.date} ${result.neighborShift.time}:00` : `${swapDateStr} ${String(check.candidate.shift_end_time).slice(0, 5)}:00`,
                nextShiftStartAt: isAgainstPrevious ? `${swapDateStr} ${String(check.candidate.shift_start_time).slice(0, 5)}:00` : `${result.neighborShift.date} ${result.neighborShift.time}:00`,
                actualRestMinutes: result.actualRestMinutes!,
                requiredRestMinutes: result.requiredRestMinutes!,
                policyId: result.policy?.id ?? null,
                source: "shift_swap",
                reason: opts!.restOverrideReason!,
                requestedBy: swap.requester_emp_id,
                approvedBy: reviewedBy,
              }, conn);
            }
          }
        }
      }

      const beforeState = {
        requester: { employee_id: reqAssign.employee_id, shift_id: reqAssign.shift_id, shift_version_id: reqAssign.shift_version_id ?? null, shift_start_time: reqAssign.shift_start_time, shift_end_time: reqAssign.shift_end_time },
        target: { employee_id: tgtAssign.employee_id, shift_id: tgtAssign.shift_id, shift_version_id: tgtAssign.shift_version_id ?? null, shift_start_time: tgtAssign.shift_start_time, shift_end_time: tgtAssign.shift_end_time },
      };

      // Cross-assign, preserving shift_version_id/scheduled_minutes when the
      // columns exist (migration 1200) so the swapped-in shift stays pinned
      // to the exact version that was scheduled, not a re-resolved "current"
      // shift — same probe-and-degrade pattern shift-scheduling.util.ts's
      // other callers use, so this behaves identically on a DB that hasn't
      // had 1200 applied yet (those two columns just aren't touched).
      const raCols = await rosterAssignmentColumns(conn);
      const hasShiftVersionId = raCols.has("shift_version_id");
      const hasScheduledMinutes = raCols.has("scheduled_minutes");
      const buildSwapUpdate = (targetAssignmentId: string, sourceAssign: any) => {
        const sets = ["shift_id = ?", "shift_start_time = ?", "shift_end_time = ?"];
        const vals: unknown[] = [sourceAssign.shift_id, sourceAssign.shift_start_time, sourceAssign.shift_end_time];
        if (hasShiftVersionId) { sets.push("shift_version_id = ?"); vals.push(sourceAssign.shift_version_id ?? null); }
        if (hasScheduledMinutes) { sets.push("scheduled_minutes = ?"); vals.push(sourceAssign.scheduled_minutes ?? null); }
        vals.push(targetAssignmentId);
        return { sql: `UPDATE wfm_roster_assignment SET ${sets.join(", ")} WHERE id = ?`, vals };
      };
      const reqUpdate = buildSwapUpdate(reqAssign.id, tgtAssign);
      const tgtUpdate = buildSwapUpdate(tgtAssign.id, reqAssign);
      await conn.execute(reqUpdate.sql, reqUpdate.vals);
      await conn.execute(tgtUpdate.sql, tgtUpdate.vals);

      const afterState = {
        requester: { employee_id: reqAssign.employee_id, shift_id: tgtAssign.shift_id, shift_version_id: tgtAssign.shift_version_id ?? null, shift_start_time: tgtAssign.shift_start_time, shift_end_time: tgtAssign.shift_end_time },
        target: { employee_id: tgtAssign.employee_id, shift_id: reqAssign.shift_id, shift_version_id: reqAssign.shift_version_id ?? null, shift_start_time: reqAssign.shift_start_time, shift_end_time: reqAssign.shift_end_time },
      };

      const swapReqCols = await (async () => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_swap_request'`
        );
        return new Set((rows as RowDataPacket[]).map((r) => String(r.COLUMN_NAME)));
      })();
      const hasLifecycleCols = swapReqCols.has("applied_at");
      if (hasLifecycleCols) {
        await conn.execute(
          `UPDATE wfm_roster_swap_request
              SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), applied_at = NOW(),
                  requester_assignment_id = ?, target_assignment_id = ?,
                  before_state_json = ?, after_state_json = ?, rest_override_used = ?
            WHERE id = ?`,
          [reviewedBy, reqAssign.id, tgtAssign.id, JSON.stringify(beforeState), JSON.stringify(afterState), restOverrideUsed ? 1 : 0, id]
        );
      } else {
        // Migration 1212 not applied yet — still apply the roster mutation
        // (that's the actual fix), just without the extra audit columns to
        // write into.
        await conn.execute(
          "UPDATE wfm_roster_swap_request SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
          [reviewedBy, id]
        );
      }

      await conn.commit();
      await logSensitiveAction({
        actor_user_id: reviewedBy, action_type: "ROSTER_SWAP_APPLIED", module_key: "WFM",
        entity_type: "wfm_roster_swap_request", entity_id: id,
        change_summary: { requester_emp_id: swap.requester_emp_id, swap_with_emp_id: swap.swap_with_emp_id, swap_date: swapDateStr, restOverrideUsed, before: beforeState, after: afterState },
        req,
      });
      return { status: "approved" as const, applied: true, restOverrideUsed };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};

export const rosterConflictService = {
  async list(filters: { status?: string; resolved?: boolean; employee_id?: string; date_from?: string; date_to?: string } & ScopeFilter) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.status === "open") conds.push("c.resolved = 0");
    if (filters.status === "resolved") conds.push("c.resolved = 1");
    if (filters.resolved !== undefined) { conds.push("c.resolved = ?"); params.push(filters.resolved ? 1 : 0); }
    if (filters.employee_id) { conds.push("c.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.date_from) { conds.push("c.conflict_date >= ?"); params.push(filters.date_from); }
    if (filters.date_to) { conds.push("c.conflict_date <= ?"); params.push(filters.date_to); }
    if (filters.sql) { conds.push(`(${filters.sql})`); params.push(...(filters.params ?? [])); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, DATE_FORMAT(c.conflict_date, '%Y-%m-%d') AS conflict_date,
              COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
              e.employee_code
         FROM wfm_roster_conflict_log c
         JOIN employees e ON e.id = c.employee_id
        WHERE ${conds.join(" AND ")}
        ORDER BY c.conflict_date DESC, c.detected_at DESC
        LIMIT 200`,
      params,
    );
    return rows.map((row: any) => ({
      id: row.id,
      conflict_type: row.conflict_type,
      conflict_date: row.conflict_date,
      employees_involved: [row.employee_id],
      employee_names: [row.employee_name ?? row.employee_code ?? row.employee_id],
      severity: String(row.conflict_type ?? "").toLowerCase().includes("overlap") ? "high" : "medium",
      status: row.resolved ? "resolved" : "open",
      resolution_remarks: row.description ?? null,
      created_at: row.detected_at,
    }));
  },

  async log(data: { employee_id: string; conflict_date: string; conflict_type: string; description?: string }) {
    const id = randomUUID();
    await db.execute("INSERT IGNORE INTO wfm_roster_conflict_log (id, employee_id, conflict_date, conflict_type, description) VALUES (?, ?, ?, ?, ?)", [id, data.employee_id, data.conflict_date, data.conflict_type, data.description ?? null]);
    return id;
  },

  async resolve(id: string, resolvedBy: string, req?: Request) {
    await db.execute("UPDATE wfm_roster_conflict_log SET resolved = 1 WHERE id = ?", [id]);
    await logSensitiveAction({ actor_user_id: resolvedBy, action_type: "ROSTER_CONFLICT_RESOLVED", module_key: "WFM", entity_type: "wfm_roster_conflict_log", entity_id: id, req });
  },
};

export const coverageService = {
  async summarize(filters: { date?: string; from_date?: string; to_date?: string; process_id?: string; branch_id?: string } & ScopeFilter) {
    const date = filters.date ?? filters.from_date ?? new Date().toISOString().slice(0, 10);
    const snapshotConds = ["s.snapshot_date = ?"];
    const snapshotParams: unknown[] = [date];
    if (filters.process_id) { snapshotConds.push("s.process_id = ?"); snapshotParams.push(filters.process_id); }
    if (filters.branch_id) { snapshotConds.push("s.branch_id = ?"); snapshotParams.push(filters.branch_id); }
    const [snapshotRows] = await db.execute<RowDataPacket[]>(
      `SELECT s.*, p.process_name, b.branch_name
         FROM wfm_coverage_snapshot s
         LEFT JOIN process_master p ON p.id = s.process_id
         LEFT JOIN branch_master b ON b.id = s.branch_id
        WHERE ${snapshotConds.join(" AND ")}
        ORDER BY s.created_at DESC
        LIMIT 200`,
      snapshotParams,
    );
    if (snapshotRows.length) {
      const required = snapshotRows.reduce((sum: number, row: any) => sum + Number(row.planned_headcount ?? 0), 0);
      const available = snapshotRows.reduce((sum: number, row: any) => sum + Number(row.actual_headcount ?? 0), 0);
      return {
        required_headcount: required,
        available_headcount: available,
        coverage_pct: required > 0 ? Math.round((available / required) * 10000) / 100 : 0,
        gaps: snapshotRows.filter((row: any) => Number(row.planned_headcount ?? 0) > Number(row.actual_headcount ?? 0)).map((row: any) => ({ process: row.process_name, branch: row.branch_name, gap_count: Math.max(0, Number(row.planned_headcount ?? 0) - Number(row.actual_headcount ?? 0)), note: `Shrinkage ${Number(row.shrinkage_pct ?? 0).toFixed(2)}%` })),
        data: snapshotRows,
      };
    }

    const rosterConds = ["a.roster_date = ?"];
    const rosterParams: unknown[] = [date];
    if (filters.process_id) { rosterConds.push("e.process_id = ?"); rosterParams.push(filters.process_id); }
    if (filters.branch_id) { rosterConds.push("e.branch_id = ?"); rosterParams.push(filters.branch_id); }
    if (filters.sql) { rosterConds.push(`(${filters.sql})`); rosterParams.push(...(filters.params ?? [])); }
    const [liveRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.process_id, e.branch_id, p.process_name, b.branch_name,
              COUNT(DISTINCT a.employee_id) AS planned_headcount,
              COUNT(DISTINCT CASE WHEN ad.attendance_status IN ('present','half_day') THEN ad.employee_id END) AS actual_headcount,
              COUNT(DISTINCT CASE WHEN ad.attendance_status = 'absent' THEN ad.employee_id END) AS absent_count,
              COUNT(DISTINCT CASE WHEN ad.attendance_status = 'leave_approved' THEN ad.employee_id END) AS leave_count
         FROM wfm_roster_assignment a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN attendance_daily_record ad ON ad.employee_id = a.employee_id AND ad.record_date = a.roster_date
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE ${rosterConds.join(" AND ")}
        GROUP BY e.process_id, e.branch_id, p.process_name, b.branch_name`,
      rosterParams,
    );
    const required = liveRows.reduce((sum: number, row: any) => sum + Number(row.planned_headcount ?? 0), 0);
    const available = liveRows.reduce((sum: number, row: any) => sum + Number(row.actual_headcount ?? 0), 0);
    return {
      required_headcount: required,
      available_headcount: available,
      coverage_pct: required > 0 ? Math.round((available / required) * 10000) / 100 : 0,
      gaps: liveRows.filter((row: any) => Number(row.planned_headcount ?? 0) > Number(row.actual_headcount ?? 0)).map((row: any) => ({ process: row.process_name, branch: row.branch_name, gap_count: Math.max(0, Number(row.planned_headcount ?? 0) - Number(row.actual_headcount ?? 0)), note: "Computed from roster vs attendance" })),
      data: liveRows,
    };
  },

  async upsertSnapshot(data: { snapshot_date: string; process_id?: string; branch_id?: string; planned_headcount: number; actual_headcount: number; absent_count: number; leave_count: number }, createdBy?: string, req?: Request) {
    const id = randomUUID();
    const shrinkage = data.planned_headcount > 0 ? Math.round(((data.absent_count + data.leave_count) / data.planned_headcount) * 10000) / 100 : 0;
    const coverage = data.planned_headcount > 0 ? Math.round((data.actual_headcount / data.planned_headcount) * 10000) / 100 : 0;
    await db.execute(
      `INSERT INTO wfm_coverage_snapshot (id, snapshot_date, process_id, branch_id, planned_headcount, actual_headcount, absent_count, leave_count, shrinkage_pct, coverage_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE actual_headcount = VALUES(actual_headcount), absent_count = VALUES(absent_count), leave_count = VALUES(leave_count), shrinkage_pct = VALUES(shrinkage_pct), coverage_pct = VALUES(coverage_pct)`,
      [id, data.snapshot_date, data.process_id ?? null, data.branch_id ?? null, data.planned_headcount, data.actual_headcount, data.absent_count, data.leave_count, shrinkage, coverage],
    );
    if (createdBy) await logSensitiveAction({ actor_user_id: createdBy, action_type: "COVERAGE_SNAPSHOT_UPSERTED", module_key: "WFM", entity_type: "wfm_coverage_snapshot", entity_id: id, change_summary: { snapshot_date: data.snapshot_date }, req });
  },
};

export const attritionService = {
  async recordExit(data: any, req?: Request) {
    const [empRows] = await db.execute<RowDataPacket[]>("SELECT process_id, branch_id, date_of_joining FROM employees WHERE id = ? LIMIT 1", [data.employee_id]);
    const emp = empRows[0] as any;
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const tenureDays = emp.date_of_joining ? Math.max(0, Math.floor((new Date(data.exit_date).getTime() - new Date(emp.date_of_joining).getTime()) / 86400000)) : null;
    const id = randomUUID();
    const exitType = exitTypeFromPayload(data);
    await db.execute(
      "INSERT INTO attrition_record (id, employee_id, process_id, branch_id, exit_date, exit_type, tenure_days, recorded_by, exit_request_id, is_provisional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.employee_id, data.process_id ?? emp.process_id ?? null, data.branch_id ?? emp.branch_id ?? null, data.exit_date, exitType, data.tenure_days ?? tenureDays, data.recorded_by, data.exit_request_id ?? null, data.exit_request_id ? 0 : 1],
    );
    await logSensitiveAction({ actor_user_id: data.recorded_by, action_type: "ATTRITION_RECORDED", module_key: "WFM", entity_type: "attrition_record", entity_id: id, change_summary: { employee_id: data.employee_id, exit_type: exitType, reason_category: data.reason_category ?? null }, req });
    return id;
  },

  async getSummary(filters: { month?: string; from_date?: string; to_date?: string; process_id?: string } & ScopeFilter) {
    const bounds = monthBounds(filters.month);
    const from = filters.from_date ?? bounds?.from;
    const toExclusive = filters.to_date ?? bounds?.to;
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (from) { conds.push("ar.exit_date >= ?"); params.push(from); }
    if (toExclusive) { conds.push("ar.exit_date < ?"); params.push(toExclusive); }
    if (filters.process_id) { conds.push("ar.process_id = ?"); params.push(filters.process_id); }
    if (filters.sql) { conds.push(`(${filters.sql})`); params.push(...(filters.params ?? [])); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.exit_type, COUNT(*) AS count
         FROM attrition_record ar
         JOIN employees e ON e.id = ar.employee_id
        WHERE ${conds.join(" AND ")}
        GROUP BY ar.exit_type
        ORDER BY count DESC`,
      params,
    );
    const total = rows.reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0);
    const voluntary = rows.filter((row: any) => row.exit_type === "voluntary").reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0);
    const involuntary = total - voluntary;
    const empConds = ["e.active_status = 1", "LOWER(COALESCE(e.employment_status,'active')) = 'active'"];
    const empParams: unknown[] = [];
    if (filters.process_id) { empConds.push("e.process_id = ?"); empParams.push(filters.process_id); }
    if (filters.sql) { empConds.push(`(${filters.sql})`); empParams.push(...(filters.params ?? [])); }
    const [headRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total_active FROM employees e WHERE ${empConds.join(" AND ")}`, empParams);
    const denominator = Number(headRows[0]?.total_active ?? 0);
    return {
      total_exits: total,
      voluntary,
      involuntary,
      attrition_rate: denominator > 0 ? Math.round((total / denominator) * 10000) / 100 : 0,
      by_reason: rows.map((row: any) => ({ reason: row.exit_type, count: Number(row.count ?? 0), pct: total > 0 ? Math.round((Number(row.count ?? 0) / total) * 10000) / 100 : 0 })),
    };
  },
};
