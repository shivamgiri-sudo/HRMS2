/**
 * Reconciliation / drift check. Compares the catalogue with the six older KPI models and KPI Studio and records every
 * disagreement in kpi_catalogue_conflict. Each check is isolated: a table that does not exist on this database
 * skips that check instead of failing the report.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ConflictInput } from "./kpi-catalogue.types.js";

type Row = RowDataPacket & Record<string, any>;

/** Pure: catalogue row vs kpi_metric_master row for the same metric_code. */
export function compareMetricMeta(
  cat: { process_key: string; metric_key: string; metric_code: string; unit: string; direction: string },
  master: { unit?: string | null; direction?: string | null },
): ConflictInput[] {
  const out: ConflictInput[] = [];
  if (master.direction && master.direction !== cat.direction) {
    out.push({ type: "direction_mismatch", processKey: cat.process_key, metricKey: cat.metric_key,
      detail: { metric_code: cat.metric_code, catalogue: cat.direction, kpi_metric_master: master.direction } });
  }
  const norm = (u?: string | null) => String(u ?? "").toLowerCase().replace(/^pct$|^%$/, "percent");
  if (master.unit && norm(master.unit) !== norm(cat.unit)) {
    out.push({ type: "unit_mismatch", processKey: cat.process_key, metricKey: cat.metric_key,
      detail: { metric_code: cat.metric_code, catalogue: cat.unit, kpi_metric_master: master.unit } });
  }
  return out;
}

/** Pure: do rating bands differ from the default scale? */
export function bandsDiffer(a: Array<{ label: string; min: number }>, b: Array<{ label: string; min: number }>): boolean {
  const key = (x: Array<{ label: string; min: number }>) => x.map((i) => `${i.label}:${Number(i.min)}`).sort().join("|");
  return key(a) !== key(b);
}

async function safe<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch (err) {
    console.warn(`[kpi-catalogue drift] ${label} skipped:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function computeDrift(): Promise<ConflictInput[]> {
  const found: ConflictInput[] = [];

  // 1. direction / unit vs kpi_metric_master for catalogue rows that name a metric_code.
  found.push(...await safe("metric master", async () => {
    const [rows] = await db.execute<Row[]>(
      `SELECT c.process_key, c.metric_key, c.metric_code, c.unit, c.direction, m.unit AS m_unit, m.direction AS m_dir
         FROM kpi_catalogue c JOIN kpi_metric_master m ON m.metric_code = c.metric_code
        WHERE c.metric_code IS NOT NULL AND c.status <> 'retired' AND m.active_status = 1`,
    );
    return (rows as Row[]).flatMap((r) => compareMetricMeta(
      { process_key: r.process_key, metric_key: r.metric_key, metric_code: r.metric_code, unit: r.unit, direction: r.direction },
      { unit: r.m_unit, direction: r.m_dir },
    ));
  }));

  // 2. catalogue metric_code with no active master row, or a master metric nothing in the catalogue references.
  found.push(...await safe("code coverage", async () => {
    const [missing] = await db.execute<Row[]>(
      `SELECT DISTINCT c.process_key, c.metric_key, c.metric_code FROM kpi_catalogue c
        WHERE c.metric_code IS NOT NULL AND c.status <> 'retired'
          AND NOT EXISTS (SELECT 1 FROM kpi_metric_master m WHERE m.metric_code = c.metric_code AND m.active_status = 1)`,
    );
    const [legacy] = await db.execute<Row[]>(
      `SELECT m.metric_code, m.metric_name FROM kpi_metric_master m
        WHERE m.active_status = 1 AND NOT EXISTS (SELECT 1 FROM kpi_catalogue c WHERE c.metric_code = m.metric_code)`,
    );
    return [
      ...(missing as Row[]).map((r): ConflictInput => ({ type: "catalogue_without_feed", processKey: r.process_key, metricKey: r.metric_key,
        detail: { metric_code: r.metric_code, reason: "no active kpi_metric_master row for this metric_code" } })),
      ...(legacy as Row[]).map((r): ConflictInput => ({ type: "legacy_only_metric", metricKey: r.metric_code,
        detail: { metric_name: r.metric_name, reason: "active in kpi_metric_master but not in the catalogue" } })),
    ];
  }));

  // 3. Studio definitions not linked to a catalogue row.
  found.push(...await safe("studio link", async () => {
    const [rows] = await db.execute<Row[]>(
      `SELECT d.id, m.metric_code, m.metric_name, d.process_id FROM kpi_studio_definition d
         JOIN kpi_metric_master m ON m.id = d.metric_id
        WHERE d.active_status = 1 AND d.catalogue_id IS NULL`,
    );
    return (rows as Row[]).map((r): ConflictInput => ({ type: "studio_unlinked", metricKey: r.metric_code,
      detail: { definition_id: r.id, metric_name: r.metric_name, process_id: r.process_id } }));
  }));

  // 4. Weights that do not sum to 100 per org unit (kpi_master_config defaults every row to 100).
  found.push(...await safe("weights", async () => {
    const [rows] = await db.execute<Row[]>(
      `SELECT org_unit_type, org_unit_id, COUNT(*) AS n, SUM(weightage) AS total FROM kpi_master_config
        WHERE is_active = 1 GROUP BY org_unit_type, org_unit_id HAVING ABS(SUM(weightage) - 100) > 0.01 LIMIT 500`,
    );
    return (rows as Row[]).map((r): ConflictInput => ({ type: "weight_not_normalised",
      detail: { org_unit_type: r.org_unit_type, org_unit_id: r.org_unit_id, metrics: Number(r.n), total_weight: Number(r.total) } }));
  }));

  // 5. Target in kpi_process_config differing from the catalogue default for the same process + metric_code.
  found.push(...await safe("targets", async () => {
    const [rows] = await db.execute<Row[]>(
      `SELECT c.process_key, c.metric_key, c.metric_code, c.default_target, pc.target_value, pm.process_code
         FROM kpi_catalogue c
         JOIN process_master pm ON JSON_CONTAINS(c.process_codes, JSON_QUOTE(pm.process_code))
         JOIN kpi_metric_master m ON m.metric_code = c.metric_code
         JOIN kpi_process_config pc ON pc.process_id = pm.id AND pc.metric_id = m.id
        WHERE c.default_target IS NOT NULL AND pc.target_value IS NOT NULL
          AND ABS(pc.target_value - c.default_target) > 0.0001 LIMIT 500`,
    );
    return (rows as Row[]).map((r): ConflictInput => ({ type: "target_mismatch", processKey: r.process_key, metricKey: r.metric_key,
      detail: { process_code: r.process_code, catalogue_default: Number(r.default_target), kpi_process_config: Number(r.target_value) } }));
  }));

  // 6. Two rating scales in use.
  found.push(...await safe("rating scales", async () => {
    const [legacy] = await db.execute<Row[]>(`SELECT rating_label AS label, min_score_pct AS min FROM kpi_rating_config WHERE process_id IS NULL`);
    const [std] = await db.execute<Row[]>(
      `SELECT b.band_label AS label, b.min_score AS min FROM kpi_rating_scale_band b
         JOIN kpi_rating_scale s ON s.id = b.scale_id WHERE s.is_default = 1`,
    );
    if (!(legacy as Row[]).length) return [];
    const a = (legacy as Row[]).map((r) => ({ label: String(r.label), min: Number(r.min) }));
    const b = (std as Row[]).map((r) => ({ label: String(r.label), min: Number(r.min) }));
    return bandsDiffer(a, b) ? [{ type: "rating_scale_mismatch", detail: { kpi_rating_config: a, catalogue_default: b,
      also: "kpi-score-engine ratingForScore uses Outstanding/Exceeds/Meets/Needs Improvement at 95/85/75/60" } } as ConflictInput] : [];
  }));

  return found;
}

/** Replaces every open conflict with a fresh computation; resolved rows are kept as history. */
export async function recordDrift(): Promise<{ total: number; byType: Record<string, number> }> {
  const found = await computeDrift();
  await db.execute(`DELETE FROM kpi_catalogue_conflict WHERE resolved = 0`);
  for (let i = 0; i < found.length; i += 200) {
    const chunk = found.slice(i, i + 200);
    await db.execute(
      `INSERT INTO kpi_catalogue_conflict (id, conflict_type, process_key, metric_key, detail)
       VALUES ${chunk.map(() => "(UUID(), ?, ?, ?, ?)").join(",")}`,
      chunk.flatMap((c) => [c.type, c.processKey ?? null, c.metricKey ?? null, JSON.stringify(c.detail)]) as never[],
    );
  }
  const byType: Record<string, number> = {};
  for (const c of found) byType[c.type] = (byType[c.type] ?? 0) + 1;
  return { total: found.length, byType };
}
