import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { fetchProcessMetricValues } from "../process-performance/process-metric-source.js";

/**
 * Dashboards somebody assembles, rather than ones a developer ships.
 *
 * This composes metrics that already exist — KPI Studio's, and the process
 * registry's — into a layout. It deliberately does NOT define sources,
 * formulas or grain: those are Studio's job, and duplicating them here is how
 * two rival definitions of the same number appear.
 *
 * ── The boundary that matters ───────────────────────────────────────────────
 * A dashboard's author picks which process a widget reads. The VIEWER may not
 * be entitled to that process. So every widget is resolved against the
 * viewer's own scope predicate at read time, not the author's: a widget
 * pointing at a process outside your scope returns no_data with a reason,
 * never that client's numbers. "Anyone can build one" must not become "anyone
 * can publish one that leaks".
 */

const VIEWER_ROLES = [
  "super_admin", "admin", "ceo", "coo", "manager", "process_manager",
  "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head",
  "hr", "team_leader",
];

const WIDGET_TYPES = ["kpi_tile", "line", "bar", "pie", "table"] as const;
const METRIC_SOURCES = ["kpi_daily_actual", "process_metric_actual"] as const;
const DATE_RANGES = ["last_7_days", "last_30_days", "this_month", "last_month"] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];
export type MetricSource = (typeof METRIC_SOURCES)[number];
export type DateRange = (typeof DATE_RANGES)[number];

export interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  processId: string | null;
  ownerUserId: string | null;
  visibleRoles: string[];
  widgetCount?: number;
}

export interface WidgetRow {
  id: string;
  dashboardId: string;
  title: string | null;
  widgetType: WidgetType;
  metricSource: MetricSource;
  metricKey: string;
  processId: string | null;
  dateRange: DateRange;
  gridWidth: number;
  gridHeight: number;
  position: number;
  config: Record<string, unknown> | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Resolved at READ time, never stored as literal dates. A dashboard saved in
 * August must not still be showing August in October because its range was
 * frozen when it was built.
 */
export function resolveDateRange(range: DateRange, today = new Date()): { from: string; to: string } {
  const end = new Date(today);
  switch (range) {
    case "last_7_days": {
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { from: iso(start), to: iso(end) };
    }
    case "last_30_days": {
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      return { from: iso(start), to: iso(end) };
    }
    case "last_month": {
      const start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      // Day 0 of the next month is the last day of this one, which is how a
      // 30/31/28-day month stays correct without a lookup table.
      const finish = new Date(end.getFullYear(), end.getMonth(), 0);
      return { from: iso(start), to: iso(finish) };
    }
    case "this_month":
    default: {
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      return { from: iso(start), to: iso(end) };
    }
  }
}

function parseRoles(raw: unknown): string[] {
  return String(raw ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function toDashboard(row: RowDataPacket): DashboardRow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    processId: row.process_id == null ? null : String(row.process_id),
    ownerUserId: row.owner_user_id == null ? null : String(row.owner_user_id),
    visibleRoles: parseRoles(row.visible_roles),
    widgetCount: row.widget_count == null ? undefined : Number(row.widget_count),
  };
}

function toWidget(row: RowDataPacket): WidgetRow {
  let config: Record<string, unknown> | null = null;
  const raw = row.config_json;
  if (raw) {
    config = typeof raw === "string" ? safeParse(raw) : (raw as Record<string, unknown>);
  }
  return {
    id: String(row.id),
    dashboardId: String(row.dashboard_id),
    title: row.title == null ? null : String(row.title),
    widgetType: String(row.widget_type) as WidgetType,
    metricSource: String(row.metric_source) as MetricSource,
    metricKey: String(row.metric_key),
    processId: row.process_id == null ? null : String(row.process_id),
    dateRange: String(row.date_range) as DateRange,
    gridWidth: Number(row.grid_width),
    gridHeight: Number(row.grid_height),
    position: Number(row.position),
    config,
  };
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Dashboards ──────────────────────────────────────────────────────────────

export async function listDashboards(userId: string, role: string): Promise<DashboardRow[]> {
  // Own it, or hold a role it was shared with. A dashboard with no roles named
  // is private to its author — sharing is opt-in, not the default.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.*, COUNT(w.id) AS widget_count
       FROM builder_dashboard d
       LEFT JOIN builder_dashboard_widget w
              ON w.dashboard_id = d.id AND w.active_status = 1
      WHERE d.active_status = 1
        AND (d.owner_user_id = ? OR FIND_IN_SET(?, REPLACE(COALESCE(d.visible_roles,''), ' ', '')) > 0)
      GROUP BY d.id
      ORDER BY d.name`,
    [userId, role],
  );
  return rows.map(toDashboard);
}

export async function getDashboard(
  userId: string, role: string, id: string,
): Promise<{ dashboard: DashboardRow; widgets: WidgetRow[] } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM builder_dashboard
      WHERE id = ? AND active_status = 1
        AND (owner_user_id = ? OR FIND_IN_SET(?, REPLACE(COALESCE(visible_roles,''), ' ', '')) > 0)
      LIMIT 1`,
    [id, userId, role],
  );
  if (!rows.length) return null;

  const [widgetRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM builder_dashboard_widget
      WHERE dashboard_id = ? AND active_status = 1
      ORDER BY position ASC, created_at ASC`,
    [id],
  );
  return { dashboard: toDashboard(rows[0]), widgets: widgetRows.map(toWidget) };
}

export async function saveDashboard(input: {
  id?: string;
  userId: string;
  name: string;
  description?: string | null;
  processId?: string | null;
  visibleRoles?: string[] | null;
}): Promise<{ id: string }> {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the dashboard a name");

  // Only roles this system knows: a typo here would silently share with nobody
  // and look like a permissions bug.
  const roles = (input.visibleRoles ?? []).map((r) => String(r).trim()).filter(Boolean);
  for (const role of roles) {
    if (!VIEWER_ROLES.includes(role)) throw new Error(`Unknown role "${role}"`);
  }

  if (input.id) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE builder_dashboard
          SET name = ?, description = ?, process_id = ?, visible_roles = ?
        WHERE id = ? AND owner_user_id = ?`,
      [name, input.description?.trim() || null, input.processId || null, roles.join(",") || null, input.id, input.userId],
    );
    if (!result.affectedRows) {
      throw new Error("Dashboard not found, or it is not yours to edit");
    }
    return { id: input.id };
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO builder_dashboard (id, name, description, process_id, owner_user_id, visible_roles)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, input.description?.trim() || null, input.processId || null, input.userId, roles.join(",") || null],
  );
  return { id };
}

export async function deleteDashboard(userId: string, id: string): Promise<{ ok: boolean }> {
  // Soft delete: a dashboard somebody built is not worth destroying over a
  // misclick, and the widgets stay attached if it is restored.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE builder_dashboard SET active_status = 0 WHERE id = ? AND owner_user_id = ?`,
    [id, userId],
  );
  return { ok: Boolean(result.affectedRows) };
}

// ─── Widgets ─────────────────────────────────────────────────────────────────

async function assertOwnsDashboard(userId: string, dashboardId: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM builder_dashboard WHERE id = ? AND owner_user_id = ? AND active_status = 1 LIMIT 1`,
    [dashboardId, userId],
  );
  if (!rows.length) throw new Error("Dashboard not found, or it is not yours to edit");
}

export async function saveWidget(input: {
  id?: string;
  userId: string;
  dashboardId: string;
  title?: string | null;
  widgetType: string;
  metricSource: string;
  metricKey: string;
  processId?: string | null;
  dateRange?: string | null;
  gridWidth?: number | null;
  gridHeight?: number | null;
  position?: number | null;
  config?: Record<string, unknown> | null;
}): Promise<{ id: string }> {
  await assertOwnsDashboard(input.userId, input.dashboardId);

  // Every closed set is checked rather than trusted. An unknown widget_type
  // would be stored happily by MySQL's ENUM as '' and render as nothing, which
  // reads as a broken dashboard rather than a rejected input.
  if (!WIDGET_TYPES.includes(input.widgetType as WidgetType)) {
    throw new Error(`Unknown chart type "${input.widgetType}". Use one of ${WIDGET_TYPES.join(", ")}.`);
  }
  if (!METRIC_SOURCES.includes(input.metricSource as MetricSource)) {
    throw new Error(`Unknown metric source "${input.metricSource}"`);
  }
  const dateRange = (input.dateRange || "this_month") as DateRange;
  if (!DATE_RANGES.includes(dateRange)) {
    throw new Error(`Unknown date range "${dateRange}". Use one of ${DATE_RANGES.join(", ")}.`);
  }
  const metricKey = String(input.metricKey ?? "").trim();
  if (!metricKey) throw new Error("Pick a metric for this widget");

  // Clamped rather than rejected: a width of 20 is a slip, not an attack, and
  // silently fixing it is kinder than an error about a grid the user cannot see.
  const width = Math.min(Math.max(Number(input.gridWidth ?? 6), 1), 12);
  const height = Math.min(Math.max(Number(input.gridHeight ?? 1), 1), 4);
  const position = Math.max(Number(input.position ?? 0), 0);
  const config = input.config ? JSON.stringify(input.config) : null;

  if (input.id) {
    await db.execute(
      `UPDATE builder_dashboard_widget
          SET title = ?, widget_type = ?, metric_source = ?, metric_key = ?, process_id = ?,
              date_range = ?, grid_width = ?, grid_height = ?, position = ?, config_json = ?
        WHERE id = ? AND dashboard_id = ?`,
      [
        input.title?.trim() || null, input.widgetType, input.metricSource, metricKey,
        input.processId || null, dateRange, width, height, position, config,
        input.id, input.dashboardId,
      ],
    );
    return { id: input.id };
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO builder_dashboard_widget
       (id, dashboard_id, title, widget_type, metric_source, metric_key, process_id,
        date_range, grid_width, grid_height, position, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.dashboardId, input.title?.trim() || null, input.widgetType, input.metricSource,
      metricKey, input.processId || null, dateRange, width, height, position, config,
    ],
  );
  return { id };
}

export async function deleteWidget(userId: string, dashboardId: string, widgetId: string): Promise<{ ok: boolean }> {
  await assertOwnsDashboard(userId, dashboardId);
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE builder_dashboard_widget SET active_status = 0 WHERE id = ? AND dashboard_id = ?`,
    [widgetId, dashboardId],
  );
  return { ok: Boolean(result.affectedRows) };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export interface RenderedWidget extends WidgetRow {
  availability: "ok" | "no_data" | "out_of_scope";
  value: number | null;
  series: Array<{ period: string; value: number | null }>;
  note?: string;
}

/**
 * Which processes this viewer may see, as a set. Derived from the SAME scope
 * predicate every other surface uses, so a dashboard cannot become a way around
 * it — the author's entitlements are irrelevant here, only the reader's.
 */
async function readableProcessIds(userId: string): Promise<Set<string>> {
  const scope = await buildScopeWhereClause(userId, VIEWER_ROLES, {
    processId: "p.id", branchId: "p.branch_id",
  }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id FROM process_master p WHERE ${scope.sql}`,
    scope.params,
  );
  return new Set(rows.map((r) => String(r.id)));
}

export async function renderDashboard(
  userId: string, role: string, id: string,
): Promise<{ dashboard: DashboardRow; widgets: RenderedWidget[] } | null> {
  const loaded = await getDashboard(userId, role, id);
  if (!loaded) return null;

  const allowed = await readableProcessIds(userId);
  const rendered: RenderedWidget[] = [];

  for (const widget of loaded.widgets) {
    const processId = widget.processId || loaded.dashboard.processId;
    const { from, to } = resolveDateRange(widget.dateRange);

    if (!processId) {
      rendered.push({
        ...widget, availability: "no_data", value: null, series: [],
        note: "This widget has no process — set one on the widget or the dashboard.",
      });
      continue;
    }

    // The reader's scope, not the author's. A widget aimed at a process this
    // person cannot see reports that plainly rather than returning the numbers.
    if (!allowed.has(processId)) {
      rendered.push({
        ...widget, availability: "out_of_scope", value: null, series: [],
        note: "This widget reads a process outside your access.",
      });
      continue;
    }

    if (widget.metricSource === "process_metric_actual") {
      const readings = await fetchProcessMetricValues(processId, [widget.metricKey], from, to);
      const reading = readings.get(widget.metricKey);
      rendered.push({
        ...widget,
        availability: reading && reading.count > 0 ? "ok" : "no_data",
        value: reading?.value ?? null,
        series: reading?.trend ?? [],
        note: reading && reading.count > 0 ? undefined : "Nothing supplied for this window yet.",
      });
      continue;
    }

    // kpi_daily_actual, joined through the employee's CURRENT process — the
    // same join quality-target.service.ts uses, because process_id_at_event is
    // only sparsely populated.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(k.score_date, '%Y-%m') AS period,
              AVG(k.actual_value) AS value, COUNT(k.actual_value) AS n
         FROM employees e
         JOIN kpi_daily_actual k ON k.employee_id = e.id
         JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = ?
        WHERE e.process_id = ? AND k.score_date BETWEEN ? AND ?
        GROUP BY period ORDER BY period ASC`,
      [widget.metricKey, processId, from, to],
    );
    const series = rows
      .filter((r) => Number(r.n) > 0)
      .map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) }));
    const readings = series.map((s) => s.value).filter((v): v is number => v != null);
    rendered.push({
      ...widget,
      availability: readings.length ? "ok" : "no_data",
      // The headline is the mean of the periods shown, so it agrees with the
      // chart beside it rather than being computed a second, different way.
      value: readings.length ? readings.reduce((a, b) => a + b, 0) / readings.length : null,
      series,
      note: readings.length ? undefined : "No readings for this metric in this window.",
    });
  }

  return { dashboard: loaded.dashboard, widgets: rendered };
}
