/**
 * Portal data masking utilities.
 * Strip PII from individual employee records and aggregate row-level data
 * into group-level summaries safe for external client consumption.
 */

const PII_FIELDS = [
  "employee_code",
  "full_name",
  "first_name",
  "last_name",
  "email",
  "mobile",
  "pan_number",
  "aadhaar_number",
  "bank_account",
  "date_of_birth",
  "user_id",
] as const;

/**
 * Remove all PII fields from a single employee record.
 * Returns a shallow copy — the original record is not mutated.
 */
export function maskPortalEmployee(
  record: Record<string, unknown>
): Record<string, unknown> {
  const masked = { ...record };
  for (const field of PII_FIELDS) {
    delete masked[field];
  }
  return masked;
}

type AggFn = "avg" | "sum" | "count" | "min" | "max";

interface AggregateSpec {
  field: string;
  fn: AggFn;
}

/**
 * Group rows by a key field and compute aggregate statistics per group.
 * Individual row data is never exposed — only group-level summaries are returned.
 *
 * @param rows      Source rows (e.g. per-employee score records)
 * @param groupBy   Field name to group on (e.g. "department", "process_id")
 * @param aggregates List of { field, fn } descriptors to compute
 * @returns         One summary object per distinct group value
 */
export function aggregateForPortal<T extends Record<string, unknown>>(
  rows: T[],
  groupBy: string,
  aggregates: AggregateSpec[]
): Record<string, unknown>[] {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = String(row[groupBy] ?? "unknown");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const result: Record<string, unknown> = {
      [groupBy]: key,
      count: items.length,
    };

    for (const agg of aggregates) {
      const values = items
        .map((i) => Number(i[agg.field] ?? 0))
        .filter((v) => !isNaN(v));

      switch (agg.fn) {
        case "avg":
          result[`${agg.field}_avg`] = values.length
            ? values.reduce((a, b) => a + b, 0) / values.length
            : 0;
          break;
        case "sum":
          result[`${agg.field}_sum`] = values.reduce((a, b) => a + b, 0);
          break;
        case "count":
          result[`${agg.field}_count`] = values.length;
          break;
        case "min":
          result[`${agg.field}_min`] = values.length ? Math.min(...values) : 0;
          break;
        case "max":
          result[`${agg.field}_max`] = values.length ? Math.max(...values) : 0;
          break;
      }
    }

    return result;
  });
}
