import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
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
    const conds: string[] = ["user_id = ?", "is_actioned = 0"];
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
      "SELECT COUNT(*) AS cnt FROM work_inbox_item WHERE user_id = ? AND is_read = 0 AND is_actioned = 0",
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

  /**
   * Close every open item raised for a given entity, because the work it was
   * asking for has now been done.
   *
   * This is the counterpart createItem never had. Alerts are raised by a dozen
   * workers and services, but until this existed the only writer of
   * `is_actioned` was the manual "complete" button on the Work Inbox page — so
   * approving a leave, submitting interview feedback or clearing a
   * regularization updated its own table and left the alert open forever. The
   * repeat-reminder timer keys off `is_actioned`, so the user kept being
   * chased for work they had already finished.
   *
   * `types` narrows the close to specific alert types; omit it to close every
   * open alert for the entity. `user_id` narrows it to one recipient; omit it
   * to close the alert for everyone it was raised against, which is almost
   * always what you want — if the work is done it is done for all of them.
   *
   * Returns the number of items closed. Never throws: resolution is a
   * best-effort side effect and must not roll back the business action that
   * triggered it.
   */
  async resolveItems(params: {
    entity_type: string;
    entity_id: string;
    types?: string[];
    user_id?: string;
  }): Promise<number> {
    if (!params.entity_type || !params.entity_id) return 0;

    const conds = ["entity_type = ?", "entity_id = ?", "is_actioned = 0"];
    const args: unknown[] = [params.entity_type, params.entity_id];

    if (params.types?.length) {
      conds.push(`type IN (${params.types.map(() => "?").join(",")})`);
      args.push(...params.types);
    }
    if (params.user_id) {
      conds.push("user_id = ?");
      args.push(params.user_id);
    }

    try {
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE work_inbox_item SET is_actioned = 1, is_read = 1 WHERE ${conds.join(" AND ")}`,
        args,
      );
      return Number(result?.affectedRows ?? 0);
    } catch (error) {
      console.warn(
        `[inbox] resolveItems failed for ${params.entity_type}:${params.entity_id}:`,
        error instanceof Error ? error.message : String(error),
      );
      return 0;
    }
  },

  /**
   * Create an inbox item, or refresh the one already standing for this work.
   *
   * Dedup is scoped to *open* items and carries no time window. It used to
   * expire after 30 minutes, which meant a condition nobody had dealt with
   * minted a brand new row every half hour — 488 rows for the same handful of
   * candidates in three days, all pointing at identical work. One open item per
   * (user, type, entity, action_url) is the whole truth: if it is still open,
   * the work is still outstanding, and a second row adds nothing but noise.
   *
   * `action_url` is part of the key because several callers encode the subject
   * date there (`?employeeId=…&date=…`) while entity_id holds only the
   * employee — without it, every day's missing-punch alert would collapse onto
   * the first one and later dates would never be raised.
   *
   * created_at is deliberately NOT bumped on refresh, so ageing is measured
   * from when the work first came up rather than from the last reminder.
   *
   * @param cooldownMinutes retained for call-site compatibility; no longer used.
   */
  async createItem(data: CreateInboxItem, cooldownMinutes?: number) {
    void cooldownMinutes;
    // Dedup: one open item per (user, type, entity, action_url) — no expiry.
    if (data.entity_type && data.entity_id) {
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM work_inbox_item
         WHERE user_id = ? AND type = ? AND entity_type = ? AND entity_id = ?
           AND action_url <=> ?
           AND is_actioned = 0
         LIMIT 1`,
        [data.user_id, data.type, data.entity_type, data.entity_id, data.action_url ?? null]
      );
      const openItem = (existing as RowDataPacket[])[0];
      if (openItem) {
        // Refresh the wording — elapsed times and counts in the title/description
        // go stale — but leave created_at alone so ageing stays honest.
        await db.execute(
          `UPDATE work_inbox_item SET title = ?, description = ?, priority = ? WHERE id = ?`,
          [data.title, data.description ?? null, data.priority ?? "normal", openItem.id],
        );
        const [refreshed] = await db.execute<RowDataPacket[]>(
          "SELECT * FROM work_inbox_item WHERE id = ? LIMIT 1",
          [openItem.id],
        );
        return (refreshed as RowDataPacket[])[0];
      }
    }

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
  /**
   * "breached" means a real TAT deadline was missed. "aged" means the item has no
   * deadline at all and is simply old — see calcRisk for why the two must not be
   * conflated.
   */
  risk: "breached" | "aged" | "due_soon" | "on_track";
  employee_name?: string;
  branch_name?: string;
  branch_id?: string;
  /**
   * Who raised this item — distinct from employee_name, which (on tat/work_item
   * rows) means "who it is assigned to" or "which employee it is about". Only
   * populated for the work_item source today (resolved from created_by), since
   * that is the reported gap: a Mira complaint's detail panel showed the AI
   * diagnosis but not who filed it. Reported live 2026-08-13.
   */
  requested_by_name?: string;
  requested_by_code?: string;
}

export interface PendingSummary {
  total: number;
  breached: number;
  /** Deadline-less items past the ageing threshold. Never counted as breached. */
  aged: number;
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

/**
 * Risk for a work item.
 *
 * A deadline-less item that is merely OLD returns "aged", never "breached".
 *
 * CEO UAT 31-Jul-2026 reported /work-inbox showing 23 items of which 100% read
 * "TAT breached". None of them had a TAT: work_inbox_item carries no deadline
 * column at all (createItem inserts none), so every row arrived here with
 * deadlineStr = null and fell into the age branch, where anything older than 48h
 * was labelled breached. Missing-punch items are generated per employee per date
 * and never expire, so the label was guaranteed for essentially every row — a
 * permanent red "SLA missed" for a service level that was never defined.
 *
 * This mirrors the distinction the dashboard contract already makes, where
 * `overdue_count` counts only rows with a real due date and `aged_count` is the
 * age-based signal "kept separate so an age is never presented as a missed
 * deadline" (shared/dashboardMetricContract.ts).
 */
function calcRisk(deadlineStr?: string | null, createdStr?: string): "breached" | "aged" | "due_soon" | "on_track" {
  if (!deadlineStr) {
    if (!createdStr) return "on_track";
    const ageH = (Date.now() - new Date(createdStr).getTime()) / 3_600_000;
    // Old, but nothing was promised — "aged", not "breached".
    if (ageH > 48) return "aged";
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

  // Third source: work_item, the registry-backed table behind
  // modules/work-inbox/action-item-registry.ts (22 declared item types including
  // PAYROLL_SIGN_OFF_PENDING, LEAVE_APPROVAL_PENDING, RESIGNATION_PENDING_REVIEW and
  // FF_CLEARANCE_PENDING).
  //
  // This endpoint previously unioned only task_tat_instance and work_inbox_item, so
  // nothing written to work_item ever reached /work-inbox — while the page header
  // claims "tasks across all platform modules". The CEO UAT reported exactly that:
  // one item type, no approval, payroll or exit items.
  //
  // Adding the source does NOT by itself deliver those items. Verified against prod
  // 31-Jul-2026: work_item holds 2 rows, both EMPLOYEE_CODE_PENDING. Of the 22
  // registered types, only that one has a producer writing rows. The rest of the
  // finding is missing producers, not missing wiring — but the wiring has to exist
  // first, or a producer added later would still be invisible here.
  //
  // Role-assigned items are included deliberately: approvals are addressed to a role,
  // not a person, so filtering on assigned_to_user_id alone would keep them hidden.
  const [workItemRows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.id,
            COALESCE(NULLIF(wi.module_code, ''), wi.item_type) AS module,
            wi.title,
            wi.description,
            wi.entity_type,
            wi.entity_id,
            wi.priority,
            wi.due_at,
            wi.created_at,
            e.full_name AS employee_name,
            req.full_name AS requested_by_name,
            req.employee_code AS requested_by_code
       FROM work_item wi
       LEFT JOIN employees e ON e.user_id = wi.assigned_to_user_id
       LEFT JOIN employees req ON req.user_id = wi.created_by
      WHERE wi.status NOT IN ('completed', 'cancelled')
        AND (wi.assigned_to_user_id = ? OR wi.assigned_to_role IN (${rolePlaceholders}))
      ORDER BY FIELD(wi.priority,'urgent','high','normal','low'), wi.created_at DESC
      LIMIT 200`,
    [userId, ...rolePool],
  ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);

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
    // work_item rows. Unlike work_inbox_item these DO carry a real deadline
    // (due_at), so calcRisk can distinguish a genuine breach from mere age here.
    ...(workItemRows as RowDataPacket[]).map((row): PendingTask => {
      const createdAt = String(row.created_at ?? "");
      const agingH = createdAt ? (now - new Date(createdAt).getTime()) / 3_600_000 : 0;
      const dueAt = row.due_at ? String(row.due_at) : null;
      return {
        id: String(row.id),
        source: "inbox",
        module: String(row.module ?? "general"),
        title: String(row.title ?? ""),
        description: row.description ? String(row.description) : undefined,
        entity_type: row.entity_type ? String(row.entity_type) : undefined,
        entity_id: row.entity_id ? String(row.entity_id) : undefined,
        priority: String(row.priority ?? "normal"),
        tat_deadline: dueAt ?? undefined,
        created_at: createdAt,
        aging_hours: Math.round(agingH * 10) / 10,
        risk: calcRisk(dueAt, createdAt),
        employee_name: row.employee_name ? String(row.employee_name) : undefined,
        requested_by_name: row.requested_by_name ? String(row.requested_by_name) : undefined,
        requested_by_code: row.requested_by_code ? String(row.requested_by_code) : undefined,
      };
    }),
  ];

  // Sort by risk then priority
  // A real missed deadline outranks a merely old item.
  const riskOrder = { breached: 0, due_soon: 1, aged: 2, on_track: 3 };
  const prioOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  items.sort((a, b) => {
    const rd = riskOrder[a.risk] - riskOrder[b.risk];
    if (rd !== 0) return rd;
    return (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9);
  });

  const summary: PendingSummary = {
    total: items.length,
    breached: items.filter((i) => i.risk === "breached").length,
    aged: items.filter((i) => i.risk === "aged").length,
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

  // Module-specific: work_item_audit_log for a Mira-logged complaint/feedback item. Shows
  // both the AI-drafted triage diagnosis (mira-issue-triage.service.ts, action
  // 'mira_ai_triage') and anything a human later records against the same item — same
  // source table, same query shape as the incentive-batch case just below, which this was
  // modelled on directly.
  if (referenceType === "mira_feedback") {
    const [miraRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, performed_at AS created_at, performed_by AS actor, action AS action, remarks AS details
       FROM work_item_audit_log
       WHERE work_item_id = ?
       ORDER BY performed_at DESC LIMIT 50`,
      [referenceId],
    ).catch(() => [[] as RowDataPacket[]]);

    (miraRows as RowDataPacket[]).forEach((r) => {
      events.push({
        id: `mira-${String(r.id)}`,
        event_time: String(r.created_at),
        actor: String(r.actor ?? "system"),
        action: String(r.action ?? ""),
        details: r.details ? String(r.details) : undefined,
        source_table: "work_item_audit_log",
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
