import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getUserRoleContext } from "../../shared/roleResolver.js";

/**
 * Rows unactioned for longer than this are reported as aged.
 *
 * Used instead of an overdue count for `work_inbox_item`, which carries no due date —
 * see getUnifiedInboxSummary.
 */
const INBOX_AGED_DAYS = 7;

export type WorkItemInput = {
  itemType: string;
  title: string;
  description?: string;
  moduleCode: string;
  entityType: string;
  entityId: string;
  assignedToUserId?: string;
  assignedToRole?: string;
  branchId?: string;
  processId?: string;
  priority?: "low" | "medium" | "high" | "critical";
  dueAt?: string;
  createdBy?: string;
};

export async function assertWorkItemAccess(
  userId: string,
  workItemId: string,
  action: 'complete' | 'escalate' | 'reassign'
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT assigned_to_user_id, assigned_to_role, status FROM work_item WHERE id = ? LIMIT 1',
    [workItemId]
  );
  if (!(rows as any[]).length) {
    throw Object.assign(new Error('Work item not found'), { statusCode: 404 });
  }
  const item = (rows as any)[0];
  if (item.status === 'completed' || item.status === 'cancelled') {
    throw Object.assign(new Error('Work item already ' + item.status), { statusCode: 400 });
  }
  const { roleKeys } = await getUserRoleContext(userId);
  const isPrivileged = roleKeys.some(r =>
    ['super_admin', 'admin', 'ho_hr', 'hr_branch', 'branch_head', 'operations_head'].includes(r)
  );
  if (item.assigned_to_user_id !== userId && !isPrivileged) {
    throw Object.assign(new Error('Not authorized to ' + action + ' this work item'), { statusCode: 403 });
  }
}

export async function createWorkItem(input: WorkItemInput): Promise<string> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO work_item (id, item_type, title, description, module_code, entity_type, entity_id,
       assigned_to_user_id, assigned_to_role, branch_id, process_id, priority, status, due_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id, input.itemType, input.title, input.description ?? null, input.moduleCode,
      input.entityType, input.entityId, input.assignedToUserId ?? null,
      input.assignedToRole ?? null, input.branchId ?? null, input.processId ?? null,
      input.priority ?? "medium", input.dueAt ?? null, input.createdBy ?? null,
    ]
  );
  return id;
}

/**
 * The caller's open inbox, unioned across both work tables.
 *
 * `work_item` alone holds 2 rows while `work_inbox_item` holds 65k and is written
 * continuously, so every panel backed by this function ("Your inbox is clear" on five
 * dashboards) was reporting an empty inbox to users who had dozens of items waiting.
 *
 * The two are normalised to `work_item`'s response shape so existing consumers keep
 * working unchanged: the frontend panel reads id / title / description / module_code /
 * priority / action_url / due_date. `work_inbox_item` has no due date, so `due_at` is
 * null for its rows rather than invented, and no module_code, so its `type` stands in.
 *
 * Priority vocabularies differ — work_item uses critical/high/medium/low and
 * work_inbox_item uses urgent/high/normal/low — so `urgent` is mapped onto `critical`
 * for a single ordering.
 */
/**
 * The three UNION ALL branches for registry types (action-item-registry.ts) that no
 * producer ever writes into work_item — derived live from their real source table instead.
 * Extracted to its own constant so it has exactly one copy: embedded inside
 * getMyWorkItems()'s five-way union below, and reused standalone by
 * getDerivedRegistryItems() for modules/inbox/inbox.service.ts's getMyPending() — the
 * endpoint NativeWorkInbox.tsx actually calls, which getMyWorkItems() (GET /api/work-inbox/my)
 * is not. Before this these three queues were only ever visible through the endpoint the
 * Work Inbox page has never called: live counts 2026-08-13 were 26 pending leave approvals,
 * 16 pending exit clearances, 120 BGV checks stuck in manual_review/mismatch — 162 real
 * items with nowhere a human would see them.
 *
 * Five placeholders in order: leave's (mgr.user_id, role-IN-list), exit clearance's
 * (owner_user_id, owner_role), BGV's (role-IN-list). getMyWorkItems() interpolates this
 * after its own two placeholders (assigned_to_user_id, assigned_to_role) and one
 * (work_inbox_item's user_id) — 3 + 5 = 8 total, unchanged from before this was extracted.
 */
const DERIVED_REGISTRY_UNION_SQL = `
       /*
        * Pending leave, derived from the source table rather than from a producer row.
        *
        * LEAVE_APPROVAL_PENDING is declared in action-item-registry.ts but nothing has ever
        * written it — no INSERT anywhere in the backend produces that item_type — so the 27
        * leave requests sitting in 'pending' were invisible in every inbox while the type
        * they belong to was advertised as supported. Deriving avoids a backfill and cannot
        * drift out of sync the way a producer row does once a request is approved.
        *
        * Routed to the reporting manager, with HR as a fallback because the manager link
        * does not cover the queue: of the 27 pending, 9 have no reporting manager at all
        * and only 5 of the 7 named managers hold a user account. Without the fallback a
        * third of the queue would reach nobody.
        */
       SELECT CONCAT('leave:', lr.id) AS id,
              'LEAVE_APPROVAL_PENDING' AS item_type,
              CONCAT('Leave approval: ', COALESCE(e.full_name, e.employee_code)) AS title,
              CONCAT(
                TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM COALESCE(lr.total_days, 0))),
                IF(COALESCE(lr.total_days, 0) = 1, ' day from ', ' days from '),
                DATE_FORMAT(COALESCE(lr.from_date, lr.start_date), '%d %b %Y')
              ) AS description,
              'leave' AS module_code,
              'leave_request' AS entity_type,
              lr.id AS entity_id,
              'high' AS priority,
              'pending' AS status,
              NULL AS due_at,
              lr.created_at,
              '/leave-approvals' AS action_url,
              e.full_name AS assigned_employee_name,
              'leave_request' AS source_table
         FROM leave_request lr
         JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
        WHERE LOWER(COALESCE(lr.status, '')) = 'pending'
          AND (mgr.user_id = ? OR ? IN ('hr', 'hr_head', 'admin', 'super_admin'))
       UNION ALL
       /*
        * Exit clearance tasks, derived for the same reason as leave: FF_CLEARANCE_PENDING is
        * in the registry and nothing writes it, so 16 pending clearance tasks across 8 areas
        * were invisible.
        *
        * This table routes itself — owner_role is set on all 16 (admin, hr, manager, payroll,
        * trainer, wfm) — so no fallback is invented. owner_user_id is NULL on every row today
        * but is honoured first, so per-person assignment starts working the moment it is used.
        * due_date is a real column here, unlike leave, so these items can genuinely be overdue.
        */
       SELECT CONCAT('exitclr:', t.id) AS id,
              'FF_CLEARANCE_PENDING' AS item_type,
              CONCAT('Exit clearance (', t.clearance_area, '): ',
                     COALESCE(e.full_name, e.employee_code, 'unknown employee')) AS title,
              t.task_title AS description,
              'exit' AS module_code,
              'exit_clearance_task' AS entity_type,
              t.id AS entity_id,
              'high' AS priority,
              'pending' AS status,
              t.due_date AS due_at,
              t.created_at,
              '/exit/clearance' AS action_url,
              e.full_name AS assigned_employee_name,
              'exit_clearance_task' AS source_table
         FROM exit_clearance_task t
         LEFT JOIN employees e ON e.id = t.employee_id
        WHERE LOWER(COALESCE(t.status, '')) = 'pending'
          AND (t.owner_user_id = ? OR t.owner_role = ?)
       UNION ALL
       /*
        * Background checks stuck needing a human. BGV_PENDING is likewise declared and never
        * written; 58 checks sit in manual_review or mismatch (120 live 2026-08-13 — grown
        * since the original count, not stale).
        *
        * Only those two statuses qualify. 'not_started' and 'queued' are waiting on the
        * provider, not on a person, so surfacing them would fill the inbox with items nobody
        * can action.
        *
        * 17 of the 58 have no surviving ats_candidate row, so the join is LEFT and the title
        * degrades to the candidate id. Dropping them would hide precisely the checks whose
        * record is already damaged.
        */
       SELECT CONCAT('bgv:', b.id) AS id,
              'BGV_PENDING' AS item_type,
              CONCAT('BGV ', REPLACE(LOWER(b.status), '_', ' '), ': ',
                     COALESCE(c.full_name, CONCAT('candidate ', b.candidate_id))) AS title,
              CONCAT(b.check_type, COALESCE(CONCAT(' — ', b.result_summary), '')) AS description,
              'ats' AS module_code,
              'candidate_bgv_check' AS entity_type,
              b.id AS entity_id,
              'high' AS priority,
              'pending' AS status,
              NULL AS due_at,
              b.created_at,
              '/ats/bgv' AS action_url,
              c.full_name AS assigned_employee_name,
              'candidate_bgv_check' AS source_table
         FROM candidate_bgv_check b
         LEFT JOIN ats_candidate c ON c.id = b.candidate_id
        WHERE LOWER(COALESCE(b.status, '')) IN ('manual_review', 'mismatch')
          AND ? IN ('hr', 'hr_head', 'admin', 'super_admin', 'recruiter', 'recruitment_hr')`;

export async function getMyWorkItems(userId: string, role: string, limit = 50, offset = 0) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT wi.id,
              wi.item_type,
              wi.title,
              wi.description,
              wi.module_code,
              wi.entity_type,
              wi.entity_id,
              CASE WHEN wi.priority = 'urgent' THEN 'critical' ELSE wi.priority END AS priority,
              wi.status,
              wi.due_at,
              wi.created_at,
              NULL AS action_url,
              e.full_name AS assigned_employee_name,
              'work_item' AS source_table
         FROM work_item wi
         LEFT JOIN employees e ON e.user_id = wi.assigned_to_user_id
        WHERE (wi.assigned_to_user_id = ? OR wi.assigned_to_role = ?)
          AND wi.status NOT IN ('completed', 'cancelled')
       UNION ALL
       SELECT wii.id,
              wii.type AS item_type,
              wii.title,
              wii.description,
              wii.type AS module_code,
              wii.entity_type,
              wii.entity_id,
              CASE WHEN wii.priority = 'urgent' THEN 'critical'
                   WHEN wii.priority = 'normal' THEN 'medium'
                   ELSE wii.priority END AS priority,
              CASE WHEN wii.is_read = 1 THEN 'read' ELSE 'pending' END AS status,
              NULL AS due_at,
              wii.created_at,
              wii.action_url,
              NULL AS assigned_employee_name,
              'work_inbox_item' AS source_table
         FROM work_inbox_item wii
        WHERE wii.user_id = ? AND wii.is_actioned = 0
       UNION ALL
       ${DERIVED_REGISTRY_UNION_SQL}
     ) merged
     ORDER BY FIELD(merged.priority,'critical','high','medium','low'),
              merged.due_at IS NULL,
              merged.due_at ASC,
              merged.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userId, role, userId, userId, role, userId, role, role]
  );
  return rows;
}

/**
 * The same three derived queues, standalone — for getMyPending() (modules/inbox/inbox.service.ts),
 * the endpoint the Work Inbox page actually reads. See DERIVED_REGISTRY_UNION_SQL's comment.
 */
export async function getDerivedRegistryItems(userId: string, role: string, limit = 200) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (
       ${DERIVED_REGISTRY_UNION_SQL}
     ) merged
     ORDER BY FIELD(merged.priority,'critical','high','medium','low'),
              merged.due_at IS NULL,
              merged.due_at ASC,
              merged.created_at DESC
     LIMIT ${safeLimit}`,
    [userId, role, userId, role, role]
  );
  return rows;
}

/**
 * Work across the caller's branch.
 *
 * `LIMIT ?` cannot be bound in a prepared statement — mysql2 rejects it with
 * "Incorrect arguments to mysqld_stmt_execute" — so GET /api/work-inbox/team returned
 * HTTP 500 for every user, not just scoped ones. The limit is clamped and interpolated,
 * matching getMyWorkItems.
 *
 * Also unions work_inbox_item, for the same reason getMyWorkItems does: work_item holds
 * 2 rows. That table has no branch column, so its rows reach this view through
 * user_id -> employees.branch_id, which is the only branch link it has.
 */
export async function getTeamWorkItems(userId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT wi.id, wi.item_type, wi.title, wi.description, wi.module_code,
              wi.priority, wi.status, wi.due_at, wi.created_at,
              NULL AS action_url, 'work_item' AS source_table
         FROM work_item wi
        WHERE wi.created_by = ?
           OR wi.branch_id IN (SELECT branch_id FROM employees WHERE user_id = ?)
       UNION ALL
       SELECT wii.id, wii.type, wii.title, wii.description, wii.type,
              CASE WHEN wii.priority = 'urgent' THEN 'critical'
                   WHEN wii.priority = 'normal' THEN 'medium'
                   ELSE wii.priority END,
              CASE WHEN wii.is_actioned = 1 THEN 'completed' ELSE 'pending' END,
              NULL, wii.created_at, wii.action_url, 'work_inbox_item'
         FROM work_inbox_item wii
         JOIN employees owner ON owner.user_id = wii.user_id
        WHERE owner.branch_id IN (SELECT branch_id FROM employees WHERE user_id = ?)
          AND wii.is_actioned = 0
     ) merged
     ORDER BY merged.created_at DESC
     LIMIT ${safeLimit}`,
    [userId, userId, userId]
  );
  return rows;
}

/**
 * `assertWorkItemAccess` reads status, then this function writes it in a separate round
 * trip — a gap two concurrent "complete" clicks on the same item could both pass through,
 * each inserting its own work_item_audit_log row for the same completion. Conditioning the
 * UPDATE on status closes that: the loser's affectedRows is 0 and it throws instead of
 * writing a duplicate audit entry.
 */
export async function completeWorkItem(id: string, userId: string, remarks?: string): Promise<void> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE work_item SET status='completed', completed_at=NOW(), completed_by=?, updated_at=NOW()
     WHERE id=? AND status NOT IN ('completed', 'cancelled')`,
    [userId, id]
  );
  if (!result.affectedRows) {
    throw Object.assign(new Error('Work item not found or already completed'), { statusCode: 409 });
  }
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by)
     VALUES (UUID(), ?, 'complete', 'pending', 'completed', ?, ?)`,
    [id, remarks ?? null, userId]
  );
}

export async function escalateWorkItem(id: string, userId: string, remarks?: string): Promise<void> {
  await db.execute(
    `UPDATE work_item SET escalation_level = escalation_level + 1, status='escalated', updated_at=NOW() WHERE id=?`,
    [id]
  );
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by)
     VALUES (UUID(), ?, 'escalate', 'pending', 'escalated', ?, ?)`,
    [id, remarks ?? null, userId]
  );
}

export async function reassignWorkItem(id: string, toUserId: string, byUserId: string, remarks?: string): Promise<void> {
  await db.execute(
    `UPDATE work_item SET assigned_to_user_id=?, updated_at=NOW() WHERE id=?`,
    [toUserId, id]
  );
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by)
     VALUES (UUID(), ?, 'reassign', 'pending', 'pending', ?, ?)`,
    [id, remarks ?? null, byUserId]
  );
}

export async function createWorkItemIfNotExists(
  input: WorkItemInput & { dedupKey?: string }
): Promise<string | null> {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM work_item WHERE entity_type=? AND entity_id=? AND item_type=? AND status='pending' LIMIT 1`,
    [input.entityType, input.entityId, input.itemType]
  );
  if ((existing as RowDataPacket[]).length > 0) {
    return (existing as RowDataPacket[])[0].id as string;
  }
  return createWorkItem(input);
}

/**
 * Counts for the inbox badge, unioned across both work tables for the same reason
 * getMyWorkItems is — reading work_item alone reported 0 pending to every user.
 *
 * `overdue` counts only rows with a real due date (work_item); work_inbox_item has none,
 * so its age is reported separately as `aged` rather than presented as a missed deadline.
 */
export async function getWorkItemStats(userId: string, role: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT module_code,
            COUNT(*) as count,
            SUM(CASE WHEN priority IN ('critical','urgent') THEN 1 ELSE 0 END) as critical_count,
            SUM(CASE WHEN due_at IS NOT NULL AND due_at < NOW() THEN 1 ELSE 0 END) as overdue_count,
            SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL ${INBOX_AGED_DAYS} DAY) THEN 1 ELSE 0 END) as aged_count
     FROM (
       SELECT module_code, priority, due_at, created_at
         FROM work_item
        WHERE (assigned_to_user_id=? OR assigned_to_role=?) AND status='pending'
       UNION ALL
       SELECT type AS module_code, priority, NULL AS due_at, created_at
         FROM work_inbox_item
        WHERE user_id=? AND is_actioned=0
     ) merged
     GROUP BY module_code`,
    [userId, role, userId]
  );
  const byModule: Record<string, number> = {};
  let pending = 0;
  let critical = 0;
  let overdue = 0;
  let aged = 0;
  for (const row of rows as RowDataPacket[]) {
    byModule[row.module_code] = Number(row.count);
    pending += Number(row.count);
    critical += Number(row.critical_count);
    overdue += Number(row.overdue_count);
    aged += Number(row.aged_count);
  }
  return { pending, overdue, critical, aged, byModule };
}

/**
 * Items past a real due date.
 *
 * Same `LIMIT ?` defect as getTeamWorkItems — this endpoint returned HTTP 500 for every
 * user. Clamped and interpolated instead.
 *
 * Deliberately NOT unioned with work_inbox_item: that table has no due_at, so nothing in
 * it can be overdue. Including it would mean inventing a deadline. Callers wanting the
 * age-based signal should read `aged_count` from getUnifiedInboxSummary.
 */
export async function getOverdueItems(userId: string, role: string, limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM work_item
     WHERE (assigned_to_user_id=? OR assigned_to_role=?)
       AND due_at IS NOT NULL
       AND due_at < NOW()
       AND status='pending'
     ORDER BY due_at ASC
     LIMIT ${safeLimit}`,
    [userId, role]
  );
  return rows;
}

/**
 * The work inbox is split across two tables that were built independently and are
 * both still written on every deploy:
 *
 *   `work_item`       — role/branch/process-addressed, has status + due_at.
 *                       Written by ats/employee-code-gate, ats/jclr, ats/name-consistency,
 *                       ats/salary-component-assignment, employees/employee-creation-orchestrator,
 *                       exit/resignation, governance/tat, incentives, privacy/dpdp-withdrawal.
 *   `work_inbox_item` — user-addressed, has is_read/is_actioned + action_url, no due date.
 *                       Written by wfm/attendance-engine, control-tower, ats/recruiter-hiring,
 *                       kpi, inbox, auth-launch, reporting, official-email-compliance.worker.
 *
 * Every dashboard read `work_item` alone, which holds 2 rows, while `work_inbox_item`
 * holds 65k and is written continuously — so all 12 dashboards showed an empty inbox
 * while the super admin actually had 40 open items.
 *
 * This unions the two rather than repointing, because both writer sets are live and
 * dropping either would silently lose work. Neither table is modified.
 *
 * Row-scope note: `work_inbox_item` has no branch_id/process_id, only user_id, so it
 * can only ever be addressed per-user — which is what an inbox is. 12,271 open rows
 * carry a user_id that no longer resolves to auth_user; those are unreachable by any
 * viewer and are reported under `unreachable` rather than folded into a total.
 */
export type UnifiedInboxSummary = {
  pending_count: number;
  overdue_count: number;
  aged_count: number;
  unread_count: number;
  by_source: Record<string, number>;
  by_type: Array<{ type: string; priority: string; count: number; actionUrl: string | null }>;
};

export async function getUnifiedInboxSummary(
  userId: string,
  roleKeys: readonly string[],
): Promise<UnifiedInboxSummary> {
  // An empty role list must not become `IN ()`, which is a syntax error.
  const roles = roleKeys.length > 0 ? [...roleKeys] : ["__none__"];
  const rolePlaceholders = roles.map(() => "?").join(",");

  // legacy, inbox and byType each read a disjoint set of rows — none depends on
  // another's result. Previously three sequential awaits, which on this dashboard
  // route runs on every single load; running them concurrently drops this
  // function's cost to roughly its single slowest query instead of the sum of
  // all three (measured ~1.7-1.9s sequential against the live DB).
  const [[legacy], [inbox], [byType]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending_count,
              SUM(CASE WHEN due_at IS NOT NULL AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue_count,
              SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL ${INBOX_AGED_DAYS} DAY) THEN 1 ELSE 0 END) AS aged_count
         FROM work_item
        WHERE status = 'pending'
          AND (assigned_to_user_id = ? OR assigned_to_role IN (${rolePlaceholders}))`,
      [userId, ...roles],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending_count,
              SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL ${INBOX_AGED_DAYS} DAY) THEN 1 ELSE 0 END) AS aged_count,
              SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread_count
         FROM work_inbox_item
        WHERE user_id = ? AND is_actioned = 0`,
      [userId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT item_type AS type, priority, COUNT(*) AS count, NULL AS actionUrl
         FROM work_item
        WHERE status = 'pending'
          AND (assigned_to_user_id = ? OR assigned_to_role IN (${rolePlaceholders}))
        GROUP BY item_type, priority
       UNION ALL
       SELECT type, priority, COUNT(*) AS count,
              CASE WHEN COUNT(*) = 1 THEN MIN(action_url) ELSE NULL END AS actionUrl
         FROM work_inbox_item
        WHERE user_id = ? AND is_actioned = 0
        GROUP BY type, priority
        ORDER BY count DESC`,
      [userId, ...roles, userId],
    ),
  ]);

  const legacyRow = (legacy as RowDataPacket[])[0] ?? {};
  const inboxRow = (inbox as RowDataPacket[])[0] ?? {};
  const legacyPending = Number(legacyRow.pending_count ?? 0);
  const inboxPending = Number(inboxRow.pending_count ?? 0);

  return {
    pending_count: legacyPending + inboxPending,
    // Only `work_item` carries a due date. `work_inbox_item` has none, so its rows are
    // never counted as overdue — an unactioned age is not a missed deadline.
    overdue_count: Number(legacyRow.overdue_count ?? 0),
    aged_count: Number(legacyRow.aged_count ?? 0) + Number(inboxRow.aged_count ?? 0),
    unread_count: Number(inboxRow.unread_count ?? 0),
    by_source: { work_item: legacyPending, work_inbox_item: inboxPending },
    // A multi-item group links to the inbox, not to one arbitrary member of itself.
    //
    // The SQL used to take MIN(action_url) across the group, so the row reading "611
    // attendance missing punch" deep-linked to a single employee on a single date
    // (MAS01963, 2026-08-01) and the other 610 were unreachable from the tile. Reading
    // that row, you cannot tell you are being sent to one of 611 rather than to all of
    // them. A single-item group still deep-links, because there the member and the group
    // are the same thing.
    //
    // Note this lands on the unfiltered inbox: /api/inbox/my-pending does not expose the
    // `type` field this grouping uses (it carries `module` and `entity_type`, a different
    // vocabulary), so a ?type= param would filter to zero rows and be worse than none.
    // Pre-filtering the destination needs that field plumbed through first.
    by_type: (byType as RowDataPacket[]).map((row) => ({
      type: String(row.type),
      priority: String(row.priority),
      count: Number(row.count),
      actionUrl: (row.actionUrl as string | null) ?? "/work-inbox",
    })),
  };
}

export async function getDashboardWorkItems(branchId?: string, processId?: string) {
  const params: string[] = [];
  let where = "wi.status NOT IN ('completed','cancelled')";
  if (branchId) { where += " AND wi.branch_id = ?"; params.push(branchId); }
  if (processId) { where += " AND wi.process_id = ?"; params.push(processId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.item_type, wi.priority, COUNT(*) as count,
            SUM(CASE WHEN wi.due_at < NOW() THEN 1 ELSE 0 END) as overdue_count
     FROM work_item wi WHERE ${where}
     GROUP BY wi.item_type, wi.priority
     ORDER BY wi.priority`,
    params
  );
  return rows;
}
