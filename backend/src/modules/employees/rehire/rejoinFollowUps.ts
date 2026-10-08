import type { RowDataPacket } from "mysql2";
import type { SqlExecutor } from "./rehireFacts.js";

export interface FollowUpResult {
  step: "auth" | "lms" | "it_provisioning";
  ok: boolean;
  detail?: string;
}

export interface FollowUpInput {
  requestId: string;
  employeeId: string;
  approverId: string;
  /** The rejoin date, 'YYYY-MM-DD'. */
  rejoinDate: string;
}

/** The two side-effecting dependencies are injected so this unit never imports auth or IT-provisioning modules. */
export interface FollowUpDeps {
  invalidateAuthContextCache: (userId: string) => void;
  dispatchJoinProvisioningTasks: (input: {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    branchId: string | null;
    actorUserId: string;
    joiningDate?: string;
  }) => Promise<unknown>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What exit switched off, switched back on. Runs AFTER the approval has committed and never throws:
 * a failed follow-up is recorded and returned so HR can see it, it does not undo the approval.
 *
 * Deliberately NOT here (see the plan's research notes):
 *  - login re-provisioning: exit never blocks auth_user or touches roles, so active_status=1 already
 *    restores login; only the 30s auth cache needs clearing.
 *  - leave: exit never zeroes the ledger and the rejoin gap is at most 30 days, so balances stand.
 *  - reportees orphaned at exit: they may have been reassigned since.
 */
export async function runRejoinFollowUps(
  db: SqlExecutor,
  deps: FollowUpDeps,
  input: FollowUpInput,
): Promise<FollowUpResult[]> {
  const results: FollowUpResult[] = [];

  let emp: RowDataPacket | undefined;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code,
              COALESCE(NULLIF(full_name, ''), CONCAT(first_name, ' ', last_name)) AS full_name,
              branch_id, user_id
         FROM employees WHERE id = ?`,
      [input.employeeId],
    );
    emp = rows[0];
  } catch (e) {
    const detail = `could not load the employee: ${msg(e)}`;
    return (["auth", "lms", "it_provisioning"] as const).map((step) => ({ step, ok: false, detail }));
  }
  if (!emp) {
    return (["auth", "lms", "it_provisioning"] as const).map((step) => ({ step, ok: false, detail: "employee not found" }));
  }

  // 1. Login: clear the auth cache so access returns at once; flag when there is no account to revive.
  try {
    if (emp.user_id) {
      deps.invalidateAuthContextCache(String(emp.user_id));
      results.push({ step: "auth", ok: true });
    } else {
      results.push({ step: "auth", ok: false, detail: "No login account is linked to this employee; HR must create one." });
    }
  } catch (e) {
    results.push({ step: "auth", ok: false, detail: msg(e) });
  }

  // 2. LMS: exit set is_active = 0.
  try {
    await db.execute(`UPDATE lms_employee_mapping SET is_active = 1 WHERE employee_id = ?`, [input.employeeId]);
    results.push({ step: "lms", ok: true });
  } catch (e) {
    results.push({ step: "lms", ok: false, detail: msg(e) });
  }

  // 3. IT: exit raised email / biometric / dialer / domain DELETE tasks; raise the join tasks again,
  //    unless one is already open (do not double-raise on a retry).
  try {
    const [openRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM it_provisioning_request
        WHERE employee_id = ? AND request_type = 'join' AND status NOT IN ('confirmed', 'waived')`,
      [input.employeeId],
    );
    if (Number(openRows[0]?.n) > 0) {
      results.push({ step: "it_provisioning", ok: true, detail: "A join provisioning request is already open." });
    } else {
      await deps.dispatchJoinProvisioningTasks({
        employeeId: String(emp.id),
        employeeCode: String(emp.employee_code),
        employeeName: String(emp.full_name ?? "").trim(),
        branchId: emp.branch_id ?? null,
        actorUserId: input.approverId,
        joiningDate: input.rejoinDate,
      });
      results.push({ step: "it_provisioning", ok: true });
    }
  } catch (e) {
    results.push({ step: "it_provisioning", ok: false, detail: msg(e) });
  }

  // 4. Audit. A failing audit write must not mask the results.
  try {
    await db.execute(
      `INSERT INTO employee_reactivation_audit (request_id, action, actioned_by, remarks, metadata)
       VALUES (?, 'rejoin_followups', ?, ?, ?)`,
      [
        input.requestId,
        input.approverId,
        results.every((r) => r.ok) ? "all follow-ups completed" : "some follow-ups need attention",
        JSON.stringify({ steps: results }),
      ],
    );
  } catch {
    /* the results are still returned to the caller */
  }

  return results;
}
