import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { getUserRoleKeys, getUserAssignmentScopes } from "../../shared/scopeAccess.js";

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnsFor(tableName: string): Promise<Set<string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return new Set((rows as any[]).map((r) => String(r.column_name)));
}

function pickColumns(available: Set<string>, desired: string[]): string[] {
  return desired.filter((col) => available.has(col));
}

function escapeId(id: string): string {
  return `\`${id.replace(/`/g, "``")}\``;
}

async function scopedWhereForUser(userId: string, alias = "e"): Promise<{ where: string; params: unknown[]; roles: string[] }> {
  const roles = await getUserRoleKeys(userId);
  if (roles.includes("admin") || roles.includes("hr") || roles.includes("ceo")) {
    return { where: "1=1", params: [], roles };
  }

  const emp = await getEmployeeForUser(userId);
  if (!emp) return { where: "1=0", params: [], roles };

  if (roles.includes("employee")) {
    return { where: `${alias}.id = ?`, params: [emp.id], roles };
  }

  const scopes = await getUserAssignmentScopes(userId);
  if (scopes.some((s: any) => String(s.scope_type).toLowerCase() === "all")) {
    return { where: "1=1", params: [], roles };
  }

  const ors: string[] = [];
  const params: unknown[] = [];
  for (const scope of scopes) {
    const type = String(scope.scope_type ?? "").toLowerCase();
    if (type === "branch" && scope.branch_id) {
      ors.push(`${alias}.branch_id = ?`);
      params.push(scope.branch_id);
    } else if (type === "process" && scope.process_id) {
      if (scope.branch_id) {
        ors.push(`(${alias}.process_id = ? AND ${alias}.branch_id = ?)`);
        params.push(scope.process_id, scope.branch_id);
      } else {
        ors.push(`${alias}.process_id = ?`);
        params.push(scope.process_id);
      }
    } else if (type === "branch_process" && scope.branch_id && scope.process_id) {
      ors.push(`(${alias}.branch_id = ? AND ${alias}.process_id = ?)`);
      params.push(scope.branch_id, scope.process_id);
    } else if (type === "department" && scope.department_id) {
      ors.push(`${alias}.department_id = ?`);
      params.push(scope.department_id);
    } else if (type === "team" && scope.manager_employee_id) {
      ors.push(`(${alias}.reporting_manager_id = ? OR ${alias}.manager_employee_id = ?)`);
      params.push(scope.manager_employee_id, scope.manager_employee_id);
    }
  }

  if (ors.length === 0) return { where: `${alias}.id = ?`, params: [emp.id], roles };
  return { where: `(${ors.join(" OR ")})`, params, roles };
}

async function canSeeScope(userId: string, scope: { branch_id?: string | null; process_id?: string | null; assigned_employee_id?: string | null; assigned_user_id?: string | null; target_employee_id?: string | null; target_user_id?: string | null; target_role?: string | null; assigned_role?: string | null }): Promise<boolean> {
  const roles = await getUserRoleKeys(userId);
  if (roles.includes("admin") || roles.includes("hr") || roles.includes("ceo")) return true;
  const emp = await getEmployeeForUser(userId);
  if (scope.assigned_user_id && scope.assigned_user_id === userId) return true;
  if (scope.target_user_id && scope.target_user_id === userId) return true;
  if (emp && scope.assigned_employee_id && scope.assigned_employee_id === emp.id) return true;
  if (emp && scope.target_employee_id && scope.target_employee_id === emp.id) return true;
  const targetRole = scope.assigned_role ?? scope.target_role ?? null;
  // If item has assigned_role but user doesn't have that role, deny (unless already matched above)
  if (targetRole && !roles.includes(targetRole)) return false;

  // If item has assigned_role but no specific user/employee, allow users with that role
  if (targetRole && roles.includes(targetRole) && !scope.assigned_user_id && !scope.assigned_employee_id) return true;

  const scopes = await getUserAssignmentScopes(userId, targetRole ? [targetRole] : roles);
  // Scope record matching: "all", "branch", "process", "branch_process", "team", "department"
  return scopes.some((s: any) => {
    const type = String(s.scope_type ?? "").toLowerCase();
    if (type === "all") return true;
    if (type === "branch" && s.branch_id && scope.branch_id) return s.branch_id === scope.branch_id;
    if (type === "process" && s.process_id && scope.process_id) return s.process_id === scope.process_id;
    if (type === "branch_process" && s.branch_id && s.process_id) return s.branch_id === scope.branch_id && s.process_id === scope.process_id;
    // Team and department scopes require employee context (safely check with optional chaining)
    if (emp && type === "team" && s.team_id && (emp as any).team_id) return s.team_id === (emp as any).team_id;
    if (emp && type === "department" && s.department_id && (emp as any).department_id) return s.department_id === (emp as any).department_id;
    return false;
  });
}

export const controlTowerService = {
  async createEvent(input: any, userId: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO global_event_log
       (id, event_type, module_key, entity_type, entity_id, title, message, severity, target_role, target_employee_id, target_user_id, branch_id, process_id, action_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.eventType ?? input.event_type,
        input.moduleKey ?? input.module_key ?? "CONTROL_TOWER",
        input.entityType ?? input.entity_type ?? null,
        input.entityId ?? input.entity_id ?? null,
        input.title,
        input.message ?? null,
        input.severity ?? "info",
        input.targetRole ?? input.target_role ?? null,
        input.targetEmployeeId ?? input.target_employee_id ?? null,
        input.targetUserId ?? input.target_user_id ?? null,
        input.branchId ?? input.branch_id ?? null,
        input.processId ?? input.process_id ?? null,
        input.actionUrl ?? input.action_url ?? null,
        userId,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM global_event_log WHERE id = ?", [id]);
    return rows[0];
  },

  async listEvents(query: any, userId: string) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (query.moduleKey) { conds.push("module_key = ?"); params.push(query.moduleKey); }
    if (query.severity) { conds.push("severity = ?"); params.push(query.severity); }
    if (query.status) { conds.push("event_status = ?"); params.push(query.status); }
    if (query.branchId) { conds.push("branch_id = ?"); params.push(query.branchId); }
    if (query.processId) { conds.push("process_id = ?"); params.push(query.processId); }
    const limit = Math.min(Number(query.limit ?? 50), 200);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM global_event_log WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit]
    );
    const visible = [] as any[];
    for (const row of rows as any[]) {
      if (await canSeeScope(userId, row)) visible.push(row);
    }
    return visible;
  },

  async createInboxItem(input: any, userId: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO work_inbox_item
       (id, event_id, module_key, task_type, title, description, priority, assigned_role, assigned_employee_id, assigned_user_id, branch_id, process_id, due_at, action_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.eventId ?? input.event_id ?? null,
        input.moduleKey ?? input.module_key ?? "CONTROL_TOWER",
        input.taskType ?? input.task_type ?? "manual_task",
        input.title,
        input.description ?? null,
        input.priority ?? "medium",
        input.assignedRole ?? input.assigned_role ?? null,
        input.assignedEmployeeId ?? input.assigned_employee_id ?? null,
        input.assignedUserId ?? input.assigned_user_id ?? null,
        input.branchId ?? input.branch_id ?? null,
        input.processId ?? input.process_id ?? null,
        input.dueAt ?? input.due_at ?? null,
        input.actionUrl ?? input.action_url ?? null,
        userId,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM work_inbox_item WHERE id = ?", [id]);
    return rows[0];
  },

  async listWorkInbox(query: any, userId: string) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (query.status) { conds.push("status = ?"); params.push(query.status); } else { conds.push("status IN ('open','in_progress')"); }
    if (query.moduleKey) { conds.push("module_key = ?"); params.push(query.moduleKey); }
    if (query.priority) { conds.push("priority = ?"); params.push(query.priority); }
    const limit = Math.min(Number(query.limit ?? 100), 250);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         wii.*,
         CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')) AS owner_name,
         TIMESTAMPDIFF(HOUR, wii.created_at, NOW()) AS aging_hours,
         CASE wii.priority
           WHEN 'urgent' THEN 3
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 1
           ELSE 0
         END AS escalation_level,
         NULL AS decision_required_from
       FROM work_inbox_item wii
       LEFT JOIN users u ON u.id = wii.user_id
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE ${conds.join(" AND ")}
       ORDER BY FIELD(wii.priority,'urgent','high','normal','low'), COALESCE(wii.created_at, '2999-12-31'), wii.created_at DESC
       LIMIT ?`,
      [...params, limit]
    );
    const visible = [] as any[];
    for (const row of rows as any[]) {
      if (await canSeeScope(userId, row)) visible.push(row);
    }
    return visible;
  },

  async completeInboxItem(id: string, userId: string) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM work_inbox_item WHERE id = ? LIMIT 1", [id]);
    const row = (rows as any[])[0];
    if (!row) throw Object.assign(new Error("Inbox item not found"), { statusCode: 404 });
    if (!(await canSeeScope(userId, row))) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    await db.execute("UPDATE work_inbox_item SET status = 'completed', completed_by = ?, completed_at = NOW() WHERE id = ?", [userId, id]);
    const [updated] = await db.execute<RowDataPacket[]>("SELECT * FROM work_inbox_item WHERE id = ?", [id]);
    return updated[0];
  },

  async getMasterDataHealth(userId: string) {
    if (!(await tableExists("employees"))) return { checks: [], total_issues: 0 };
    const cols = await columnsFor("employees");
    const scope = await scopedWhereForUser(userId, "e");
    const checks: any[] = [];

    async function countIssue(code: string, label: string, condition: string, extraParams: unknown[] = []) {
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM employees e WHERE ${scope.where} AND ${condition}`, [...scope.params, ...extraParams]);
      checks.push({ code, label, count: Number((rows[0] as any)?.c ?? 0), severity: Number((rows[0] as any)?.c ?? 0) > 0 ? "high" : "info" });
    }

    if (cols.has("branch_id")) await countIssue("MISSING_BRANCH", "Active employees without branch", "e.active_status = 1 AND (e.branch_id IS NULL OR e.branch_id = '')");
    if (cols.has("process_id")) await countIssue("MISSING_PROCESS", "Active employees without process", "e.active_status = 1 AND (e.process_id IS NULL OR e.process_id = '')");
    if (cols.has("user_id")) await countIssue("MISSING_LOGIN_USER", "Active employees without login user mapping", "e.active_status = 1 AND (e.user_id IS NULL OR e.user_id = '')");
    if (cols.has("reporting_manager_id")) await countIssue("MISSING_MANAGER", "Active employees without reporting manager", "e.active_status = 1 AND (e.reporting_manager_id IS NULL OR e.reporting_manager_id = '')");
    if (await tableExists("wfm_roster_assignment") && cols.has("id")) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id WHERE ${scope.where} AND e.active_status = 0 AND ra.roster_date >= CURDATE()`,
        scope.params
      );
      checks.push({ code: "INACTIVE_ROSTERED", label: "Inactive employees rostered for future dates", count: Number((rows[0] as any)?.c ?? 0), severity: Number((rows[0] as any)?.c ?? 0) > 0 ? "critical" : "info" });
    }

    return { checks, total_issues: checks.reduce((sum, c) => sum + c.count, 0) };
  },

  async getEmployee360(employeeId: string, userId: string) {
    if (!(await tableExists("employees"))) throw Object.assign(new Error("Employees table not found"), { statusCode: 404 });
    const empCols = await columnsFor("employees");
    const desired = ["id","employee_code","full_name","first_name","last_name","email","phone","mobile","branch_id","process_id","department_id","designation","employee_status","active_status","joining_date","reporting_manager_id"];
    const selectCols = pickColumns(empCols, desired).map(escapeId).join(", ");
    const [empRows] = await db.execute<RowDataPacket[]>(`SELECT ${selectCols || "id"} FROM employees WHERE id = ? LIMIT 1`, [employeeId]);
    const employee = (empRows as any[])[0];
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    if (!(await canSeeScope(userId, { branch_id: employee.branch_id, process_id: employee.process_id, assigned_employee_id: employee.id }))) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }

    const summary: any = { employee, leave_requests: [], roster: [], risks: [], activities: [] };
    if (await tableExists("leave_request")) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM leave_request WHERE employee_id = ? ORDER BY applied_at DESC LIMIT 10", [employeeId]);
      summary.leave_requests = rows;
    }
    if (await tableExists("wfm_roster_assignment")) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM wfm_roster_assignment WHERE employee_id = ? ORDER BY roster_date DESC LIMIT 14", [employeeId]);
      summary.roster = rows;
    }
    if (await tableExists("management_risk_register")) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM management_risk_register WHERE owner_employee_id = ? OR source_entity_id = ? ORDER BY created_at DESC LIMIT 10", [employeeId, employeeId]);
      summary.risks = rows;
    }
    if (await tableExists("employee_360_activity_log")) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM employee_360_activity_log WHERE employee_id = ? ORDER BY created_at DESC LIMIT 25", [employeeId]);
      summary.activities = rows;
    }
    return summary;
  },

  async getManagerTeamHierarchy(userId: string, targetManagerId?: string) {
    // Get the employee record for the requesting user
    const requestingEmp = await getEmployeeForUser(userId);
    if (!requestingEmp) {
      return { manager: null, direct_reports: [], team_summary: { total: 0, by_designation: {}, by_department: {} } };
    }

    // Determine which manager's team to show
    const managerId = targetManagerId || requestingEmp.id;

    // Get manager details
    const [managerRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
              e.email, e.official_email, e.mobile, e.designation_id,
              d.designation_name, dept.dept_name, b.branch_name, p.process_name,
              e.avatar_url
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE e.id = ? AND e.active_status = 1
       LIMIT 1`,
      [managerId]
    );

    const manager = (managerRows as any[])[0] || null;
    if (!manager) {
      return { manager: null, direct_reports: [], team_summary: { total: 0, by_designation: {}, by_department: {} } };
    }

    // Get direct reports
    const [teamRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
              e.email, e.official_email, e.mobile, e.phone,
              e.designation_id, d.designation_name,
              e.department_id, dept.dept_name,
              e.branch_id, b.branch_name,
              e.process_id, p.process_name,
              e.employment_status, e.employment_type,
              e.date_of_joining, e.avatar_url,
              e.reporting_manager_id
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE e.reporting_manager_id = ?
         AND e.active_status = 1
         AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive', 'terminated', 'offboarded', 'absconded')
       ORDER BY d.designation_name, e.first_name`,
      [managerId]
    );

    const directReports = teamRows as any[];

    // Calculate team summary
    const byDesignation: Record<string, number> = {};
    const byDepartment: Record<string, number> = {};

    for (const member of directReports) {
      const desig = member.designation_name || 'Unassigned';
      const dept = member.dept_name || 'Unassigned';
      byDesignation[desig] = (byDesignation[desig] || 0) + 1;
      byDepartment[dept] = (byDepartment[dept] || 0) + 1;
    }

    return {
      manager,
      direct_reports: directReports,
      team_summary: {
        total: directReports.length,
        by_designation: byDesignation,
        by_department: byDepartment,
      },
    };
  },

  async getRiskSummary(query: any, userId: string) {
    const out: any = { open_risks: [], counts: {}, generated_risks: [] };
    if (await tableExists("management_risk_register")) {
      const conds = ["status IN ('open','in_progress')"];
      const params: unknown[] = [];
      if (query.branchId) { conds.push("branch_id = ?"); params.push(query.branchId); }
      if (query.processId) { conds.push("process_id = ?"); params.push(query.processId); }
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM management_risk_register WHERE ${conds.join(" AND ")} ORDER BY FIELD(severity,'critical','high','medium','low'), created_at DESC LIMIT 50`, params);
      for (const row of rows as any[]) if (await canSeeScope(userId, row)) out.open_risks.push(row);
    }
    if (await tableExists("wfm_roster_conflict_log")) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT severity, COUNT(*) AS c FROM wfm_roster_conflict_log WHERE resolution_status = 'open' GROUP BY severity");
      out.counts.roster_conflicts = rows;
    }
    const masterHealth = await this.getMasterDataHealth(userId);
    if (masterHealth.total_issues > 0) {
      out.generated_risks.push({ risk_type: "master_data_health", severity: "high", title: "Master data issues detected", issue_count: masterHealth.total_issues, action_required: "Open Master Data Health and correct missing mappings." });
    }
    return out;
  },
};
