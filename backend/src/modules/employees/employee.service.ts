import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { revokeSessionsForEmployee } from "../../shared/sessionRevocation.js";
import { deprovisionEmployeeAccess } from "../../shared/employeeDeprovisioning.js";
import type { Employee, PaginatedResult } from "./employee.types.js";
import type { CreateEmployeeInput, EmployeeFilters, UpdateEmployeeInput } from "./employee.validation.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";
import { dispatchJoinProvisioningTasks } from "../it-provisioning/it-provisioning.service.js";

const SENSITIVE_FIELDS: Array<{ inputKey: keyof UpdateEmployeeInput; dbCol: string; label: string }> = [
  { inputKey: "branchId",           dbCol: "branch_id",           label: "Branch" },
  { inputKey: "departmentId",       dbCol: "department_id",       label: "Department" },
  { inputKey: "processId",          dbCol: "process_id",          label: "Process" },
  { inputKey: "designationId",      dbCol: "designation_id",      label: "Designation" },
  { inputKey: "reportingManagerId", dbCol: "reporting_manager_id",label: "Reporting Manager" },
  { inputKey: "employmentStatus",   dbCol: "employment_status",   label: "Employment Status" },
  { inputKey: "employmentType",     dbCol: "employment_type",     label: "Employment Type" },
];

const assignSalary = async (employeeId: string, structureId: string, ctcAnnual: number, effectiveFrom: string) => {
  await db.execute(
    "UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id = ? AND active_status = 1",
    [employeeId]
  );
  const asgId = randomUUID();
  await db.execute(
    "INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from) VALUES (?, ?, ?, ?, ?)",
    [asgId, employeeId, structureId, ctcAnnual, effectiveFrom]
  );
};

/**
 * Auto-create auth_user for employee with valid email.
 * Links employees.user_id to auth_user.id so employee can login via password reset.
 */
const createAuthUserForEmployee = async (employeeId: string, email: string): Promise<string | null> => {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if auth_user already exists for this email
  const [existingAuth] = await db.execute<RowDataPacket[]>(
    'SELECT id, is_blocked FROM auth_user WHERE LOWER(email) = LOWER(?) LIMIT 1',
    [normalizedEmail]
  );

  if (existingAuth.length > 0) {
    const authUser = existingAuth[0];
    if (Number(authUser.is_blocked ?? 0) === 1) {
      return null; // Don't link to blocked accounts
    }
    // Link existing auth_user to this employee
    await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [authUser.id, employeeId]);
    return String(authUser.id);
  }

  // Create new auth_user with random password (user must reset via "Forgot Password")
  const userId = randomUUID();
  const randomPassword = randomUUID(); // Secure random password
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  await db.execute(
    'INSERT INTO auth_user (id, email, password_hash, must_change_password, is_blocked) VALUES (?, ?, ?, 1, 0)',
    [userId, normalizedEmail, passwordHash]
  );

  // Link employee to auth_user
  await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employeeId]);

  // Assign default "employee" role if exists
  try {
    const [roleCheck] = await db.execute<RowDataPacket[]>(
      'SELECT role_key FROM workforce_role_catalog WHERE role_key = ? AND active_status = 1 LIMIT 1',
      ['employee']
    );
    if (roleCheck.length > 0) {
      await db.execute(
        'INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (UUID(), ?, ?, 1) ON DUPLICATE KEY UPDATE active_status = 1',
        [userId, 'employee']
      );
    }
  } catch {
    // Non-fatal - role assignment failure shouldn't block employee creation
  }

  return userId;
};

export const employeeService = {
  async createEmployee(input: CreateEmployeeInput, _userId: string): Promise<Employee> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
      [input.employeeCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Employee code already exists");

    // Dedup checks: PAN, Aadhaar, email, mobile against both employees and
    // employee_statutory_info — mirrors the ATS orchestrator path so that a
    // manual HR entry cannot create a second record for an existing employee.
    if (input.panNumber) {
      const pan = String(input.panNumber).trim().toUpperCase();
      const [panDup] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code FROM employees e WHERE e.pan_number = ? AND e.active_status = 1 LIMIT 1`,
        [pan]
      );
      if ((panDup as RowDataPacket[]).length > 0)
        throw new Error(`PAN ${pan} already registered under employee ${(panDup as RowDataPacket[])[0].employee_code}`);
      const [panStat] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code FROM employee_statutory_info si JOIN employees e ON e.id = si.employee_id WHERE si.pan_number = ? AND e.active_status = 1 LIMIT 1`,
        [pan]
      );
      if ((panStat as RowDataPacket[]).length > 0)
        throw new Error(`PAN ${pan} already registered under employee ${(panStat as RowDataPacket[])[0].employee_code}`);
    }
    if (input.aadhaarNumber) {
      const aadhaar = String(input.aadhaarNumber).trim();
      const [aaDup] = await db.execute<RowDataPacket[]>(
        `SELECT e.employee_code FROM employee_statutory_info si JOIN employees e ON e.id = si.employee_id WHERE si.aadhaar_id = ? AND e.active_status = 1 LIMIT 1`,
        [aadhaar]
      );
      if ((aaDup as RowDataPacket[]).length > 0)
        throw new Error(`Aadhaar already registered under employee ${(aaDup as RowDataPacket[])[0].employee_code}`);
    }
    if (input.email) {
      const emailNorm = String(input.email).toLowerCase().trim();
      const [emailDup] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code FROM employees WHERE (LOWER(email) = ? OR LOWER(official_email) = ?) AND active_status = 1 LIMIT 1`,
        [emailNorm, emailNorm]
      );
      if ((emailDup as RowDataPacket[]).length > 0)
        throw new Error(`Email ${emailNorm} already registered under employee ${(emailDup as RowDataPacket[])[0].employee_code}`);
    }
    if (input.mobile) {
      const mobile = String(input.mobile).trim();
      const [mobDup] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code FROM employees WHERE mobile = ? AND active_status = 1 LIMIT 1`,
        [mobile]
      );
      if ((mobDup as RowDataPacket[]).length > 0)
        throw new Error(`Mobile ${mobile} already registered under employee ${(mobDup as RowDataPacket[])[0].employee_code}`);
    }

    const id = randomUUID();
    // salary_start_date defaults to date_of_joining when not explicitly set
    const salaryStartDate = input.salaryStartDate ?? input.dateOfJoining;
    await db.execute(
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, mobile, gender,
          date_of_birth, date_of_joining, salary_start_date, employment_type,
          branch_id, department_id, process_id, designation_id, reporting_manager_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.employeeCode,
        input.firstName,
        input.lastName ?? null,
        input.email ?? null,
        input.mobile ?? null,
        input.gender ?? null,
        input.dateOfBirth ?? null,
        input.dateOfJoining,
        salaryStartDate,
        input.employmentType ?? "Full Time",
        input.branchId ?? null,
        input.departmentId ?? null,
        input.processId ?? null,
        input.designationId ?? null,
        input.reportingManagerId ?? null,
      ]
    );

    // CRITICAL FIX: Auto-create auth_user if employee has valid email
    // This ensures employees can login via "Forgot Password" flow immediately
    if (input.email && input.email.includes('@') && input.email.toLowerCase() !== 'n/a') {
      try {
        await createAuthUserForEmployee(id, input.email);
      } catch (error) {
        // Log but don't block employee creation if auth fails
        console.error(`[WARN] Failed to auto-create auth for employee ${input.employeeCode}:`, error);
      }
    }

    const employee = await this.getEmployee(id);

    // Auto-assign salary when structureId + ctcAnnual provided at creation
    if (input.structureId && input.ctcAnnual) {
      const salaryDate = input.salaryStartDate ?? input.dateOfJoining;
      await assignSalary(id, input.structureId, input.ctcAnnual, salaryDate);
    }

    try {
      const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode: input.employeeCode, createdBy: _userId });
      if (lmsResult.message) {
        console.warn(`[WARN] LMS provisioning for ${input.employeeCode}: ${lmsResult.message}`);
      }
    } catch (error) {
      console.error(`[WARN] Failed to provision LMS identity for employee ${input.employeeCode}:`, error);
    }

    // Dispatch IT/WFM/Admin/HR provisioning tasks (same as ATS orchestrator path)
    dispatchJoinProvisioningTasks({
      employeeId: id,
      employeeCode: input.employeeCode,
      employeeName: employee.full_name,
      branchId: employee.branch_id ?? null,
      actorUserId: _userId,
      triggerEventId: null,
      joiningDate: input.dateOfJoining,
    }).catch(err => console.error(`[WARN] Failed to dispatch provisioning tasks for ${input.employeeCode}:`, err));

    return employee;
  },

  async getEmployee(id: string): Promise<Employee> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT *, COALESCE(NULLIF(TRIM(official_email),''), email) AS email FROM employees WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as Employee[])[0];
    if (!rec) throw new Error("Employee not found");
    return rec;
  },

  async listEmployees(filters: EmployeeFilters & { scopeFilter?: { sql: string; params: unknown[] } }): Promise<PaginatedResult<Employee>> {
    const { page, limit, status, processId, branchId, departmentId, designationId, search, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];

    if (status)       { conds.push("e.employment_status = ?"); params.push(status); }
    if (processId)    { conds.push("e.process_id = ?");        params.push(processId); }
    if (branchId)     { conds.push("e.branch_id = ?");         params.push(branchId); }
    if (departmentId) { conds.push("e.department_id = ?");     params.push(departmentId); }
    if (designationId){ conds.push("e.designation_id = ?");    params.push(designationId); }
    if (search) {
      // full_name alone missed employees whose full_name is empty — fall back to
      // first/last name (and the concatenation, so "First Last" still matches).
      conds.push(`(
        e.full_name LIKE ?
        OR e.first_name LIKE ?
        OR e.last_name LIKE ?
        OR CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) LIKE ?
        OR e.employee_code LIKE ?
        OR e.email LIKE ?
        OR e.official_email LIKE ?
      )`);
      const token = `%${search}%`;
      params.push(token, token, token, token, token, token, token);
    }

    // Apply scope filter from middleware
    if (scopeFilter?.sql) {
      const scopeClause = scopeFilter.sql.replace(/^WHERE\s+/i, '').trim();
      if (scopeClause) {
        conds.push(`(${scopeClause})`);
        params.push(...(scopeFilter.params ?? []));
      }
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    // Use string interpolation for LIMIT/OFFSET to avoid parameter binding issues
    const [[rows], [countRows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT
           e.id, e.employee_code,
           e.first_name, e.last_name,
           e.mobile, e.avatar_url, e.photo_url,
           e.date_of_joining, e.employment_status, e.employment_type,
           e.designation_id, e.department_id, e.branch_id, e.process_id, e.cost_centre_id,
           e.reporting_manager_id,
           COALESCE(NULLIF(TRIM(e.official_email),''), e.email) AS email,
           -- gender is captured by both onboarding paths' first step (candidate journey's
           -- EmployeeForm and the new EmployeeProfileCompletion flow) and by nothing else,
           -- so its absence is a cheap, join-free proxy for "never completed a profile step"
           (e.gender IS NULL) AS profile_incomplete,
           desig.designation_name,
           dept.dept_name        AS department_name,
           cc.cost_centre_name,
           pm.process_name,
           bm.branch_name,
           CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name,'')) AS reporting_manager_name
         FROM employees e
         LEFT JOIN designation_master  desig ON desig.id = e.designation_id
         LEFT JOIN department_master   dept  ON dept.id  = e.department_id
         LEFT JOIN cost_centre_master  cc    ON cc.id    = e.cost_centre_id
         LEFT JOIN process_master      pm    ON pm.id    = e.process_id
         LEFT JOIN branch_master       bm    ON bm.id    = e.branch_id
         LEFT JOIN employees           mgr   ON mgr.id   = COALESCE(e.reporting_manager_id, e.manager_id)
         ${where} ORDER BY e.employee_code ASC LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM employees e ${where}`, params
      ),
    ]);
    return { data: rows as Employee[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async updateEmployee(id: string, input: UpdateEmployeeInput, actorUserId: string): Promise<Employee> {
    // Snapshot current sensitive field values before update for audit trail
    const [snapRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id, department_id, process_id, designation_id,
              reporting_manager_id, employment_status, employment_type, active_status
       FROM employees WHERE id = ? LIMIT 1`,
      [id]
    );
    const snap = snapRows[0] ?? {};

    // employment_status and active_status are two different columns describing one
    // fact, and this endpoint only ever wrote the first. HR marking a leaver
    // "Inactive" in the employee directory therefore dropped them from payroll
    // (which reads employment_status) while leaving every access gate — login,
    // token refresh, requireAuth — reading active_status = 1 and letting them in.
    // Measured 2026-08-10: 1 employee sat in exactly that split state, and 10 sat
    // in the mirror image, labelled active with their login already dead.
    const nextStatus = input.employmentStatus?.trim().toLowerCase();
    const isDeactivating = nextStatus === "inactive";
    const wasActive = Number(snap.active_status ?? 1) === 1;
    const deactivationReason = (input as { deactivationReason?: string }).deactivationReason?.trim();

    // Cutting someone's access is not an ordinary field edit, and until now it
    // left no trace of why. Of the five employment-status audit rows ever
    // written, all five are 'active' → 'Active' case flips from the edit dialog
    // re-saving an unchanged value — not one records an actual deactivation.
    if (isDeactivating && wasActive && (!deactivationReason || deactivationReason.length < 10)) {
      throw Object.assign(
        new Error("A reason of at least 10 characters is required to deactivate an employee."),
        { statusCode: 400, code: "DEACTIVATION_REASON_REQUIRED" }
      );
    }

    // Reactivation is a governed flow — a reason, branch-head approval, then HR
    // confirmation (employee-reactivation.routes.ts). Letting a plain profile save
    // restore a leaver by flipping a dropdown would route around all of it, so the
    // Active direction is refused here rather than silently synced. Setting "Active"
    // on someone who is already active stays a no-op: the edit dialog sends the
    // field on every save, and rejecting that would break ordinary profile edits.
    //
    // Refused only when the request actually CHANGES the label to Active. Ten
    // employees on production are already labelled Active while carrying
    // active_status = 0 — they joined 7-8 June and the activation job never ran
    // for them. Keying this off active_status alone locked HR out of editing
    // those records at all, because the dialog resends the unchanged "Active" on
    // every save. Re-sending a value that is already stored grants nothing:
    // active_status is untouched here, so those employees stay signed out until
    // the reactivation flow or the activation job puts them right.
    const wasStatusActive = String(snap.employment_status ?? "").trim().toLowerCase() === "active";
    if (nextStatus === "active" && !wasActive && !wasStatusActive) {
      throw Object.assign(
        new Error(
          "This employee is deactivated. Reactivation must go through Employees → Reactivation (/employees/reactivation), which records a reason and takes branch head approval and HR confirmation. It cannot be done from a profile edit."
        ),
        { statusCode: 409, code: "REACTIVATION_REQUIRES_APPROVAL" }
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.firstName         !== undefined) { sets.push("first_name = ?");           params.push(input.firstName); }
    if (input.lastName          !== undefined) { sets.push("last_name = ?");            params.push(input.lastName ?? null); }
    if (input.email             !== undefined) { sets.push("email = ?");                params.push(input.email ?? null); }
    if (input.officialEmail     !== undefined) { sets.push("official_email = ?");       params.push(input.officialEmail ?? null); }
    if (input.mobile            !== undefined) { sets.push("mobile = ?");               params.push(input.mobile ?? null); }
    if (input.personalEmail     !== undefined) { sets.push("personal_email = ?");       params.push(input.personalEmail ?? null); }
    if (input.personalMobile    !== undefined) { sets.push("personal_phone = ?");       params.push(input.personalMobile ?? null); }
    if (input.gender            !== undefined) { sets.push("gender = ?");               params.push(input.gender); }
    if (input.dateOfBirth       !== undefined) { sets.push("date_of_birth = ?");        params.push(input.dateOfBirth ?? null); }
    if (input.dateOfJoining     !== undefined) { sets.push("date_of_joining = ?");      params.push(input.dateOfJoining); }
    if (input.salaryStartDate   !== undefined) { sets.push("salary_start_date = ?");    params.push(input.salaryStartDate ?? null); }
    if (input.dateOfExit        !== undefined) { sets.push("date_of_exit = ?");         params.push(input.dateOfExit ?? null); }
    if (input.employmentType    !== undefined) { sets.push("employment_type = ?");      params.push(input.employmentType); }
    if (input.employmentStatus  !== undefined) { sets.push("employment_status = ?");    params.push(input.employmentStatus); }
    if (input.branchId          !== undefined) { sets.push("branch_id = ?");            params.push(input.branchId ?? null); }
    if (input.departmentId      !== undefined) { sets.push("department_id = ?");        params.push(input.departmentId ?? null); }
    if (input.processId         !== undefined) { sets.push("process_id = ?");           params.push(input.processId ?? null); }
    if ((input as any).costCentreId !== undefined) { sets.push("cost_centre_id = ?");   params.push((input as any).costCentreId ?? null); }
    if (input.designationId     !== undefined) { sets.push("designation_id = ?");       params.push(input.designationId ?? null); }
    if (input.reportingManagerId !== undefined) { sets.push("reporting_manager_id = ?"); params.push(input.reportingManagerId ?? null); }
    if (input.photoUrl          !== undefined) { sets.push("photo_url = ?");            params.push(input.photoUrl ?? null); }
    if (input.designationName   !== undefined) { sets.push("designation = ?");          params.push(input.designationName ?? null); }
    if (input.address1          !== undefined) { sets.push("address1 = ?");             params.push(input.address1 ?? null); }
    if (input.city              !== undefined) { sets.push("city = ?");                 params.push(input.city ?? null); }
    if (input.workingHoursStart !== undefined) { sets.push("working_hours_start = ?");  params.push(input.workingHoursStart ?? null); }
    if (input.workingHoursEnd   !== undefined) { sets.push("working_hours_end = ?");    params.push(input.workingHoursEnd ?? null); }
    if (input.workingDays       !== undefined) { sets.push("working_days = ?");         params.push(input.workingDays ? JSON.stringify(input.workingDays) : null); }
    if (input.annualIncome      !== undefined) { sets.push("annual_income = ?");        params.push(input.annualIncome ?? null); }
    if (input.countOfDependents !== undefined) { sets.push("count_of_dependents = ?");  params.push(input.countOfDependents ?? null); }

    // Carry the deactivation across to the column the access gates actually read,
    // in the same statement, so the two can never disagree again.
    if (isDeactivating && wasActive) { sets.push("active_status = 0"); }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, params);

      // Audit any sensitive field changes
      const changedSensitive = SENSITIVE_FIELDS.filter(
        (f) => input[f.inputKey] !== undefined && String(input[f.inputKey] ?? "") !== String(snap[f.dbCol] ?? "")
      );
      if (changedSensitive.length > 0) {
        const oldVals: Record<string, unknown> = {};
        const newVals: Record<string, unknown> = {};
        for (const f of changedSensitive) {
          oldVals[f.label] = snap[f.dbCol] ?? null;
          newVals[f.label] = input[f.inputKey] ?? null;
        }
        void logSensitiveAction({
          actor_user_id: actorUserId,
          action_type: "EMPLOYEE_PROFILE_UPDATED",
          module_key: "employees",
          entity_type: "employee",
          entity_id: id,
          employee_id: id,
          change_summary: { fields: changedSensitive.map((f) => f.label) },
          old_value_json: oldVals,
          new_value_json: newVals,
          reason: deactivationReason,
        });
      }

      // Same reasoning as the deactivate endpoint: clearing active_status stops
      // the next login and the next refresh, not the token already issued.
      if (isDeactivating && wasActive) {
        // EMPLOYEE_DEACTIVATED is the canonical "this person's access was taken
        // away" marker, and both deactivation paths must emit it — the daily
        // activation job keys its re-activation guard off exactly this
        // action_type. The EMPLOYEE_PROFILE_UPDATED row above records the field
        // change but does not distinguish a deactivation from any other edit,
        // so keying the guard off that would either miss deactivations or catch
        // every ordinary profile save.
        void logSensitiveAction({
          actor_user_id: actorUserId,
          action_type: "EMPLOYEE_DEACTIVATED",
          module_key: "employees",
          entity_type: "employee",
          entity_id: id,
          employee_id: id,
          change_summary: { fields: ["Employment Status", "Active Status"], via: "profile_update" },
          old_value_json: { "Employment Status": snap.employment_status ?? null, "Active Status": 1 },
          new_value_json: { "Employment Status": "Inactive", "Active Status": 0 },
          reason: deactivationReason,
        });

        await revokeSessionsForEmployee(id, "employment_status_set_inactive");

        // Deactivating from the directory is how ~2,650 of the last 2,652
        // departures were recorded, so the consequences of leaving cannot live
        // only in the exit flow. LMS access and future leave are withdrawn here
        // too. Deliberately NOT full & final: that is keyed to an exit_request
        // and belongs to payroll, and manufacturing a settlement record from a
        // profile edit would be worse than not having one.
        const deprovision = await deprovisionEmployeeAccess(id, "employment_status_set_inactive");
        if (deprovision.failures.length > 0) {
          process.stderr.write(JSON.stringify({
            level: "error", module: "employees", event: "DEPROVISION_INCOMPLETE",
            employee_id: id, failures: deprovision.failures,
            timestamp: new Date().toISOString(),
          }) + "\\n");
        }
      }
    }

    // Sync auth_user.email = official_email when official_email updated
    if (input.officialEmail) {
      const newEmail = input.officialEmail.toLowerCase().trim();
      const [empRows] = await db.execute<RowDataPacket[]>(
        'SELECT user_id FROM employees WHERE id = ? LIMIT 1', [id]
      );
      const userId = (empRows as any[])[0]?.user_id;
      if (userId) {
        const [conflict] = await db.execute<RowDataPacket[]>(
          'SELECT id FROM auth_user WHERE LOWER(email) = ? AND id != ? LIMIT 1', [newEmail, userId]
        );
        if (!(conflict as any[]).length) {
          await db.execute('UPDATE auth_user SET email = ? WHERE id = ?', [newEmail, userId]);
        }
      }
    }

    return this.getEmployee(id);
  },

  async deactivateEmployee(id: string, actorUserId: string, reason?: string): Promise<void> {
    const existing = await this.getEmployee(id);

    // This endpoint recorded nothing at all — the actor argument was received as
    // `_userId` and discarded, so the single UI path that genuinely revoked
    // access was also the only one with no audit trail and no stated reason.
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 10) {
      throw Object.assign(
        new Error("A reason of at least 10 characters is required to deactivate an employee."),
        { statusCode: 400, code: "DEACTIVATION_REASON_REQUIRED" }
      );
    }

    await db.execute(
      "UPDATE employees SET active_status = 0, employment_status = 'Inactive' WHERE id = ?",
      [id]
    );

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "EMPLOYEE_DEACTIVATED",
      module_key: "employees",
      entity_type: "employee",
      entity_id: id,
      employee_id: id,
      change_summary: { fields: ["Employment Status", "Active Status"] },
      old_value_json: {
        "Employment Status": (existing as { employment_status?: unknown }).employment_status ?? null,
        "Active Status": (existing as { active_status?: unknown }).active_status ?? null,
      },
      new_value_json: { "Employment Status": "Inactive", "Active Status": 0 },
      reason: trimmedReason,
    });
    // Clearing active_status stops the next login and the next token refresh, but
    // not the access token already issued — that stayed good for up to 24h. Cut
    // the live sessions too, so "deactivated" means access ends now.
    await revokeSessionsForEmployee(id, "employee_deactivated");
    await deprovisionEmployeeAccess(id, "employee_deactivated");
  },

  // ── Org Chart tree endpoint ──────────────────────────────────────────────
  async getOrgTree(params: {
    userId: string;
    processId?: string;
    branchId?: string;
    departmentId?: string;
  }): Promise<{ nodes: OrgTreeServiceNode[]; totalCount: number }> {
    const { userId, processId, branchId, departmentId } = params;

    // Resolve requester roles
    const [roleRows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
      [userId]
    );
    const roles = (roleRows as { role_key: string }[]).map((r) => r.role_key);

    const isSuperAdmin = roles.includes("super_admin");
    const isAdmin      = roles.includes("admin");
    const isCeo        = roles.includes("ceo");
    const isHr         = roles.includes("hr");
    const isBranchHead = roles.includes("branch_head");
    const isProcMgr    = roles.includes("process_manager") || roles.includes("manager");
    const isWfm        = roles.includes("wfm") || roles.includes("operations_manager");

    // Resolve own employee record for scope lookups
    const [selfRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, branch_id, process_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
      [userId]
    );
    const self = (selfRows as { id: string; branch_id: string | null; process_id: string | null }[])[0];

    // Build scope WHERE
    const wheres: string[] = ["e.active_status = 1"];
    const qp: unknown[] = [];

    if (isSuperAdmin || isAdmin || isCeo || isHr) {
      if (processId)    { wheres.push("e.process_id = ?");    qp.push(processId); }
      if (branchId)     { wheres.push("e.branch_id = ?");     qp.push(branchId); }
      if (departmentId) { wheres.push("e.department_id = ?"); qp.push(departmentId); }
    } else if (isBranchHead) {
      const scopeBranch = self?.branch_id;
      if (!scopeBranch) return { nodes: [], totalCount: 0 };
      wheres.push("e.branch_id = ?");
      qp.push(scopeBranch);
    } else if (isProcMgr || isWfm) {
      const scopeProcess = self?.process_id;
      if (!scopeProcess) return { nodes: [], totalCount: 0 };
      wheres.push("e.process_id = ?");
      qp.push(scopeProcess);
    } else {
      // Employee / executive / agent: scope to own process
      const scopeProcess = self?.process_id;
      if (scopeProcess) {
        wheres.push("e.process_id = ?");
        qp.push(scopeProcess);
      } else if (self?.id) {
        wheres.push("e.id = ?");
        qp.push(self.id);
      } else {
        return { nodes: [], totalCount: 0 };
      }
    }

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id,
         e.employee_code,
         TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
         d.designation_name AS designation,
         p.process_name,
         b.branch_name,
         dept.dept_name AS department_name,
         e.process_id,
         e.branch_id AS emp_branch_id,
         COALESCE(NULLIF(TRIM(e.avatar_url), ''), NULLIF(TRIM(e.photo_url), '')) AS avatar_url,
         COALESCE(e.reporting_manager_id, e.manager_id) AS reporting_manager_id,
         (SELECT ur2.role_key FROM user_roles ur2
          WHERE ur2.user_id = e.user_id AND ur2.active_status = 1
          ORDER BY FIELD(ur2.role_key,
            'super_admin','admin','ceo','hr','branch_head',
            'process_manager','manager','team_leader','tl',
            'assistant_manager','employee') LIMIT 1
         ) AS role_key,
         e.active_status
       FROM employees e
       LEFT JOIN designation_master d    ON d.id    = e.designation_id
       LEFT JOIN process_master    p     ON p.id    = e.process_id
       LEFT JOIN branch_master     b     ON b.id    = e.branch_id
       LEFT JOIN department_master dept  ON dept.id = e.department_id
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.date_of_joining ASC`,
      qp
    );

    const employees = empRows as OrgTreeServiceNode[];
    const totalCount = employees.length;

    // Build tree strictly from real reporting_manager_id data — no synthetic inference
    const byId = new Map<string, OrgTreeServiceNode & { children: OrgTreeServiceNode[] }>();
    for (const emp of employees) {
      byId.set(emp.id, { ...emp, children: [] });
    }

    const scopedIds = new Set(employees.map((e) => e.id));
    const roots: (OrgTreeServiceNode & { children: OrgTreeServiceNode[] })[] = [];

    for (const emp of employees) {
      const mgr = emp.reporting_manager_id;
      if (!mgr || !scopedIds.has(mgr)) {
        roots.push(byId.get(emp.id)!);
      } else {
        byId.get(mgr)!.children.push(byId.get(emp.id)!);
      }
    }

    return { nodes: roots, totalCount };
  },
};

// Internal type for org tree — not exported to avoid polluting Employee types
interface OrgTreeServiceNode {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  process_name: string | null;
  branch_name: string | null;
  department_name: string | null;
  avatar_url: string | null;
  reporting_manager_id: string | null;
  role_key: string | null;
  active_status: number;
  children: OrgTreeServiceNode[];
}
