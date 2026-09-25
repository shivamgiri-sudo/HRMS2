import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import {
  DEFAULT_ALERT_THRESHOLDS,
  aonDisplayLabel,
  listAlerts,
  readFilters,
  tlAmFilter,
} from "./onfido-process-dashboard.service.js";
import {
  buildOutlierRows,
  buildTargetTile,
  recentWeeks,
  type ActionStatus,
  type ActionSummary,
  type OutlierRow,
  type TargetTile,
} from "./onfido-outlier.pure.js";

export interface OutlierFilters {
  from?: string;
  to?: string;
  tlName?: string;
  amName?: string;
  analystEmail?: string;
}

export interface OutlierReport {
  from: string;
  to: string;
  /** Latest day in the selected range that has audit data - shown so users know how fresh the numbers are. */
  dataAsOf: string | null;
  targets: TargetTile[];
  outliers: OutlierRow[];
}

const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

async function loadActionSummaries(
  from: string,
  to: string,
): Promise<ActionSummary[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, analyst_email, metric, status, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, owner_name
       FROM onfido_outlier_action
      WHERE status <> 'closed' OR (period_to >= ? AND period_from <= ?)`,
    [from, to],
  );
  return rows.map((r) => ({
    id: String(r.id),
    analystEmail: String(r.analyst_email),
    metric: String(r.metric),
    status: r.status as ActionStatus,
    dueDate: (r.due_date as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
  }));
}

/** Achievement for the tiles, read straight from the same audit tables the alerts use. */
async function loadTargetTiles(
  filters: OutlierFilters,
  from: string,
  to: string,
): Promise<{ tiles: TargetTile[]; dataAsOf: string | null }> {
  const pool = await getOnfidoPool();
  const { clause, params } = tlAmFilter(
    filters.tlName,
    filters.amName,
    filters.analystEmail,
  );
  const [[audit]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS audits, COALESCE(SUM(has_error), 0) AS errors, DATE_FORMAT(MAX(report_date), '%Y-%m-%d') AS asOf
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause}`,
    [from, to, ...params],
  );
  const [[poa]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(error_count), 0) AS errors, COALESCE(SUM(no_error_count), 0) AS clean
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [from, to, ...params],
  );
  const auditTotal = num(audit?.audits);
  const poaTotal = num(poa?.errors) + num(poa?.clean);
  return {
    dataAsOf: (audit?.asOf as string | null) ?? null,
    tiles: [
      buildTargetTile(
        "overall_error",
        "DOC Overall Error %",
        auditTotal > 0 ? (num(audit?.errors) / auditTotal) * 100 : null,
        DEFAULT_ALERT_THRESHOLDS.overallErrorPct,
        "percent",
        true,
      ),
      buildTargetTile(
        "poa_error",
        "POA Error %",
        poaTotal > 0 ? (num(poa?.errors) / poaTotal) * 100 : null,
        DEFAULT_ALERT_THRESHOLDS.poaErrorPct,
        "percent",
        true,
      ),
    ],
  };
}

/** Latest tenure (AON) bucket per analyst from the roster feed, looked back 120 days from the range end. */
async function loadTenure(emails: string[], to: string): Promise<Map<string, string>> {
  const tenure = new Map<string, string>();
  if (emails.length === 0) return tenure;
  const pool = await getOnfidoPool();
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT LOWER(analyst_email) AS a,
            SUBSTRING_INDEX(GROUP_CONCAT(aon_bucket ORDER BY work_date DESC SEPARATOR '|'), '|', 1) AS bucket
       FROM onfido_agent_daily_raw
      WHERE work_date BETWEEN DATE_SUB(?, INTERVAL 120 DAY) AND ? AND LOWER(analyst_email) IN (?)
        AND aon_bucket IS NOT NULL AND TRIM(aon_bucket) <> ''
      GROUP BY a`,
    [to, to, unique],
  );
  for (const r of rows) {
    const raw = String(r.bucket ?? '').trim();
    if (raw) tenure.set(String(r.a), aonDisplayLabel(raw) ?? raw);
  }
  return tenure;
}

export async function getOutlierReport(
  filters: OutlierFilters,
): Promise<OutlierReport> {
  const f = readFilters(filters);
  const scope = {
    tlName: filters.tlName,
    amName: filters.amName,
    analystEmail: filters.analystEmail,
  };
  const weeks = recentWeeks(f.to);
  const [current, priorAlerts, actions, tiles] = await Promise.all([
    listAlerts({ from: f.from, to: f.to, ...scope }),
    Promise.all(
      weeks.map((p) => listAlerts({ from: p.from, to: p.to, ...scope })),
    ),
    loadActionSummaries(f.from, f.to),
    loadTargetTiles(filters, f.from, f.to),
  ]);
  const outliers = buildOutlierRows(current, priorAlerts, actions);
  const tenure = await loadTenure(outliers.map((o) => o.analystEmail), f.to).catch((err: unknown) => {
    console.error("[onfido] tenure lookup failed:", err);
    return new Map<string, string>();
  });
  for (const row of outliers) row.tenureBucket = tenure.get(row.analystEmail.toLowerCase()) ?? null;
  return {
    from: f.from,
    to: f.to,
    dataAsOf: tiles.dataAsOf,
    targets: tiles.tiles,
    outliers,
  };
}

// ── actions ──────────────────────────────────────────────────────────────────

export interface OutlierAction {
  id: string;
  analystEmail: string;
  analystName: string | null;
  tlName: string | null;
  amName: string | null;
  metric: string;
  periodFrom: string;
  periodTo: string;
  observedValue: number | null;
  targetValue: number | null;
  actionTaken: string | null;
  rca: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: ActionStatus;
  closureRemarks: string | null;
  closedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  overdue: boolean;
}

const ACTION_COLUMNS = `id, analyst_email, analyst_name, tl_name, am_name, metric,
  DATE_FORMAT(period_from, '%Y-%m-%d') AS period_from, DATE_FORMAT(period_to, '%Y-%m-%d') AS period_to,
  observed_value, target_value, action_taken, rca, owner_name, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
  status, closure_remarks, DATE_FORMAT(closed_at, '%Y-%m-%d %H:%i') AS closed_at, created_by_name,
  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at`;

function toAction(r: RowDataPacket, today: string): OutlierAction {
  const dueDate = (r.due_date as string | null) ?? null;
  const status = r.status as ActionStatus;
  return {
    id: String(r.id),
    analystEmail: String(r.analyst_email),
    analystName: (r.analyst_name as string | null) ?? null,
    tlName: (r.tl_name as string | null) ?? null,
    amName: (r.am_name as string | null) ?? null,
    metric: String(r.metric),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    observedValue: r.observed_value === null ? null : Number(r.observed_value),
    targetValue: r.target_value === null ? null : Number(r.target_value),
    actionTaken: (r.action_taken as string | null) ?? null,
    rca: (r.rca as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    dueDate,
    status,
    closureRemarks: (r.closure_remarks as string | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: String(r.created_at),
    overdue: status !== "closed" && dueDate !== null && dueDate < today,
  };
}

const todayIst = (): string =>
  new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function listActions(filters: {
  status?: string;
  analystEmail?: string;
  tlName?: string;
  amName?: string;
}): Promise<OutlierAction[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (
    filters.status &&
    ["open", "in_progress", "closed"].includes(filters.status)
  ) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.analystEmail) {
    where.push("analyst_email = ?");
    params.push(filters.analystEmail);
  }
  if (filters.tlName) {
    where.push("tl_name = ?");
    params.push(filters.tlName);
  }
  if (filters.amName) {
    where.push("am_name = ?");
    params.push(filters.amName);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${ACTION_COLUMNS} FROM onfido_outlier_action ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (status = 'closed'), due_date IS NULL, due_date, created_at DESC LIMIT 500`,
    params,
  );
  const today = todayIst();
  return rows.map((r) => toAction(r, today));
}

export interface NewActionInput {
  analystEmail: string;
  analystName?: string | null;
  tlName?: string | null;
  amName?: string | null;
  metric: string;
  periodFrom: string;
  periodTo: string;
  observedValue?: number | null;
  targetValue?: number | null;
  actionTaken?: string | null;
  rca?: string | null;
  ownerName?: string | null;
  dueDate?: string | null;
}

export interface Actor {
  id: string;
  name: string;
}

export async function createAction(
  input: NewActionInput,
  actor: Actor,
): Promise<OutlierAction> {
  const [insert] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const id = String(insert[0].id);
  await db.execute(
    `INSERT INTO onfido_outlier_action
       (id, analyst_email, analyst_name, tl_name, am_name, metric, period_from, period_to, observed_value, target_value,
        action_taken, rca, owner_name, due_date, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.analystEmail,
      input.analystName ?? null,
      input.tlName ?? null,
      input.amName ?? null,
      input.metric,
      input.periodFrom,
      input.periodTo,
      input.observedValue ?? null,
      input.targetValue ?? null,
      input.actionTaken ?? null,
      input.rca ?? null,
      input.ownerName ?? null,
      input.dueDate ?? null,
      actor.id,
      actor.name,
    ],
  );
  return getAction(id);
}

async function getAction(id: string): Promise<OutlierAction> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${ACTION_COLUMNS} FROM onfido_outlier_action WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0)
    throw Object.assign(new Error("Action not found"), { statusCode: 404 });
  return toAction(rows[0], todayIst());
}

export interface ActionUpdate {
  actionTaken?: string | null;
  rca?: string | null;
  ownerName?: string | null;
  dueDate?: string | null;
  status?: ActionStatus;
  closureRemarks?: string | null;
}

const UPDATABLE: Array<[keyof ActionUpdate, string]> = [
  ["actionTaken", "action_taken"],
  ["rca", "rca"],
  ["ownerName", "owner_name"],
  ["dueDate", "due_date"],
  ["closureRemarks", "closure_remarks"],
];

export async function updateAction(
  id: string,
  patch: ActionUpdate,
): Promise<OutlierAction> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of UPDATABLE) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(patch[key] ?? null);
    }
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
    sets.push(
      patch.status === "closed"
        ? "closed_at = COALESCE(closed_at, NOW())"
        : "closed_at = NULL",
    );
  }
  if (sets.length === 0) return getAction(id);
  await db.execute(
    `UPDATE onfido_outlier_action SET ${sets.join(", ")} WHERE id = ?`,
    [...params, id],
  );
  return getAction(id);
}

export type { OutlierRow, TargetTile };
