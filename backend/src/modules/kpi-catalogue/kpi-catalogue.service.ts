import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AUDIENCES } from "./kpi-catalogue.library.js";
import { SEED_PROCESSES } from "./kpi-catalogue.seed.js";
import type { CatalogueRow, CatalogueProcessDef } from "./kpi-catalogue.types.js";

const json = (v: unknown) => JSON.stringify(v ?? null);
const parseJson = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "object") return v as T;
  try { return JSON.parse(String(v)) as T; } catch { return fallback; }
};

function toRow(r: RowDataPacket): CatalogueRow {
  return {
    id: String(r.id), process_key: r.process_key, process_name: r.process_name, metric_key: r.metric_key,
    metric_name: r.metric_name, metric_code: r.metric_code ?? null, theme: r.theme, family: r.family, unit: r.unit,
    direction: r.direction, grain: r.grain, source_kind: r.source_kind, source_ref: r.source_ref ?? null,
    formula: r.formula ?? null, freshness: r.freshness, dimensions: parseJson<string[]>(r.dimensions, []),
    has_data: Boolean(r.has_data), target_source: r.target_source,
    default_target: r.default_target == null ? null : Number(r.default_target), status: r.status,
  };
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Idempotently loads kpi-catalogue.seed.ts. Human edits survive: only rows still flagged seeded=1 are refreshed. */
export async function syncSeed(processes: CatalogueProcessDef[] = SEED_PROCESSES) {
  const [scaleRows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_rating_scale WHERE is_default = 1 LIMIT 1`);
  const scaleId = (scaleRows as RowDataPacket[])[0]?.id ?? null;

  let inserted = 0, updated = 0;
  const catalogueIds: string[] = [];
  const roleRows: Array<[string, string, string, string, number]> = [];

  for (const proc of processes) {
    // Keep every row of the process (including rows mirrored from KPI Studio) on the same code list and name.
    await db.execute(`UPDATE kpi_catalogue SET process_codes = ?, process_name = ? WHERE process_key = ?`, [json(proc.processCodes), proc.processName, proc.processKey]);
    for (const kpi of proc.kpis) {
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, seeded FROM kpi_catalogue WHERE process_key = ? AND metric_key = ? LIMIT 1`,
        [proc.processKey, kpi.metricKey],
      );
      const found = (existing as RowDataPacket[])[0];
      const values = [
        proc.processName, json(proc.processCodes), kpi.name, kpi.metricCode ?? null, kpi.theme, kpi.family, kpi.unit,
        kpi.direction, kpi.grain, kpi.sourceKind, kpi.sourceRef, kpi.formula, kpi.freshness, json(kpi.dimensions),
        kpi.hasData === false ? 0 : 1, kpi.defaultTarget ?? null, scaleId, kpi.notes ?? null,
      ];
      let id: string;
      if (!found) {
        const [idRows] = await db.execute<RowDataPacket[]>(`SELECT UUID() AS id`);
        id = String((idRows as RowDataPacket[])[0].id);
        await db.execute(
          `INSERT INTO kpi_catalogue
             (id, process_key, metric_key, process_name, process_codes, metric_name, metric_code, theme, family, unit,
              direction, grain, source_kind, source_ref, formula, freshness, dimensions, has_data, default_target,
              rating_scale_id, notes, status, seeded)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1)`,
          [id, proc.processKey, kpi.metricKey, ...values],
        );
        inserted++;
      } else {
        id = String(found.id);
        if (Number(found.seeded) === 1) {
          await db.execute(
            `UPDATE kpi_catalogue SET process_name = ?, process_codes = ?, metric_name = ?, metric_code = ?, theme = ?,
                    family = ?, unit = ?, direction = ?, grain = ?, source_kind = ?, source_ref = ?, formula = ?,
                    freshness = ?, dimensions = ?, has_data = ?, default_target = ?, rating_scale_id = ?, notes = ?
              WHERE id = ?`,
            [...values, id],
          );
          updated++;
        }
      }
      if (!found || Number(found.seeded) === 1) {
        catalogueIds.push(id);
        let order = 100;
        for (const preset of kpi.audience) {
          const aud = AUDIENCES[preset];
          for (const role of aud.roles) roleRows.push([id, role, aud.department, aud.access, order]);
          order += 10;
        }
      }
    }
  }

  // Role rows of seeded KPIs are owned by the seed: replace them wholesale so removals propagate.
  await chunked(catalogueIds, 500, async (ids) => {
    await db.execute(`DELETE FROM kpi_catalogue_role WHERE catalogue_id IN (${ids.map(() => "?").join(",")})`, ids);
  });
  await chunked(roleRows, 300, async (rows) => {
    await db.execute(
      `INSERT IGNORE INTO kpi_catalogue_role (id, catalogue_id, role_key, department_key, access, display_order)
       VALUES ${rows.map(() => "(UUID(), ?, ?, ?, ?, ?)").join(",")}`,
      rows.flat(),
    );
  });
  return { processes: processes.length, inserted, updated, roleRows: roleRows.length };
}

export interface ProcessSummary {
  process_key: string; process_name: string; kpi_count: number; with_data: number; employee_grain: number; realtime: number;
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_key, MIN(process_name) AS process_name, COUNT(*) AS kpi_count, SUM(has_data) AS with_data,
            SUM(grain IN ('employee','both')) AS employee_grain, SUM(freshness = 'realtime') AS realtime
       FROM kpi_catalogue WHERE status <> 'retired' GROUP BY process_key ORDER BY (process_key = '_global'), process_name`,
  );
  return (rows as RowDataPacket[]).map((r) => ({
    process_key: r.process_key, process_name: r.process_name, kpi_count: Number(r.kpi_count), with_data: Number(r.with_data ?? 0),
    employee_grain: Number(r.employee_grain ?? 0), realtime: Number(r.realtime ?? 0),
  }));
}

export interface ProcessKpiFilters { role?: string; department?: string; theme?: string; grain?: string; includeNoData?: boolean }

export async function getProcessKpis(processKey: string, f: ProcessKpiFilters = {}) {
  const params: unknown[] = [processKey];
  let join = "";
  let where = "WHERE c.process_key = ? AND c.status <> 'retired'";
  if (f.role || f.department) {
    join = "JOIN kpi_catalogue_role r ON r.catalogue_id = c.id";
    if (f.role) { where += " AND r.role_key = ?"; params.push(f.role); }
    if (f.department) { where += " AND r.department_key = ?"; params.push(f.department); }
  }
  if (f.theme) { where += " AND c.theme = ?"; params.push(f.theme); }
  if (f.grain === "employee") where += " AND c.grain IN ('employee','both')";
  if (f.grain === "process") where += " AND c.grain IN ('process','both')";
  if (!f.includeNoData) where += " AND c.has_data = 1";
  const scoped = Boolean(f.role || f.department);
  const [rows] = await db.execute<RowDataPacket[]>(
    scoped
      ? `SELECT c.*, MIN(r.display_order) AS _ord FROM kpi_catalogue c ${join} ${where} GROUP BY c.id ORDER BY _ord, c.theme, c.metric_name`
      : `SELECT c.* FROM kpi_catalogue c ${where} ORDER BY c.theme, c.metric_name`,
    params as never[],
  );
  const kpis = (rows as RowDataPacket[]).map(toRow);
  const ids = kpis.map((x) => x.id);
  const roles = new Map<string, Array<{ role_key: string; department_key: string; access: string }>>();
  if (ids.length) {
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT catalogue_id, role_key, department_key, access FROM kpi_catalogue_role WHERE catalogue_id IN (${ids.map(() => "?").join(",")})`,
      ids as never[],
    );
    for (const r of roleRows as RowDataPacket[]) {
      const list = roles.get(String(r.catalogue_id)) ?? [];
      list.push({ role_key: r.role_key, department_key: r.department_key, access: r.access });
      roles.set(String(r.catalogue_id), list);
    }
  }
  return kpis.map((x) => ({ ...x, roles: roles.get(x.id) ?? [] }));
}

export async function listRoleDepartments() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key, department_key, COUNT(*) AS kpi_count FROM kpi_catalogue_role GROUP BY role_key, department_key ORDER BY department_key, role_key`,
  );
  return (rows as RowDataPacket[]).map((r) => ({ role_key: r.role_key, department_key: r.department_key, kpi_count: Number(r.kpi_count) }));
}

export async function listConflicts(includeResolved = false) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, conflict_type, process_key, metric_key, detail, resolved, detected_at FROM kpi_catalogue_conflict
      ${includeResolved ? "" : "WHERE resolved = 0"} ORDER BY detected_at DESC, conflict_type LIMIT 2000`,
  );
  return (rows as RowDataPacket[]).map((r) => ({ ...r, detail: parseJson<Record<string, unknown>>(r.detail, {}), resolved: Boolean(r.resolved) }));
}

export async function resolveConflict(id: string) {
  await db.execute(`UPDATE kpi_catalogue_conflict SET resolved = 1, resolved_at = NOW() WHERE id = ?`, [id]);
}
