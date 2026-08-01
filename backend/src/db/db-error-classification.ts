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

/** One-line summary for the log: code, server message, and the SQL that produced it. */
export function describeDbError(error: unknown): string {
  const e = (error ?? {}) as { code?: string; sqlMessage?: string; sql?: string };
  const sql = (e.sql ?? "").replace(/\s+/g, " ").slice(0, 300);
  return `${e.code ?? "UNKNOWN"}: ${(e.sqlMessage ?? "").slice(0, 200)}${sql ? ` | sql: ${sql}` : ""}`;
}
