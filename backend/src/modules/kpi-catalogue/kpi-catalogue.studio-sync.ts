/**
 * KPI Studio -> catalogue mirror. Every Studio definition is linked to a catalogue row (kpi_studio_definition.catalogue_id),
 * creating a published 'studio' row when the catalogue does not know the metric for that process yet. Called after
 * saveDefinition commits; failures are logged and never block the Studio save.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AUDIENCES } from "./kpi-catalogue.library.js";
import type { AudiencePreset } from "./kpi-catalogue.types.js";

type Row = RowDataPacket & Record<string, any>;

export interface StudioProcessCtx { process_code?: string | null; process_name?: string | null }

/** Pure: stable catalogue process key for a Studio scope. */
export function processKeyFor(existingKey: string | null, ctx: StudioProcessCtx): { key: string; name: string; codes: string[] } {
  if (existingKey) return { key: existingKey, name: ctx.process_name ?? existingKey, codes: ctx.process_code ? [ctx.process_code] : [] };
  if (ctx.process_code) return { key: String(ctx.process_code).toLowerCase(), name: ctx.process_name ?? ctx.process_code, codes: [ctx.process_code] };
  return { key: "_global", name: "All processes (operations, workforce, training)", codes: [] };
}

export function defaultAudienceFor(grain: string): AudiencePreset[] {
  const leads: AudiencePreset[] = ["team_leader", "process_manager", "branch", "head_office", "admin"];
  return grain === "process" ? leads : ["agent", ...leads];
}

export async function linkDefinitionToCatalogue(definitionId: string): Promise<string | null> {
  const [defRows] = await db.execute<Row[]>(
    `SELECT d.*, m.metric_code, m.metric_name, m.unit AS m_unit, m.direction AS m_direction, m.family AS m_family,
            pm.process_code, pm.process_name
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
       LEFT JOIN process_master pm ON pm.id = d.process_id
      WHERE d.id = ? LIMIT 1`,
    [definitionId],
  );
  const d = (defRows as Row[])[0];
  if (!d) return null;

  let existingKey: string | null = null;
  if (d.process_code) {
    const [k] = await db.execute<Row[]>(
      `SELECT process_key FROM kpi_catalogue WHERE JSON_CONTAINS(process_codes, JSON_QUOTE(?)) LIMIT 1`, [d.process_code],
    );
    existingKey = (k as Row[])[0]?.process_key ?? null;
  }
  const proc = processKeyFor(existingKey, { process_code: d.process_code as string | null, process_name: d.process_name as string | null });
  const metricKey = String(d.metric_code).toLowerCase();

  const [found] = await db.execute<Row[]>(
    `SELECT id, studio_definition_id FROM kpi_catalogue
      WHERE process_key = ? AND (metric_code = ? OR metric_key = ?) ORDER BY (metric_code = ?) DESC LIMIT 1`,
    [proc.key, d.metric_code, metricKey, d.metric_code],
  );
  let catalogueId = (found as Row[])[0]?.id as string | undefined;

  if (!catalogueId) {
    const [idRows] = await db.execute<Row[]>(`SELECT UUID() AS id`);
    catalogueId = String((idRows as Row[])[0].id);
    const grain = String(d.grain ?? "employee") === "process" ? "process" : "employee";
    await db.execute(
      `INSERT INTO kpi_catalogue
         (id, process_key, process_name, process_codes, metric_key, metric_name, metric_code, theme, family, unit, direction,
          grain, source_kind, source_ref, formula, freshness, dimensions, has_data, target_source, default_target,
          rating_scale_id, status, studio_definition_id, seeded)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'studio', ?, ?, ?, ?, 'studio', 'KPI Studio definition', ?, 'daily', ?, 1, ?, ?,
               (SELECT id FROM kpi_rating_scale WHERE is_default = 1 LIMIT 1), 'published', ?, 0)`,
      [catalogueId, proc.key, proc.name, JSON.stringify(proc.codes), metricKey, d.metric_name, d.metric_code,
       d.m_family ?? "rate", d.m_unit ?? "count", d.m_direction ?? "higher_is_better", grain,
       d.formula_expression ?? "reads the metric's existing actuals", JSON.stringify(["date", grain === "process" ? "process" : "agent"]),
       d.target_source ?? "studio", d.target_value ?? null, definitionId],
    );
    let order = 100;
    const roleRows: Array<[string, string, string, string, number]> = [];
    for (const preset of defaultAudienceFor(grain)) {
      const aud = AUDIENCES[preset];
      for (const role of aud.roles) roleRows.push([catalogueId, role, aud.department, aud.access, order]);
      order += 10;
    }
    await db.execute(
      `INSERT IGNORE INTO kpi_catalogue_role (id, catalogue_id, role_key, department_key, access, display_order)
       VALUES ${roleRows.map(() => "(UUID(), ?, ?, ?, ?, ?)").join(",")}`,
      roleRows.flat() as never[],
    );
  } else if (!(found as Row[])[0].studio_definition_id) {
    await db.execute(`UPDATE kpi_catalogue SET studio_definition_id = ? WHERE id = ?`, [definitionId, catalogueId]);
  }

  await db.execute(`UPDATE kpi_studio_definition SET catalogue_id = ? WHERE id = ?`, [catalogueId, definitionId]);
  return catalogueId;
}

/** Links every active, unlinked Studio definition (used by the sync endpoint and backfills). */
export async function linkAllUnlinkedDefinitions(): Promise<{ linked: number; failed: number }> {
  let linked = 0, failed = 0;
  try {
    const [rows] = await db.execute<Row[]>(`SELECT id FROM kpi_studio_definition WHERE active_status = 1 AND catalogue_id IS NULL`);
    for (const r of rows as Row[]) {
      try { if (await linkDefinitionToCatalogue(String(r.id))) linked++; } catch { failed++; }
    }
  } catch (err) {
    console.warn("[kpi-catalogue] studio backfill skipped:", err instanceof Error ? err.message : String(err));
  }
  return { linked, failed };
}
