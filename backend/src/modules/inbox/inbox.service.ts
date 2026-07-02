import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface InboxFilters {
  user_id: string;
  type?: string;
  priority?: string;
  is_read?: string;
}

interface CreateInboxItem {
  user_id: string;
  type: string;
  title: string;
  description?: string;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
  priority?: string;
}

export const inboxService = {
  async listItems(filters: InboxFilters) {
    const conds: string[] = ["user_id = ?"];
    const params: unknown[] = [filters.user_id];

    if (filters.type)     { conds.push("type = ?");       params.push(filters.type); }
    if (filters.priority) { conds.push("priority = ?");   params.push(filters.priority); }
    if (filters.is_read !== undefined && filters.is_read !== "") {
      conds.push("is_read = ?");
      params.push(filters.is_read === "true" || filters.is_read === "1" ? 1 : 0);
    }

    const where = `WHERE ${conds.join(" AND ")}`;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM work_inbox_item ${where} ORDER BY
         FIELD(priority,'urgent','high','normal','low'), created_at DESC
       LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getUnreadCount(userId: string): Promise<number> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM work_inbox_item WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    return Number((rows as RowDataPacket[])[0]?.cnt ?? 0);
  },

  async markRead(id: string, userId: string) {
    const [result] = await db.execute(
      "UPDATE work_inbox_item SET is_read = 1 WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return result;
  },

  async markActioned(id: string, userId: string) {
    const [result] = await db.execute(
      "UPDATE work_inbox_item SET is_actioned = 1, is_read = 1 WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return result;
  },

  async markAllRead(userId: string) {
    const [result] = await db.execute(
      "UPDATE work_inbox_item SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    return result;
  },

  async createItem(data: CreateInboxItem) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO work_inbox_item
         (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.user_id,
        data.type,
        data.title,
        data.description ?? null,
        data.entity_type ?? null,
        data.entity_id ?? null,
        data.action_url ?? null,
        data.priority ?? "normal",
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM work_inbox_item WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },
};

// ── Platform-wide pending task queue ─────────────────────────────────────────

export interface PendingTask {
  id: string;
  source: "tat" | "inbox";
  module: string;
  title: string;
  description?: string;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
  priority: string;
  tat_deadline?: string;
  created_at: string;
  aging_hours: number;
  risk: "breached" | "due_soon" | "on_track";
  employee_name?: string;
  branch_name?: string;
  branch_id?: string;
}

export interface PendingSummary {
  total: number;
  breached: number;
  due_soon: number;
  on_track: number;
  by_module: Record<string, number>;
}

export interface TimelineEvent {
  id: string;
  event_time: string;
  actor: string;
  action: string;
  details?: string;
  source_table: string;
}

function calcRisk(deadlineStr?: string | null, createdStr?: string): "breached" | "due_soon" | "on_track" {
  if (!deadlineStr) {
    // No deadline: use age — >48h = breached, >24h = due_soon
    if (!createdStr) return "on_track";
    const ageH = (Date.now() - new Date(createdStr).getTime()) / 3_600_000;
    if (ageH > 48) return "breached";
    if (ageH > 24) return "due_soon";
    return "on_track";
  }
  const remaining = new Date(deadlineStr).getTime() - Date.now();
  if (remaining < 0) return "breached";
  if (remaining < 4 * 3_600_000) return "due_soon";
  return "on_track";
}

export async function getMyPending(userId: string): Promise<{ items: PendingTask[]; summary: PendingSummary }> {
  // Resolve caller roles + branch
  const [roleRows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId],
  );
  const roles = (roleRows as RowDataPacket[]).map((r) => String(r.role_key));

  // Resolve caller's branch from employees table (user_id is the FK, auth_user_id is an alias added by migration 305)
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id FROM employees WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const callerBranchId: string | null = (empRows as RowDataPacket[])[0]?.branch_id ?? null;

  const isAdmin = roles.some((r) => ["super_admin", "admin"].includes(r));
  const isHrAdmin = roles.some((r) => ["hr_admin", "super_admin", "admin"].includes(r));
  const isItHead = roles.some((r) => ["it_head", "it_admin", "super_admin", "admin"].includes(r));
  const isItSpoc = roles.some((r) => ["it_spoc", "it_executive", "it_support"].includes(r));
  const isHr = roles.some((r) => ["hr", "hr_admin", "hr_manager"].includes(r));
  const isFinance = roles.some((r) => ["finance", "finance_head", "payroll_admin"].includes(r));
  const isWfm = roles.some((r) => ["wfm", "wfm_admin"].includes(r));
  const isOpsManager = roles.some((r) => ["operations_manager", "branch_head", "process_manager"].includes(r));

  // Build role pool for TAT tasks
  const rolePool = roles.length ? roles : ["__none__"];
  const rolePlaceholders = rolePool.map(() => "?").join(",");

  // Branch scoping helper: determines which branches each role sees
  const itBranchFilter = isItHead || isAdmin ? "" : (callerBranchId ? "AND e.branch_id = ?" : "AND 1=0");
  const hrBranchFilter = isHrAdmin || isAdmin ? "" : (callerBranchId ? "AND e.branch_id = ?" : "AND 1=0");
  const genBranchFilter = isAdmin ? "" : (callerBranchId ? "AND e.branch_id = ?" : "AND 1=0");

  const itBranchParam = (!isItHead && !isAdmin && callerBranchId) ? [callerBranchId] : [];
  const hrBranchParam = (!isHrAdmin && !isAdmin && callerBranchId) ? [callerBranchId] : [];
  const genBranchParam = (!isAdmin && callerBranchId) ? [callerBranchId] : [];

  // Query TAT tasks assigned to this user or their roles.
  // Uses migration-294 columns (entity_type, entity_id, assigned_to) as base;
  // migration-305 adds task_title, task_description, owner_user_id, owner_role, priority — handled via COALESCE.
  const tatQuery = `
    SELECT
      t.id,
      t.task_type AS module,
      COALESCE(t.task_title, t.task_type)                AS title,
      t.task_description                                  AS description,
      t.entity_type,
      t.entity_id,
      COALESCE(t.priority, 'normal')                      AS priority,
      t.due_at                                            AS tat_deadline,
      t.created_at,
      COALESCE(t.owner_user_id, t.assigned_to)           AS owner_user_id,
      t.owner_role,
      e.full_name                                         AS employee_name,
      b.branch_name,
      e.branch_id
    FROM task_tat_instance t
    LEFT JOIN employees e ON e.id = t.entity_id AND t.entity_type = 'employee'
    LEFT JOIN branch_master b ON b.id = e.branch_id
    WHERE t.status NOT IN ('completed','cancelled')
      AND (COALESCE(t.owner_user_id, t.assigned_to) = ? OR t.owner_role IN (${rolePlaceholders}))
    ORDER BY t.due_at ASC
    LIMIT 300
  `;
  const [tatRows] = await db.execute<RowDataPacket[]>(tatQuery, [userId, ...rolePool]);

  // Filter TAT rows by module-specific branch scoping
  const IT_MODULES = new Set(["it_provisioning", "it_asset", "it_access", "it_support"]);
  const HR_MODULES = new Set(["onboarding", "offboarding", "exit", "bgv", "leave_approval", "regularization"]);

  const filteredTat = (tatRows as RowDataPacket[]).filter((row) => {
    const mod = String(row.module ?? "").toLowerCase();
    const rowBranch: string | null = row.branch_id ?? null;
    if (IT_MODULES.has(mod)) {
      if (isItHead || isAdmin) return true;
      if (isItSpoc && callerBranchId) return rowBranch === callerBranchId;
      // If caller has no IT role but task was directly assigned to them, include it
      return String(row.owner_user_id ?? "") === userId;
    }
    if (HR_MODULES.has(mod)) {
      if (isHrAdmin || isAdmin) return true;
      if (isHr && callerBranchId) return rowBranch === callerBranchId;
      return String(row.owner_user_id ?? "") === userId;
    }
    // Finance, WFM, Ops — role check already done via owner_role match
    return true;
  });

  // Query work_inbox_item for this user
  const [inboxRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, type AS module, title, description, entity_type, entity_id, action_url,
            priority, created_at
     FROM work_inbox_item
     WHERE user_id = ? AND is_actioned = 0
     ORDER BY FIELD(priority,'urgent','high','normal','low'), created_at DESC
     LIMIT 200`,
    [userId],
  );

  const now = Date.now();
  const items: PendingTask[] = [
    ...filteredTat.map((row): PendingTask => {
      const createdAt = String(row.created_at ?? "");
      const agingH = createdAt ? (now - new Date(createdAt).getTime()) / 3_600_000 : 0;
      return {
        id: String(row.id),
        source: "tat",
        module: String(row.module ?? "general"),
        title: String(row.title ?? ""),
        description: row.description ? String(row.description) : undefined,
        entity_type: row.entity_type ? String(row.entity_type) : undefined,
        entity_id: row.entity_id ? String(row.entity_id) : undefined,
        priority: String(row.priority ?? "normal"),
        tat_deadline: row.tat_deadline ? String(row.tat_deadline) : undefined,
        created_at: createdAt,
        aging_hours: Math.round(agingH * 10) / 10,
        risk: calcRisk(row.tat_deadline ? String(row.tat_deadline) : null, createdAt),
        employee_name: row.employee_name ? String(row.employee_name) : undefined,
        branch_name: row.branch_name ? String(row.branch_name) : undefined,
        branch_id: row.branch_id ? String(row.branch_id) : undefined,
      };
    }),
    ...(inboxRows as RowDataPacket[]).map((row): PendingTask => {
      const createdAt = String(row.created_at ?? "");
      const agingH = createdAt ? (now - new Date(createdAt).getTime()) / 3_600_000 : 0;
      return {
        id: String(row.id),
        source: "inbox",
        module: String(row.module ?? "general"),
        title: String(row.title ?? ""),
        description: row.description ? String(row.description) : undefined,
        entity_type: row.entity_type ? String(row.entity_type) : undefined,
        entity_id: row.entity_id ? String(row.entity_id) : undefined,
        action_url: row.action_url ? String(row.action_url) : undefined,
        priority: String(row.priority ?? "normal"),
        created_at: createdAt,
        aging_hours: Math.round(agingH * 10) / 10,
        risk: calcRisk(null, createdAt),
      };
    }),
  ];

  // Sort by risk then priority
  const riskOrder = { breached: 0, due_soon: 1, on_track: 2 };
  const prioOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  items.sort((a, b) => {
    const rd = riskOrder[a.risk] - riskOrder[b.risk];
    if (rd !== 0) return rd;
    return (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9);
  });

  const summary: PendingSummary = {
    total: items.length,
    breached: items.filter((i) => i.risk === "breached").length,
    due_soon: items.filter((i) => i.risk === "due_soon").length,
    on_track: items.filter((i) => i.risk === "on_track").length,
    by_module: items.reduce<Record<string, number>>((acc, i) => {
      acc[i.module] = (acc[i.module] ?? 0) + 1;
      return acc;
    }, {}),
  };

  return { items, summary };
}

export async function getTimeline(referenceType: string, referenceId: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // sensitive_action_log
  const [salRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, created_at, performed_by_user_id AS actor, action_type AS action, details, 'sensitive_action_log' AS src
     FROM sensitive_action_log
     WHERE reference_type = ? AND reference_id = ?
     ORDER BY created_at DESC LIMIT 100`,
    [referenceType, referenceId],
  ).catch(() => [[] as RowDataPacket[]]);

  (salRows as RowDataPacket[]).forEach((r) => {
    events.push({
      id: String(r.id),
      event_time: String(r.created_at),
      actor: String(r.actor ?? "system"),
      action: String(r.action ?? ""),
      details: r.details ? String(r.details) : undefined,
      source_table: "sensitive_action_log",
    });
  });

  // task_tat_instance — use migration-294 columns; extended columns available after migration 305
  const [tatRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, created_at,
            COALESCE(assigned_to, owner_user_id)        AS actor,
            COALESCE(task_title, task_type)             AS action,
            task_description                            AS details
     FROM task_tat_instance
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    [referenceType, referenceId],
  ).catch(() => [[] as RowDataPacket[]]);

  (tatRows as RowDataPacket[]).forEach((r) => {
    events.push({
      id: `tat-${String(r.id)}`,
      event_time: String(r.created_at),
      actor: String(r.actor ?? "system"),
      action: String(r.action ?? ""),
      details: r.details ? String(r.details) : undefined,
      source_table: "task_tat_instance",
    });
  });

  // Module-specific: exit_retention_action (resignation lifecycle audit)
  if (referenceType === "resignation" || referenceType === "exit_request") {
    const [resRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, performed_at AS created_at, performed_by AS actor,
              action_type AS action, action_summary AS details
       FROM exit_retention_action
       WHERE exit_request_id = ?
       ORDER BY performed_at DESC LIMIT 50`,
      [referenceId],
    ).catch(() => [[] as RowDataPacket[]]);

    (resRows as RowDataPacket[]).forEach((r) => {
      events.push({
        id: `era-${String(r.id)}`,
        event_time: String(r.created_at),
        actor: String(r.actor ?? "system"),
        action: String(r.action ?? ""),
        details: r.details ? String(r.details) : undefined,
        source_table: "exit_retention_action",
      });
    });
  }

  // Module-specific: work_item_audit_log for incentive batches
  if (referenceType === "incentive" || referenceType === "incentive_batch") {
    const [incRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, performed_at AS created_at, performed_by AS actor, action AS action, remarks AS details
       FROM work_item_audit_log
       WHERE work_item_id = ?
       ORDER BY performed_at DESC LIMIT 50`,
      [referenceId],
    ).catch(() => [[] as RowDataPacket[]]);

    (incRows as RowDataPacket[]).forEach((r) => {
      events.push({
        id: `inc-${String(r.id)}`,
        event_time: String(r.created_at),
        actor: String(r.actor ?? "system"),
        action: String(r.action ?? ""),
        details: r.details ? String(r.details) : undefined,
        source_table: "work_item_audit_log",
      });
    });
  }

  // Sort all by event_time descending
  events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
  return events;
}
