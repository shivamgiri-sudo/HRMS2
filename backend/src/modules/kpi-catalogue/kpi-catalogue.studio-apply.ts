/**
 * Catalogue -> Studio direction: apply the catalogue's default target to the linked Studio definitions by superseding
 * them (Studio never edits a definition in place; saveDefinition closes the old row and inserts a new one).
 * Kept apart from studio-sync because kpi-studio.service imports studio-sync, and this imports kpi-studio.service.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { saveDefinition } from "../kpi/kpi-studio.service.js";

type Row = RowDataPacket & Record<string, any>;

export async function applyCatalogueTargetToStudio(catalogueId: string, userId?: string) {
  const [cat] = await db.execute<Row[]>(`SELECT id, default_target FROM kpi_catalogue WHERE id = ? LIMIT 1`, [catalogueId]);
  const c = (cat as Row[])[0];
  if (!c) throw new Error("Catalogue KPI not found");
  if (c.default_target == null) throw new Error("This catalogue KPI has no default target to apply");
  const [defs] = await db.execute<Row[]>(
    `SELECT * FROM kpi_studio_definition WHERE catalogue_id = ? AND active_status = 1 AND (effective_to IS NULL OR effective_to >= CURDATE())`,
    [catalogueId],
  );
  const today = new Date().toISOString().slice(0, 10);
  const applied: string[] = [];
  for (const d of defs as Row[]) {
    if (d.target_value != null && Number(d.target_value) === Number(c.default_target)) continue;
    const res = await saveDefinition({
      metric_id: d.metric_id, branch_id: d.branch_id, process_id: d.process_id, designation_id: d.designation_id, employee_id: d.employee_id,
      data_source_id: d.data_source_id, grain: d.grain ?? "employee", formula_expression: d.formula_expression,
      aggregation_method: d.aggregation_method, scoring_type: d.scoring_type, target_value: Number(c.default_target),
      min_threshold: d.min_threshold, max_achievement: d.max_achievement, weightage: d.weightage,
      target_source: "catalogue", effective_from: today, notes: `Target applied from KPI catalogue (${catalogueId})`,
    } as never, userId);
    applied.push(res.id);
  }
  return { applied: applied.length, definitionIds: applied };
}
