import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AnalyticsError } from "./analytics.types.js";
import {
  accessLevel, validateDashboardInput, validateShares, validateWidgets,
  type AccessLevel, type Share, type Viewer, type WidgetInput,
} from "./dashboards.access.js";
import { scopeOptions } from "./query.service.js";
import { ANALYTICS_VIEWER_ROLES, isOrgWide, readableProcessIds } from "./scope.js";

/**
 * Dashboard Studio storage. Every read and write goes through accessLevel(); a dashboard the viewer cannot see is
 * reported as "not found" so its existence is never revealed.
 */

/** Someone else saved first (optimistic lock). The router maps this to HTTP 409. */
export class DashboardConflict extends Error {
  readonly code = "CONFLICT";
  constructor(message = "This dashboard was changed by someone else. Reload and try again.") { super(message); }
}

const notFound = () => new AnalyticsError("Dashboard not found", "NOT_FOUND");
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return (p ?? fallback) as T; } catch { return fallback; }
  }
  return v as T;
}
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export async function viewerFor(userId: string, roles: string[]): Promise<Viewer> {
  const processIds = await readableProcessIds(userId);
  const branchIds = new Set<string>();
  if (processIds.size) {
    const ids = [...processIds];
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT branch_id FROM process_master WHERE id IN (${marks(ids.length)}) AND branch_id IS NOT NULL`, ids);
    for (const r of rows) branchIds.add(String(r.branch_id));
  }
  // admin is branch-scoped like hr (owner ruling 2026-10-01): only org-wide viewers see/edit every dashboard. A branch
  // admin still may flag templates (feature gate) but reaches other people's dashboards only by ownership or a share.
  const isSuper = roles.includes("super_admin");
  const isAdminRole = roles.includes("admin");
  const editsAll = isSuper || (isAdminRole && (await isOrgWide(userId)));
  return { userId, roles, isAdmin: editsAll, canTemplate: isSuper || isAdminRole, processIds, branchIds };
}

const DASH_COLS = `d.id, d.name, d.description, d.owner_user_id, d.home_branch_id, d.home_process_id, d.theme, d.settings_json,
  d.is_template, d.version, d.updated_at, e.full_name AS owner_name,
  (SELECT COUNT(*) FROM analytics_widget w WHERE w.dashboard_id = d.id AND w.active_status = 1) AS widget_count`;
const DASH_FROM = "FROM analytics_dashboard d LEFT JOIN employees e ON e.user_id = d.owner_user_id";

function summary(r: RowDataPacket, viewer: Viewer, level: AccessLevel) {
  return {
    id: String(r.id), name: String(r.name), description: (r.description ?? null) as string | null, theme: String(r.theme),
    ownerUserId: String(r.owner_user_id), ownerName: (r.owner_name ?? null) as string | null,
    isOwner: String(r.owner_user_id) === viewer.userId, canEdit: level === "edit", isTemplate: Boolean(Number(r.is_template)),
    widgetCount: Number(r.widget_count ?? 0), homeBranchId: (r.home_branch_id ?? null) as string | null,
    homeProcessId: (r.home_process_id ?? null) as string | null, updatedAt: iso(r.updated_at),
  };
}

async function sharesFor(ids: string[]): Promise<Map<string, Share[]>> {
  const out = new Map<string, Share[]>();
  if (!ids.length) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT dashboard_id, principal_type, principal_value, permission FROM analytics_dashboard_share
      WHERE dashboard_id IN (${marks(ids.length)}) ORDER BY principal_type, principal_value`, ids);
  for (const r of rows) {
    const k = String(r.dashboard_id);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ principalType: r.principal_type, principalValue: String(r.principal_value), permission: r.permission });
  }
  return out;
}

export async function listDashboards(viewer: Viewer) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${DASH_COLS} ${DASH_FROM} WHERE d.active_status = 1 ORDER BY d.updated_at DESC, d.name`);
  const shares = await sharesFor(rows.map((r) => String(r.id)));
  const out: ReturnType<typeof summary>[] = [];
  for (const r of rows) {
    const level = accessLevel({ ownerUserId: String(r.owner_user_id), isTemplate: Boolean(Number(r.is_template)) }, shares.get(String(r.id)) ?? [], viewer);
    if (level !== "none") out.push(summary(r, viewer, level));
  }
  return out;
}

/** The row, its shares and the viewer's level; throws NOT_FOUND when missing or invisible to the viewer. */
async function load(viewer: Viewer, id: string) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${DASH_COLS} ${DASH_FROM} WHERE d.id = ? AND d.active_status = 1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw notFound();
  const shares = (await sharesFor([id])).get(id) ?? [];
  const level = accessLevel({ ownerUserId: String(row.owner_user_id), isTemplate: Boolean(Number(row.is_template)) }, shares, viewer);
  if (level === "none") throw notFound();
  return { row, shares, level, isOwner: String(row.owner_user_id) === viewer.userId };
}

async function loadForEdit(viewer: Viewer, id: string) {
  const d = await load(viewer, id);
  if (d.level !== "edit") throw new AnalyticsError("You can view this dashboard but not change it", "FORBIDDEN");
  return d;
}

async function loadForOwner(viewer: Viewer, id: string, what: string) {
  const d = await load(viewer, id);
  if (!d.isOwner && !viewer.isAdmin) throw new AnalyticsError(`Only the dashboard's owner can ${what}`, "FORBIDDEN");
  return d;
}

function checkVersion(given: unknown, current: unknown): number {
  const v = Number(given);
  if (!Number.isInteger(v) || v !== Number(current)) throw new DashboardConflict();
  return v;
}

async function activeWidgets(id: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, widget_type, title, subtitle, query_json, viz_json, layout_json FROM analytics_widget
      WHERE dashboard_id = ? AND active_status = 1 ORDER BY sort_order, created_at`, [id]);
  return rows.map((w) => ({
    id: String(w.id), widgetType: String(w.widget_type), title: (w.title ?? null) as string | null, subtitle: (w.subtitle ?? null) as string | null,
    query: parseJson<Record<string, unknown> | null>(w.query_json, null),
    viz: parseJson<Record<string, unknown>>(w.viz_json, {}),
    layout: parseJson<Record<string, unknown>>(w.layout_json, {}),
  }));
}

export async function getDashboard(viewer: Viewer, id: string) {
  const d = await load(viewer, id);
  const canEdit = d.level === "edit";
  return {
    dashboard: { ...summary(d.row, viewer, d.level), settings: parseJson<Record<string, unknown>>(d.row.settings_json, {}), version: Number(d.row.version) },
    widgets: await activeWidgets(id),
    shares: canEdit ? d.shares : [],
    canEdit,
  };
}

export async function createDashboard(viewer: Viewer, raw: unknown) {
  const input = validateDashboardInput(raw);
  const id = randomUUID();
  const isTemplate = (viewer.canTemplate ?? viewer.isAdmin) && (raw as Record<string, unknown>).isTemplate === true;
  await db.query(
    `INSERT INTO analytics_dashboard (id, name, description, owner_user_id, home_branch_id, home_process_id, theme, settings_json, is_template)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, input.name, input.description, viewer.userId, input.homeBranchId, input.homeProcessId, input.theme, JSON.stringify(input.settings), isTemplate ? 1 : 0]);
  return getDashboard(viewer, id);
}

export async function updateDashboard(viewer: Viewer, id: string, raw: unknown) {
  const input = validateDashboardInput(raw);
  const body = raw as Record<string, unknown>;
  const d = await loadForEdit(viewer, id);
  const version = checkVersion(body.version, d.row.version);
  // Only an admin may turn a dashboard into a template (or back); everyone else leaves the flag as it is.
  const isTemplate = (viewer.canTemplate ?? viewer.isAdmin) && typeof body.isTemplate === "boolean" ? (body.isTemplate ? 1 : 0) : Number(d.row.is_template);
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE analytics_dashboard SET name = ?, description = ?, home_branch_id = ?, home_process_id = ?, theme = ?, settings_json = ?,
        is_template = ?, version = version + 1
      WHERE id = ? AND version = ? AND active_status = 1`,
    [input.name, input.description, input.homeBranchId, input.homeProcessId, input.theme, JSON.stringify(input.settings), isTemplate, id, version]);
  if (!res.affectedRows) throw new DashboardConflict();
  return getDashboard(viewer, id);
}

const WIDGET_INSERT = `INSERT INTO analytics_widget (id, dashboard_id, widget_type, title, subtitle, query_json, viz_json, layout_json, sort_order, active_status)
  VALUES (?,?,?,?,?,?,?,?,?,1)`;
const widgetParams = (w: WidgetInput, dashboardId: string, i: number) => [
  w.id, dashboardId, w.widgetType, w.title, w.subtitle, w.query ? JSON.stringify(w.query) : null, JSON.stringify(w.viz), JSON.stringify(w.layout), i,
];

export async function saveWidgets(viewer: Viewer, id: string, rawWidgets: unknown, version: unknown) {
  const widgets = validateWidgets(rawWidgets);
  const d = await loadForEdit(viewer, id);
  const v = checkVersion(version, d.row.version);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [bump] = await conn.query<ResultSetHeader>(
      "UPDATE analytics_dashboard SET version = version + 1 WHERE id = ? AND version = ? AND active_status = 1", [id, v]);
    if (!bump.affectedRows) throw new DashboardConflict();
    if (widgets.length) {
      // An id that already belongs to another dashboard must never be overwritten from here: give that widget a fresh id.
      const [foreign] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM analytics_widget WHERE id IN (${marks(widgets.length)}) AND dashboard_id <> ?`, [...widgets.map((w) => w.id), id]);
      const taken = new Set(foreign.map((r) => String(r.id)));
      for (const w of widgets) if (taken.has(w.id)) w.id = randomUUID();
    }
    for (const [i, w] of widgets.entries()) {
      await conn.query(
        `${WIDGET_INSERT} ON DUPLICATE KEY UPDATE widget_type = VALUES(widget_type), title = VALUES(title), subtitle = VALUES(subtitle),
           query_json = VALUES(query_json), viz_json = VALUES(viz_json), layout_json = VALUES(layout_json), sort_order = VALUES(sort_order), active_status = 1`,
        widgetParams(w, id, i));
    }
    if (widgets.length) {
      await conn.query(
        `UPDATE analytics_widget SET active_status = 0 WHERE dashboard_id = ? AND active_status = 1 AND id NOT IN (${marks(widgets.length)})`,
        [id, ...widgets.map((w) => w.id)]);
    } else {
      await conn.query("UPDATE analytics_widget SET active_status = 0 WHERE dashboard_id = ? AND active_status = 1", [id]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return getDashboard(viewer, id);
}

export async function saveShares(viewer: Viewer, id: string, rawShares: unknown) {
  const shares = validateShares(rawShares);
  await loadForOwner(viewer, id, "change who it is shared with");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM analytics_dashboard_share WHERE dashboard_id = ?", [id]);
    for (const s of shares) {
      await conn.query(
        "INSERT INTO analytics_dashboard_share (id, dashboard_id, principal_type, principal_value, permission, created_by) VALUES (?,?,?,?,?,?)",
        [randomUUID(), id, s.principalType, s.principalValue, s.permission, viewer.userId]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return getDashboard(viewer, id);
}

export async function duplicateDashboard(viewer: Viewer, id: string, name?: unknown) {
  const d = await load(viewer, id);
  const widgets = await activeWidgets(id);
  const given = typeof name === "string" ? name.trim() : "";
  if (given.length > 128) throw new AnalyticsError("Dashboard name must be at most 128 characters", "INVALID_QUERY");
  const newName = given || `${String(d.row.name).slice(0, 121)} (copy)`;
  const newId = randomUUID();
  const settings = parseJson<Record<string, unknown>>(d.row.settings_json, {});
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO analytics_dashboard (id, name, description, owner_user_id, home_branch_id, home_process_id, theme, settings_json, is_template)
       VALUES (?,?,?,?,?,?,?,?,0)`,
      [newId, newName, d.row.description ?? null, viewer.userId, d.row.home_branch_id ?? null, d.row.home_process_id ?? null, d.row.theme, JSON.stringify(settings)]);
    for (const [i, w] of widgets.entries()) await conn.query(WIDGET_INSERT, widgetParams({ ...w, id: randomUUID() }, newId, i));
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return getDashboard(viewer, newId);
}

export async function deleteDashboard(viewer: Viewer, id: string): Promise<void> {
  await loadForOwner(viewer, id, "delete it");
  await db.query("UPDATE analytics_dashboard SET active_status = 0 WHERE id = ?", [id]);
}

export async function shareTargets(viewer: Viewer) {
  const scope = await scopeOptions(viewer.userId);
  return {
    roles: [...ANALYTICS_VIEWER_ROLES],
    branches: scope.branches.map((b) => ({ id: b.id, name: b.name })),
    processes: scope.processes.map((p) => ({ id: p.id, name: p.name })),
  };
}

export async function searchUsers(q: string) {
  const term = q.trim().slice(0, 60);
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.user_id, e.full_name, e.employee_code FROM employees e
      WHERE e.active_status = 1 AND e.user_id IS NOT NULL AND (e.full_name LIKE ? OR e.employee_code LIKE ?)
      ORDER BY e.full_name LIMIT 20`, [like, like]);
  return rows.map((r) => ({ userId: String(r.user_id), name: String(r.full_name ?? ""), code: String(r.employee_code ?? "") }));
}
