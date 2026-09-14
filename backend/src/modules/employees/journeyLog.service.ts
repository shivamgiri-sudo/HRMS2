import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface JourneyEvent {
  id: string;
  employee_id: string;
  event_type: string;
  event_date: string;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  module: string | null;
  triggered_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_name?: string | null;
  source?: string;
  status?: string | null;
}

export interface AppendEventInput {
  employeeId: string;
  eventType: string;
  eventDate: string;
  description?: string;
  oldValue?: string;
  newValue?: string;
  module?: string;
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ListFilters {
  module?: string;
  eventType?: string;
  fromDate?: string;
  toDate?: string;
}

export async function appendJourneyEvent(input: AppendEventInput): Promise<JourneyEvent> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO employee_journey_log
       (id, employee_id, event_type, event_date, description,
        old_value, new_value, module, triggered_by, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.employeeId,
      input.eventType,
      input.eventDate,
      input.description ?? null,
      input.oldValue ?? null,
      input.newValue ?? null,
      input.module ?? null,
      input.triggeredBy ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_journey_log WHERE id = ? LIMIT 1", [id]
  );
  return (rows as JourneyEvent[])[0];
}

/**
 * Batch-insert multiple journey events in a single round-trip.
 * Use this instead of calling appendJourneyEvent in a loop.
 */
export async function appendJourneyEvents(inputs: AppendEventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const rows = inputs.map(input => [
    randomUUID(),
    input.employeeId,
    input.eventType,
    input.eventDate,
    input.description ?? null,
    input.oldValue ?? null,
    input.newValue ?? null,
    input.module ?? null,
    input.triggeredBy ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
  ]);
  const ph = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  await db.execute(
    `INSERT INTO employee_journey_log
       (id, employee_id, event_type, event_date, description,
        old_value, new_value, module, triggered_by, metadata)
     VALUES ${ph}`,
    rows.flat()
  );
}

export async function listJourneyEvents(
  employeeId: string,
  filters?: ListFilters
): Promise<JourneyEvent[]> {
  const conds: string[] = ["employee_id = ?"];
  const params: unknown[] = [employeeId];

  if (filters?.module)    { conds.push("module = ?");     params.push(filters.module); }
  if (filters?.eventType) { conds.push("event_type = ?"); params.push(filters.eventType); }
  if (filters?.fromDate)  { conds.push("event_date >= ?"); params.push(filters.fromDate); }
  if (filters?.toDate)    { conds.push("event_date <= ?"); params.push(filters.toDate); }

  const where = conds.join(" AND ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_journey_log WHERE ${where} ORDER BY event_date DESC, created_at DESC`,
    params
  );
  return rows as JourneyEvent[];
}

async function safeRows(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows;
  } catch {
    return [];
  }
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function dateOnly(value: unknown): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function currency(value: unknown): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export async function listComprehensiveJourney(
  employeeId: string,
  options: { includeCompensation?: boolean; filters?: ListFilters } = {}
): Promise<JourneyEvent[]> {
  const events: Array<JourneyEvent & { source_key?: string }> = [];

  const baseRows = await safeRows(
    `SELECT e.id, e.date_of_joining, e.date_of_exit, e.created_at,
            d.designation_name, dept.dept_name, b.branch_name, p.process_name,
            CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')) AS manager_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId]
  );
  const employee = baseRows[0];

  const logRows = await safeRows(
    `SELECT jl.*,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM employee_journey_log jl
       LEFT JOIN auth_user au ON au.id = jl.triggered_by
       LEFT JOIN employees actor ON actor.user_id = jl.triggered_by
      WHERE jl.employee_id = ?
      ORDER BY jl.event_date DESC, jl.created_at DESC`,
    [employeeId]
  );

  const represented = new Set<string>();
  for (const row of logRows) {
    const metadata = parseMetadata(row.metadata);
    for (const [field, source] of [
      ["lifecycle_event_id", "lifecycle"],
      ["promotion_id", "promotion"],
      ["transfer_id", "transfer"],
      ["pip_id", "pip"],
      ["exit_request_id", "exit"],
      ["salary_assignment_id", "salary"],
    ] as const) {
      if (metadata[field]) represented.add(`${source}:${metadata[field]}`);
    }
    events.push({
      ...(row as JourneyEvent),
      event_date: dateOnly(row.event_date),
      metadata,
      actor_name: row.actor_name ?? null,
      source: String(row.module ?? "journey").toLowerCase(),
      source_key: `journey:${row.id}`,
    });
  }

  if (employee?.date_of_joining && !events.some((event) =>
    ["hire", "hired", "hiring", "joining"].includes(event.event_type.toLowerCase())
  )) {
    const workContext = [
      employee.designation_name,
      employee.dept_name,
      employee.branch_name,
      employee.process_name,
    ].filter(Boolean).join(" · ");
    events.push({
      id: `joining-${employeeId}`,
      employee_id: employeeId,
      event_type: "joining",
      event_date: dateOnly(employee.date_of_joining),
      description: `Joined Mas Callnet India Pvt Ltd${workContext ? ` as ${workContext}` : ""}`,
      old_value: null,
      new_value: employee.designation_name ?? null,
      module: "ONBOARDING",
      triggered_by: null,
      metadata: { manager_name: employee.manager_name ?? null },
      created_at: dateOnly(employee.created_at),
      actor_name: employee.manager_name ?? "HR Team",
      source: "onboarding",
      source_key: `employee:${employeeId}:joining`,
    });
  }

  const atsRows = await safeRows(
    `SELECT sl.id, sl.from_stage, sl.to_stage, sl.stage_date, sl.remarks, sl.updated_by,
            c.candidate_code,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM ats_onboarding_bridge bridge
       JOIN ats_candidate c ON c.id = bridge.candidate_id
       JOIN ats_candidate_stage_log sl ON sl.candidate_id = c.id
       LEFT JOIN auth_user au ON au.id = sl.updated_by
       LEFT JOIN employees actor ON actor.user_id = sl.updated_by
      WHERE bridge.employee_id = ?
      ORDER BY sl.stage_date`,
    [employeeId]
  );
  for (const row of atsRows) {
    events.push({
      id: `ats-stage-${row.id}`,
      employee_id: employeeId,
      event_type: "hiring_stage",
      event_date: dateOnly(row.stage_date),
      description: row.remarks || `Hiring moved from ${row.from_stage || "application"} to ${row.to_stage}`,
      old_value: row.from_stage ?? null,
      new_value: row.to_stage,
      module: "ATS",
      triggered_by: row.updated_by ?? null,
      metadata: { candidate_code: row.candidate_code },
      created_at: String(row.stage_date),
      actor_name: row.actor_name ?? "Recruitment Team",
      source: "ats",
      source_key: `ats-stage:${row.id}`,
    });
  }

  const lifecycleRows = await safeRows(
    `SELECT le.*,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM employee_lifecycle_event le
       LEFT JOIN auth_user au ON au.id = le.initiated_by
       LEFT JOIN employees actor ON actor.user_id = le.initiated_by
      WHERE le.employee_id = ?`,
    [employeeId]
  );
  for (const row of lifecycleRows) {
    if (represented.has(`lifecycle:${row.id}`)) continue;
    events.push({
      id: `lifecycle-${row.id}`,
      employee_id: employeeId,
      event_type: row.event_type,
      event_date: dateOnly(row.effective_date),
      description: row.remarks ?? String(row.event_type).replace(/_/g, " "),
      old_value: row.old_value_json ? JSON.stringify(parseMetadata(row.old_value_json)) : null,
      new_value: row.new_value_json ? JSON.stringify(parseMetadata(row.new_value_json)) : null,
      module: "LIFECYCLE",
      triggered_by: row.initiated_by,
      metadata: { lifecycle_event_id: row.id, approved_by: row.approved_by },
      created_at: String(row.created_at),
      actor_name: row.actor_name ?? "HR Team",
      source: "lifecycle",
      source_key: `lifecycle:${row.id}`,
    });
  }

  const promotionRows = await safeRows(
    `SELECT pr.*,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM promotion_record pr
       LEFT JOIN auth_user au ON au.id = pr.initiated_by
       LEFT JOIN employees actor ON actor.user_id = pr.initiated_by
      WHERE pr.employee_id = ?`,
    [employeeId]
  );
  for (const row of promotionRows) {
    if (represented.has(`promotion:${row.id}`)) continue;
    const salaryText = options.includeCompensation && row.salary_revision
      ? ` with revised annual CTC ${currency(row.salary_revision)}`
      : "";
    events.push({
      id: `promotion-${row.id}`,
      employee_id: employeeId,
      event_type: "promotion",
      event_date: dateOnly(row.effective_date),
      description: row.reason || `Promotion ${row.status}${salaryText}`,
      old_value: row.from_designation ?? row.from_grade ?? null,
      new_value: row.to_designation ?? row.to_grade,
      module: "MOBILITY",
      triggered_by: row.initiated_by,
      metadata: { promotion_id: row.id, salary_revision: options.includeCompensation ? row.salary_revision : undefined },
      created_at: String(row.created_at),
      actor_name: row.actor_name ?? "HR Team",
      source: "promotion",
      status: row.status,
      source_key: `promotion:${row.id}`,
    });
  }

  const transferRows = await safeRows(
    `SELECT tr.*,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM transfer_record tr
       LEFT JOIN auth_user au ON au.id = tr.initiated_by
       LEFT JOIN employees actor ON actor.user_id = tr.initiated_by
      WHERE tr.employee_id = ?`,
    [employeeId]
  );
  for (const row of transferRows) {
    if (represented.has(`transfer:${row.id}`)) continue;
    events.push({
      id: `transfer-${row.id}`,
      employee_id: employeeId,
      event_type: `${row.transfer_type}_change`,
      event_date: dateOnly(row.effective_date),
      description: row.reason || `${String(row.transfer_type).replace(/_/g, " ")} transfer ${row.status}`,
      old_value: row.from_value,
      new_value: row.to_value,
      module: "MOBILITY",
      triggered_by: row.initiated_by,
      metadata: { transfer_id: row.id },
      created_at: String(row.created_at),
      actor_name: row.actor_name ?? "HR Team",
      source: "transfer",
      status: row.status,
      source_key: `transfer:${row.id}`,
    });
  }

  const pipRows = await safeRows(
    `SELECT pr.*, pc.id AS checkpoint_id, pc.checkpoint_date, pc.rating, pc.notes AS checkpoint_notes,
            pc.recorded_by,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM pip_record pr
       LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
       LEFT JOIN auth_user au ON au.id = COALESCE(pc.recorded_by, pr.initiated_by)
       LEFT JOIN employees actor ON actor.user_id = COALESCE(pc.recorded_by, pr.initiated_by)
      WHERE pr.employee_id = ?
      ORDER BY pr.start_date, pc.checkpoint_date`,
    [employeeId]
  );
  const pipStarted = new Set<string>();
  for (const row of pipRows) {
    if (!pipStarted.has(row.id) && !represented.has(`pip:${row.id}`)) {
      pipStarted.add(row.id);
      events.push({
        id: `pip-${row.id}`,
        employee_id: employeeId,
        event_type: "pip_started",
        event_date: dateOnly(row.start_date),
        description: row.reason,
        old_value: null,
        new_value: `Review due ${dateOnly(row.end_date)}`,
        module: "PERFORMANCE",
        triggered_by: row.initiated_by,
        metadata: { pip_id: row.id, goals: parseMetadata(row.goals) },
        created_at: String(row.created_at),
        actor_name: row.actor_name ?? "Manager",
        source: "pip",
        status: row.status,
        source_key: `pip:${row.id}`,
      });
      if (row.closed_at) {
        events.push({
          id: `pip-closed-${row.id}`,
          employee_id: employeeId,
          event_type: "pip_outcome",
          event_date: dateOnly(row.closed_at),
          description: row.review_notes || `PIP closed with outcome: ${row.outcome || row.status}`,
          old_value: "active",
          new_value: row.outcome ?? row.status,
          module: "PERFORMANCE",
          triggered_by: row.closed_by,
          metadata: { pip_id: row.id },
          created_at: String(row.closed_at),
          actor_name: row.actor_name ?? "Manager",
          source: "pip",
          status: row.status,
          source_key: `pip-closed:${row.id}`,
        });
      }
    }
    if (row.checkpoint_id) {
      events.push({
        id: `pip-checkpoint-${row.checkpoint_id}`,
        employee_id: employeeId,
        event_type: "pip_checkpoint",
        event_date: dateOnly(row.checkpoint_date),
        description: row.checkpoint_notes || `PIP checkpoint rated ${row.rating}`,
        old_value: null,
        new_value: row.rating,
        module: "PERFORMANCE",
        triggered_by: row.recorded_by,
        metadata: { pip_id: row.id, checkpoint_id: row.checkpoint_id },
        created_at: String(row.checkpoint_date),
        actor_name: row.actor_name ?? "Manager",
        source: "pip",
        status: row.rating,
        source_key: `pip-checkpoint:${row.checkpoint_id}`,
      });
    }
  }

  const kudosRows = await safeRows(
    `SELECT kt.*, km.kudos_title,
            CASE
              WHEN kt.is_anonymous = 1 THEN 'Anonymous colleague'
              ELSE CONCAT(sender.first_name, ' ', COALESCE(sender.last_name, ''))
            END AS actor_name
       FROM kudos_transaction kt
       LEFT JOIN kudos_master km ON km.kudos_template_id = kt.kudos_template_id
       LEFT JOIN employees sender ON sender.id = kt.sender_id
      WHERE kt.receiver_id = ?`,
    [employeeId]
  );
  for (const row of kudosRows) {
    events.push({
      id: `kudos-${row.kudos_id}`,
      employee_id: employeeId,
      event_type: "appreciation",
      event_date: dateOnly(row.sent_at),
      description: row.custom_message || row.kudos_title || "Received appreciation",
      old_value: null,
      new_value: row.kudos_title ?? `${row.points_awarded} recognition points`,
      module: "ENGAGEMENT",
      triggered_by: row.sender_id,
      metadata: { kudos_id: row.kudos_id, points: row.points_awarded },
      created_at: String(row.sent_at),
      actor_name: row.actor_name ?? "Colleague",
      source: "appreciation",
      source_key: `kudos:${row.kudos_id}`,
    });
  }

  if (options.includeCompensation) {
    const salaryRows = await safeRows(
      `SELECT esa.id, esa.ctc_annual, esa.effective_from, esa.effective_to,
              esa.active_status, esa.created_at, ssm.structure_name
         FROM employee_salary_assignment esa
         LEFT JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
        WHERE esa.employee_id = ?
        ORDER BY esa.effective_from, esa.created_at`,
      [employeeId]
    );
    let previousCtc: number | null = null;
    for (const row of salaryRows) {
      if (represented.has(`salary:${row.id}`)) {
        previousCtc = Number(row.ctc_annual ?? 0);
        continue;
      }
      const currentCtc = Number(row.ctc_annual ?? 0);
      events.push({
        id: `salary-${row.id}`,
        employee_id: employeeId,
        event_type: previousCtc == null ? "salary_setup" : "increment",
        event_date: dateOnly(row.effective_from),
        description: previousCtc == null
          ? `Initial annual CTC assigned${row.structure_name ? ` under ${row.structure_name}` : ""}`
          : "Annual compensation revised",
        old_value: previousCtc == null ? null : currency(previousCtc),
        new_value: currency(currentCtc),
        module: "PAYROLL",
        triggered_by: null,
        metadata: { salary_assignment_id: row.id, active: Boolean(row.active_status) },
        created_at: String(row.created_at),
        actor_name: "HR / Payroll",
        source: "salary",
        source_key: `salary:${row.id}`,
      });
      previousCtc = currentCtc;
    }
  }

  const exitRows = await safeRows(
    `SELECT er.id, er.status, er.exit_type, er.exit_sub_type, er.exit_reason_category,
            er.resignation_reason, er.last_working_day_proposed, er.last_working_day_confirmed,
            er.initiated_by_user_id, er.created_at,
            eal.id AS action_id, eal.stage, eal.action, eal.action_by,
            eal.action_by_role, eal.discussion_remarks, eal.created_at AS action_at,
            COALESCE(
              NULLIF(TRIM(CONCAT(actor.first_name, ' ', COALESCE(actor.last_name, ''))), ''),
              au.email
            ) AS actor_name
       FROM exit_request er
       LEFT JOIN exit_approval_log eal ON eal.exit_request_id = er.id
       LEFT JOIN auth_user au ON au.id = COALESCE(eal.action_by, er.initiated_by_user_id)
       LEFT JOIN employees actor ON actor.user_id = COALESCE(eal.action_by, er.initiated_by_user_id)
      WHERE er.employee_id = ?
      ORDER BY er.created_at, eal.created_at`,
    [employeeId]
  );
  const exitStarted = new Set<string>();
  for (const row of exitRows) {
    if (!exitStarted.has(row.id) && !represented.has(`exit:${row.id}`)) {
      exitStarted.add(row.id);
      events.push({
        id: `exit-${row.id}`,
        employee_id: employeeId,
        event_type: "exit_initiated",
        event_date: dateOnly(row.created_at),
        description: row.resignation_reason || `${row.exit_type} ${row.exit_sub_type || "exit"} initiated`,
        old_value: null,
        new_value: row.last_working_day_confirmed || row.last_working_day_proposed
          ? `Proposed last day: ${dateOnly(row.last_working_day_confirmed || row.last_working_day_proposed)}`
          : row.status,
        module: "EXIT",
        triggered_by: row.initiated_by_user_id,
        metadata: { exit_request_id: row.id, reason_category: row.exit_reason_category },
        created_at: String(row.created_at),
        actor_name: row.actor_name ?? "Employee",
        source: "exit",
        status: row.status,
        source_key: `exit:${row.id}`,
      });
    }
    if (row.action_id) {
      events.push({
        id: `exit-action-${row.action_id}`,
        employee_id: employeeId,
        event_type: row.status === "exited" ? "exit" : "exit_stage",
        event_date: dateOnly(row.action_at),
        description: row.discussion_remarks || `${row.stage}: ${row.action}`,
        old_value: row.stage,
        new_value: row.action,
        module: "EXIT",
        triggered_by: row.action_by,
        metadata: { exit_request_id: row.id, role: row.action_by_role },
        created_at: String(row.action_at),
        actor_name: row.actor_name ?? row.action_by_role ?? "HR Team",
        source: "exit",
        status: row.status,
        source_key: `exit-action:${row.action_id}`,
      });
    }
  }

  if (employee?.date_of_exit && !events.some((event) => event.event_type === "exit")) {
    events.push({
      id: `employee-exit-${employeeId}`,
      employee_id: employeeId,
      event_type: "exit",
      event_date: dateOnly(employee.date_of_exit),
      description: "Employment journey completed",
      old_value: "active",
      new_value: "exited",
      module: "EXIT",
      triggered_by: null,
      metadata: {},
      created_at: dateOnly(employee.date_of_exit),
      actor_name: "HR Team",
      source: "exit",
      source_key: `employee:${employeeId}:exit`,
    });
  }

  const deduplicated = new Map<string, JourneyEvent>();
  for (const event of events) {
    const key = event.source_key
      ?? `${event.event_type}:${event.event_date}:${event.old_value ?? ""}:${event.new_value ?? ""}:${event.description ?? ""}`;
    if (!deduplicated.has(key)) deduplicated.set(key, event);
  }

  const filters = options.filters;
  return [...deduplicated.values()]
    .filter((event) => !filters?.module || event.module?.toLowerCase() === filters.module.toLowerCase())
    .filter((event) => !filters?.eventType || event.event_type === filters.eventType)
    .filter((event) => !filters?.fromDate || event.event_date >= filters.fromDate)
    .filter((event) => !filters?.toDate || event.event_date <= filters.toDate)
    .sort((a, b) => {
      const byDate = b.event_date.localeCompare(a.event_date);
      return byDate || String(b.created_at).localeCompare(String(a.created_at));
    });
}
