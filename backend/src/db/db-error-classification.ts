/**
 * Classifies database errors that indicate a BUG rather than a blip.
 *
 * Lives in its own module, separate from mysql.ts, for two reasons: it has no dependency on
 * the connection pool, and the global test setup mocks mysql.js — so anything exported from
 * there is unavailable to a unit test.
 *
 * Why this exists at all: roughly 90 call sites in this codebase write
 * `.catch(() => [[{ cnt: 0 }]])` or `.catch(() => [[]])` around a query. When the query has
 * a wrong column or names a missing table, the caller silently substitutes a zero or an
 * empty list, and the failure is indistinguishable from "no rows matched". That is how a
 * report that never returned a row, an endpoint that never worked, and an HR dashboard tile
 * stuck at a confident zero all survived unnoticed in production.
 */

/**
 * Schema and logic error codes. Retrying cannot help any of these — the SQL or the schema is
 * wrong.
 *
 * Deliberately EXCLUDES transient and connection-pressure codes (PROTOCOL_CONNECTION_LOST,
 * ECONNRESET, ETIMEDOUT, ER_CON_COUNT_ERROR and friends): those are already retried by
 * withTransientRetry, and logging them would flood the log on every deploy blip.
 */
const SCHEMA_OR_LOGIC_DB_CODES: ReadonlySet<string> = new Set([
  "ER_BAD_FIELD_ERROR",
  "ER_NO_SUCH_TABLE",
  "ER_BAD_TABLE_ERROR",
  "ER_CANT_AGGREGATE_2COLLATIONS",
  "ER_CANT_AGGREGATE_3COLLATIONS",
  "ER_CANT_AGGREGATE_NCOLLATIONS",
  "ER_PARSE_ERROR",
  "ER_DUP_ENTRY",
  "ER_DATA_TOO_LONG",
  "ER_WRONG_ARGUMENTS",
  "ER_WRONG_VALUE_COUNT_ON_ROW",
  "ER_TRUNCATED_WRONG_VALUE",
  "ER_NO_REFERENCED_ROW_2",
  "ER_ROW_IS_REFERENCED_2",
  "ER_CHECK_CONSTRAINT_VIOLATED",
]);

export function isSchemaOrLogicDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && SCHEMA_OR_LOGIC_DB_CODES.has(code);
}

/**
 * One-line summary for the log: code, server message, and the SQL that produced it.
 *
 * Falls back through name/errno/message rather than rendering a bare "UNKNOWN: ". The earlier
 * version read only code, sqlMessage and sql, so anything that is not a mysql2 protocol error
 * — a pool exhaustion ("Queue limit reached"), an abort, a plain Error, an AggregateError
 * whose message is the empty string — was logged with every detail discarded.
 *
 * That string is what the circuit-breaker trip line carries. On 2026-08-12 the workers logged
 * 5,045 breaker events that blocked report generation, report email delivery and performance
 * ingestion, and every one attributed the cause to "Tripped by: UNKNOWN: ". The one line
 * written to explain an outage explained nothing, which is worse than no line at all because
 * it looks like an answer.
 */
export function describeDbError(error: unknown): string {
  if (error === null || error === undefined) return "UNKNOWN: (no error object)";
  if (typeof error !== "object") return `UNKNOWN: ${String(error).slice(0, 200)}`;

  const e = error as { code?: string; errno?: number; name?: string; message?: string; sqlMessage?: string; sql?: string };
  const sql = (e.sql ?? "").replace(/\s+/g, " ").slice(0, 300);

  // Most specific identifier available, then the most specific description available.
  const label = e.code ?? e.name ?? "UNKNOWN";
  const detail = (e.sqlMessage || e.message || "").slice(0, 200);
  const errno = typeof e.errno === "number" ? ` errno=${e.errno}` : "";

  const described = `${label}:${errno}${detail ? ` ${detail}` : ""}`;
  // Never hand back a label with nothing behind it — that is the shape that hid the outage.
  const meaningful = detail || errno || (e.code ? " (no detail)" : "");
  return `${meaningful ? described : `${label}: (no detail available)`}${sql ? ` | sql: ${sql}` : ""}`;
}
