import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { buildScopeWhereEmployees } from "../../../shared/dashboardScope.js";
import type { InsightContext, InsightTone } from "./types.js";

/** Run a read query; returns rows. Throws so the dispatcher can record the section error. */
export async function rows<T extends RowDataPacket = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await db.execute<T[]>(sql, params as never[]);
  return result;
}

export async function one<T extends RowDataPacket = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(sql, params))[0] ?? null;
}

/** NULL-safe number: DB DECIMAL/BIGINT arrive as strings. Returns null (never 0) for missing. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function pct(part: number | null, total: number | null, digits = 1): number | null {
  if (part === null || total === null || total <= 0) return null;
  const f = 10 ** digits;
  return Math.round((part / total) * 100 * f) / f;
}

/** Employee-scope WHERE fragment (branch/process/team/self clamp) for table alias `e`. */
export function empScope(ctx: InsightContext, alias = "e"): { sql: string; params: string[] } {
  const built = buildScopeWhereEmployees(ctx.scope, alias);
  return { sql: built.sql ? ` AND ${built.sql.replace(/^\s*(AND|WHERE)\s+/i, "")}` : "", params: built.params };
}

export function toneFor(value: number | null, goodAt: number, warnAt: number, higherIsBetter = true): InsightTone {
  if (value === null) return "slate";
  if (higherIsBetter) return value >= goodAt ? "green" : value >= warnAt ? "amber" : "red";
  return value <= goodAt ? "green" : value <= warnAt ? "amber" : "red";
}

export function severityFor(count: number | null, high: number, critical: number): "critical" | "high" | "normal" | "info" {
  if (count === null || count <= 0) return "info";
  if (count >= critical) return "critical";
  if (count >= high) return "high";
  return "normal";
}

/** Last `n` IST dates (oldest first), YYYY-MM-DD. */
export function lastDays(today: string, n: number): string[] {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** Roles that may see revenue / cost / margin on operational dashboards. */
const FINANCE_VIEW_ROLES = new Set([
  "super_admin", "ceo", "coo", "cfo", "finance_head", "accounts_head", "finance", "payroll_head", "operations_head", "ho_operations",
]);

export function canSeeFinanceFigures(roleKeys: readonly string[]): boolean {
  return roleKeys.some((r) => FINANCE_VIEW_ROLES.has(r));
}
