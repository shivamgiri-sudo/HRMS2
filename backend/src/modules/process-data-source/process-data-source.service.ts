import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { findMetricDef } from "../process-performance/kpi-metric-registry.js";

/**
 * Write side for process_metric_actual — the figures a client supplies because
 * HRMS has no pipeline that can measure them.
 *
 * Two things are enforced here rather than in the UI, because the UI is not a
 * security boundary:
 *
 *   1. A caller may only write to a process inside their own scope, checked
 *      through the same buildScopeWhereClause predicate the read side uses.
 *   2. A caller may only write a metric the registry defines FOR THAT PROCESS.
 *      Without this, a typo creates an orphan metric_key that no dashboard
 *      reads and nobody ever notices — the silent-failure class this codebase
 *      keeps rediscovering.
 *
 * A blank value is stored as NULL, never coerced to 0. On this dashboard a 0
 * means "measured zero" and would score the process red for a figure that was
 * simply never sent.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Who may write at all. Row scope is then checked per process, below. */
const WRITER_ROLES = [
  "super_admin", "admin", "process_manager", "operations_manager",
];

/** Is this process inside the caller's own scope? A predicate, not UI state. */
export async function assertProcessWritable(userId: string, processId: string): Promise<boolean> {
  const scope = await buildScopeWhereClause(userId, WRITER_ROLES, {
    processId: "p.id", branchId: "p.branch_id",
  }, { allowAdminBypass: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id FROM process_master p WHERE p.id = ? AND (${scope.sql}) LIMIT 1`,
    [processId, ...scope.params],
  );
  return rows.length > 0;
}

async function processCodeFor(processId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_code FROM process_master WHERE id = ? LIMIT 1`, [processId],
  );
  return rows.length ? String(rows[0].process_code) : null;
}

/**
 * Is metricKey an active, real definition in kpi_metric_master? This is the
 * SAME table Process Operations joins to resolve a metric's label/unit/
 * direction/target (process-operations.service.ts), so a value saved under a
 * code that passes this check is guaranteed to render there with a real name
 * and unit — never an orphan key nothing displays. It is also the closed set
 * of 158 already-curated metric definitions, so accepting one here reuses a
 * real, existing measurement concept; it never lets a caller invent a new
 * metric out of thin air the way a free-text key would.
 */
async function isCatalogMetric(metricKey: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM kpi_metric_master WHERE metric_code = ? AND active_status = 1 LIMIT 1`,
    [metricKey],
  );
  return rows.length > 0;
}

/** The closed set a metric-key dropdown draws from: every active, real definition. */
export interface CatalogMetric {
  metricCode: string;
  metricName: string;
  unit: string | null;
  direction: string | null;
}

export async function listMetricCatalog(): Promise<CatalogMetric[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_code, metric_name, unit, direction
       FROM kpi_metric_master
      WHERE active_status = 1
      ORDER BY metric_name ASC`,
  );
  return rows.map((r) => ({
    metricCode: String(r.metric_code),
    metricName: String(r.metric_name),
    unit: r.unit === null ? null : String(r.unit),
    direction: r.direction === null ? null : String(r.direction),
  }));
}

/**
 * Every check the write performs, minus the write.
 *
 * Extracted so a dry run and the real import cannot drift: a preview that
 * validated separately would eventually approve a row the write then rejects,
 * which is worse than no preview because it is believed.
 */
export async function assertManualMetricValueValid(input: {
  processId: string;
  metricKey: string;
  scoreDate: string;
}): Promise<void> {
  if (!ISO_DATE.test(input.scoreDate)) throw new Error("Date must be YYYY-MM-DD");

  const processCode = await processCodeFor(input.processId);
  if (!processCode) throw new Error("Unknown process");

  // Two closed sets, either satisfies it: the per-client Process KPI registry
  // (a real SLA-target sheet, scoped to the handful of processes it names —
  // rejects a key belonging to a DIFFERENT client, not just a nonsense one),
  // or kpi_metric_master's own 158 curated definitions, open to any process.
  // The second is what makes this endpoint usable for a process that has no
  // registry entry at all — supplying a real, already-defined metric by hand
  // for a process automation does not reach, not inventing a new one.
  const def = findMetricDef(processCode, input.metricKey);
  if (def) return;
  if (await isCatalogMetric(input.metricKey)) return;
  throw new Error(
    `${input.metricKey} is not a registered metric for ${processCode}, and is not an active metric in the catalog.`,
  );
}

export async function saveManualMetricValue(input: {
  userId: string;
  processId: string;
  metricKey: string;
  scoreDate: string;
  value: number | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  await assertManualMetricValueValid(input);

  await db.execute(
    `INSERT INTO process_metric_actual
       (id, process_id, metric_key, score_date, actual_value, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
     ON DUPLICATE KEY UPDATE
       actual_value         = VALUES(actual_value),
       source               = 'manual',
       source_connector_key = NULL,
       note                 = VALUES(note),
       created_by           = VALUES(created_by)`,
    [
      randomUUID(), input.processId, input.metricKey, input.scoreDate,
      input.value, input.note?.trim() || null, input.userId,
    ],
  );
  return { ok: true };
}

export interface ProcessMetricRow {
  metricKey: string;
  scoreDate: string;
  value: number | null;
  source: string;
  note: string | null;
}

export async function listProcessMetricValues(
  processId: string, from: string, to: string,
): Promise<ProcessMetricRow[]> {
  // DATE_FORMAT, not the bare column: mysql2 returns a DATE as a JS Date whose
  // toString is "Fri Aug 01 2026 ...", which has already produced one live bug
  // in this module's sibling.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m-%d') AS score_date,
            actual_value, source, note
       FROM process_metric_actual
      WHERE process_id = ? AND score_date BETWEEN ? AND ?
      ORDER BY score_date DESC, metric_key ASC
      LIMIT 500`,
    [processId, from, to],
  );
  return rows.map((r) => ({
    metricKey: String(r.metric_key),
    scoreDate: String(r.score_date),
    value: r.actual_value == null ? null : Number(r.actual_value),
    source: String(r.source),
    note: r.note == null ? null : String(r.note),
  }));
}

export interface ImportRow {
  metricKey: string;
  scoreDate: string;
  value: string | number | null;
  note?: string;
}

/**
 * Spreadsheet import. Every row is validated independently and a bad row is
 * reported by its own number rather than aborting the batch, because an ops
 * user pasting a month of figures should not lose 29 good rows to one typo.
 *
 * An empty value cell means "no reading" and is stored as NULL, for the same
 * reason single entry does it: 0 would be indistinguishable from a measured
 * zero on the dashboard.
 */
/** What one row of an upload would do, without doing it. */
export interface ImportRowOutcome {
  row: number;
  metricKey: string;
  scoreDate: string;
  /** Null means "no reading", which is a legitimate value and not an error. */
  value: number | null;
  ok: boolean;
  message?: string;
  /** Set when this row would replace a figure already stored for that day. */
  replaces?: number | null;
}

export async function importMetricRows(input: {
  userId: string;
  processId: string;
  rows: ImportRow[];
  /**
   * Validate and report without writing.
   *
   * A spreadsheet is pasted or uploaded in one go, and the failure that matters
   * is the one nobody sees: half the rows land, half are rejected for a reason
   * only visible after the fact, and the dashboard is then a blend of new and
   * stale figures that looks complete. A dry run answers "what will this do"
   * against the same registry and the same date rules the real write uses, so
   * the preview cannot pass where the write would fail.
   */
  dryRun?: boolean;
}): Promise<{
  imported: number;
  errors: Array<{ row: number; message: string }>;
  outcomes: ImportRowOutcome[];
  dryRun: boolean;
}> {
  const errors: Array<{ row: number; message: string }> = [];
  const outcomes: ImportRowOutcome[] = [];
  let imported = 0;

  // Only needed to report what a row would overwrite, so a failure to read it
  // must not stop the import. An empty map simply means no "replaces" hints.
  const existing = new Map<string, number | null>();
  if (input.dryRun) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m-%d') AS d, actual_value
           FROM process_metric_actual WHERE process_id = ?`,
        [input.processId],
      );
      for (const row of rows as any[]) {
        existing.set(`${row.metric_key}|${row.d}`, row.actual_value === null ? null : Number(row.actual_value));
      }
    } catch {
      /* hints only */
    }
  }

  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index];
    const raw = row?.value;
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    const value =
      trimmed === "" || trimmed === null || trimmed === undefined || Number.isNaN(Number(trimmed))
        ? null
        : Number(trimmed);
    const metricKey = String(row?.metricKey ?? "").trim();
    const scoreDate = String(row?.scoreDate ?? "").trim();

    try {
      if (input.dryRun) {
        await assertManualMetricValueValid({
          processId: input.processId,
          metricKey,
          scoreDate,
        });
        const key = `${metricKey}|${scoreDate}`;
        outcomes.push({
          row: index + 1,
          metricKey,
          scoreDate,
          value,
          ok: true,
          replaces: existing.has(key) ? existing.get(key) ?? null : undefined,
        });
      } else {
        await saveManualMetricValue({
          userId: input.userId,
          processId: input.processId,
          metricKey,
          scoreDate,
          value,
          note: row?.note ?? null,
        });
        outcomes.push({ row: index + 1, metricKey, scoreDate, value, ok: true });
      }
      imported++;
    } catch (err) {
      const message = (err as Error).message;
      errors.push({ row: index + 1, message });
      outcomes.push({ row: index + 1, metricKey, scoreDate, value, ok: false, message });
    }
  }
  return { imported: input.dryRun ? 0 : imported, errors, outcomes, dryRun: Boolean(input.dryRun) };
}

/**
 * Write side for process_metric_employee_actual — the deepest-level manual
 * path, for the handful of 'employee'-kind metrics verified to have a real
 * configuration but no automated per-employee feed (see
 * 1706_process_metric_employee_actual.sql for the exact verified list).
 *
 * Only meaningful for a metric whose data source is genuinely 'employee'-kind
 * — a whole-process metric has no per-analyst breakdown to fill in the first
 * place, so this rejects those rather than accept a value nobody can attribute.
 * Never checks whether an automated feed already exists for this metric: that
 * ordering is enforced entirely by getMetricAnalystBreakdown (automated rows,
 * when present, are used and this table is never even queried) so a save here
 * can never silently override real data — at worst it writes a row nothing
 * ever reads.
 */
async function assertEmployeeMetricValueValid(input: {
  processId: string;
  metricKey: string;
  employeeCode: string;
  scoreDate: string;
}): Promise<{ employeeId: string }> {
  if (!ISO_DATE.test(input.scoreDate)) throw new Error("Date must be YYYY-MM-DD");

  const [defRows] = await db.execute<RowDataPacket[]>(
    `SELECT ds.process_key_kind
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
       JOIN kpi_studio_data_source ds ON ds.id = d.data_source_id
      WHERE m.metric_code = ? AND d.process_id = ? AND d.active_status = 1
      ORDER BY (d.effective_to IS NULL) DESC, d.effective_from DESC
      LIMIT 1`,
    [input.metricKey, input.processId],
  );
  const kind = (defRows as any[])[0]?.process_key_kind ?? null;
  if (kind !== "employee") {
    throw new Error(
      `${input.metricKey} is not attributed to individual employees for this process — there is no analyst to save this value against.`,
    );
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ? AND process_id = ? LIMIT 1`,
    [input.employeeCode, input.processId],
  );
  const employeeId = (empRows as any[])[0]?.id;
  if (!employeeId) {
    throw new Error(`${input.employeeCode} is not an employee of this process.`);
  }
  return { employeeId: String(employeeId) };
}

export async function saveEmployeeMetricValue(input: {
  userId: string;
  processId: string;
  metricKey: string;
  employeeCode: string;
  scoreDate: string;
  value: number | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  const { employeeId } = await assertEmployeeMetricValueValid(input);

  await db.execute(
    `INSERT INTO process_metric_employee_actual
       (id, process_id, employee_id, metric_key, score_date, actual_value, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
     ON DUPLICATE KEY UPDATE
       actual_value = VALUES(actual_value),
       source       = 'manual',
       note         = VALUES(note),
       created_by   = VALUES(created_by)`,
    [
      randomUUID(), input.processId, employeeId, input.metricKey, input.scoreDate,
      input.value, input.note?.trim() || null, input.userId,
    ],
  );
  return { ok: true };
}

export interface EmployeeImportRow {
  employeeCode: string;
  scoreDate: string;
  value: string | number | null;
  note?: string | null;
}

export interface EmployeeImportRowOutcome {
  row: number;
  employeeCode: string;
  scoreDate: string;
  value: number | null;
  ok: boolean;
  message?: string;
}

/** Same dry-run-then-real-write shape as importMetricRows, scoped to one
 *  metric+process (the context AnalystBreakdownPanel always has), keyed by
 *  employee code — the identifier a human filling in a CSV actually has on
 *  hand, resolved to the real employee id server-side. */
export async function importEmployeeMetricRows(input: {
  userId: string;
  processId: string;
  metricKey: string;
  rows: EmployeeImportRow[];
  dryRun?: boolean;
}): Promise<{
  imported: number;
  errors: Array<{ row: number; message: string }>;
  outcomes: EmployeeImportRowOutcome[];
  dryRun: boolean;
}> {
  const errors: Array<{ row: number; message: string }> = [];
  const outcomes: EmployeeImportRowOutcome[] = [];
  let imported = 0;

  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index];
    const raw = row?.value;
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    const value =
      trimmed === "" || trimmed === null || trimmed === undefined || Number.isNaN(Number(trimmed))
        ? null
        : Number(trimmed);
    const employeeCode = String(row?.employeeCode ?? "").trim();
    const scoreDate = String(row?.scoreDate ?? "").trim();

    try {
      if (input.dryRun) {
        await assertEmployeeMetricValueValid({
          processId: input.processId, metricKey: input.metricKey, employeeCode, scoreDate,
        });
        outcomes.push({ row: index + 1, employeeCode, scoreDate, value, ok: true });
      } else {
        await saveEmployeeMetricValue({
          userId: input.userId, processId: input.processId, metricKey: input.metricKey,
          employeeCode, scoreDate, value, note: row?.note ?? null,
        });
        outcomes.push({ row: index + 1, employeeCode, scoreDate, value, ok: true });
      }
      imported++;
    } catch (err) {
      const message = (err as Error).message;
      errors.push({ row: index + 1, message });
      outcomes.push({ row: index + 1, employeeCode, scoreDate, value, ok: false, message });
    }
  }
  return { imported: input.dryRun ? 0 : imported, errors, outcomes, dryRun: Boolean(input.dryRun) };
}
