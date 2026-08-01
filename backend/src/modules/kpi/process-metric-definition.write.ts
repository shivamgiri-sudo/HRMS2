import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Writing per-process metric definitions.
 *
 * process_metric_definition (migration 1047) had readers and no writer, so the
 * per-process metrics this whole effort was about could not actually be entered.
 * The same gap the QA form had: schema, resolver, tests, and no way to create a
 * row.
 *
 * Definitions are effective-dated and superseded rather than edited. An audit or
 * a score computed last month was measured against the definition in force then,
 * and rewriting it in place would change what those numbers claim to mean —
 * exactly the defect kpi_master_config carried until 1051.
 */

export class MetricDefinitionError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export type MetricDefinitionInput = {
  processId: string;
  /** Set for a canonical metric; null for a process-local one. */
  metricId?: string | null;
  /** Set for a process-local metric; null when metricId is given. */
  localCode?: string | null;
  /** What THIS process calls it. The reason the table exists. */
  displayName: string;
  /** Required for process-local metrics — a canonical one inherits them. */
  unit?: string | null;
  direction?: "higher_is_better" | "lower_is_better" | null;
  weightage?: number;
  isFatal?: boolean;
  displayOrder?: number;
  effectiveFrom: string;
  createdBy?: string | null;
};

function validate(input: MetricDefinitionInput): void {
  const hasCanonical = Boolean(input.metricId);
  const hasLocal = Boolean(input.localCode?.trim());

  if (hasCanonical === hasLocal) {
    // The CHECK constraint enforces this too, but a 400 naming the problem is
    // more use than a driver error naming a constraint.
    throw new MetricDefinitionError(
      "Give either a canonical metric or a local code, not both and not neither",
    );
  }
  if (!input.displayName?.trim()) {
    throw new MetricDefinitionError("displayName is required — it is what this process calls the metric");
  }
  if (hasLocal && (!input.unit?.trim() || !input.direction)) {
    // A local metric has no canonical row to inherit from, and "62" means
    // nothing without knowing it is a percentage and that higher is better.
    throw new MetricDefinitionError(
      "A process-local metric needs its own unit and direction — there is no canonical metric to inherit them from",
    );
  }
  if (input.weightage !== undefined && (input.weightage < 0 || input.weightage > 100)) {
    throw new MetricDefinitionError("weightage must be between 0 and 100");
  }
}

/**
 * Add a definition, closing any current one for the same metric on that process.
 *
 * Closing rather than deleting: the superseded row keeps describing the periods
 * it governed, which is what makes a historical score still legible.
 */
export async function upsertProcessMetricDefinition(
  input: MetricDefinitionInput,
): Promise<{ id: string; supersededId: string | null }> {
  validate(input);

  const scopeKey = input.metricId ?? input.localCode!.trim();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Find whatever is currently open for this process + metric.
    const [openRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, effective_from FROM process_metric_definition
        WHERE process_id = ?
          AND COALESCE(metric_id, local_code) = ?
          AND active_status = 1
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC LIMIT 1`,
      [input.processId, scopeKey, input.effectiveFrom],
    );
    const current = openRows[0];

    if (current && String(current.effective_from).slice(0, 10) === input.effectiveFrom) {
      // Same start date would collide on the unique key. Rejecting is safer than
      // overwriting: the caller may be re-submitting a form by accident.
      throw new MetricDefinitionError(
        "A definition already starts on that date for this metric — pick a later effective date",
        409,
      );
    }

    let supersededId: string | null = null;
    if (current) {
      supersededId = String(current.id);
      // Closed the day before the new one opens, so the two never overlap and a
      // score on any date resolves to exactly one definition.
      await conn.execute(
        `UPDATE process_metric_definition
            SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
          WHERE id = ?`,
        [input.effectiveFrom, supersededId],
      );
    }

    const id = randomUUID();
    await conn.execute(
      `INSERT INTO process_metric_definition
         (id, process_id, metric_id, local_code, display_name, unit, direction,
          display_order, weightage, is_fatal, effective_from, active_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id, input.processId, input.metricId ?? null,
        input.localCode?.trim() ?? null, input.displayName.trim(),
        input.unit?.trim() ?? null, input.direction ?? null,
        input.displayOrder ?? 100, input.weightage ?? 100,
        input.isFatal ? 1 : 0, input.effectiveFrom, input.createdBy ?? null,
      ],
    );

    await conn.commit();
    return { id, supersededId };
  } catch (err) {
    // Closing the old without opening the new would leave the process measuring
    // nothing for that metric.
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Retire a definition from a date, without replacing it.
 *
 * Deactivating rather than deleting, for the same reason: the row still explains
 * scores recorded while it applied.
 */
export async function retireProcessMetricDefinition(
  id: string,
  effectiveTo: string,
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT effective_from FROM process_metric_definition WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) throw new MetricDefinitionError("Definition not found", 404);

  if (String(rows[0].effective_from).slice(0, 10) > effectiveTo) {
    throw new MetricDefinitionError("A definition cannot end before it starts");
  }

  await db.execute(
    `UPDATE process_metric_definition SET effective_to = ?, active_status = 0 WHERE id = ?`,
    [effectiveTo, id],
  );
}
