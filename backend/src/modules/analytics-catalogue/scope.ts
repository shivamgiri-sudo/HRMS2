import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause, hasAnyRole, hasOrgWideScope, ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";
import { AnalyticsError, type Dataset, type ScopeClause } from "./analytics.types.js";

/** Roles that may read analytics at all. Row access is decided per viewer by their assignment scope, not by this list. */
export const ANALYTICS_VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager", "branch_head",
  "qa", "quality_analyst", "tq_head", "hr", "team_leader", "wfm", "branch_wfm", "ho_wfm", "finance", "management",
];

const q = (c: string) => `t.\`${assertSafeIdentifier(c, "column")}\``;
export interface Aliases { processId?: string; branchId?: string }

/** Where a dataset's rows carry process and branch, for the scope predicate. null = no row-level clause (constant/org). */
export function scopeAliases(ds: Dataset): { aliases: Aliases; joins: string[] } | null {
  const need = (v: string | null, what: string) => { if (!v) throw new AnalyticsError(`Dataset ${ds.code} needs a ${what} column for scope mode ${ds.scopeMode}`, "INVALID_DATASET"); return v; };
  switch (ds.scopeMode) {
    case "process_branch": return { aliases: { processId: q(need(ds.processColumn, "process")), branchId: q(need(ds.branchColumn, "branch")) }, joins: [] };
    case "process": return {
      aliases: { processId: q(need(ds.processColumn, "process")), branchId: "sp.branch_id" },
      joins: [`LEFT JOIN process_master sp ON sp.id = ${q(ds.processColumn!)}`],
    };
    case "branch": return { aliases: { branchId: q(need(ds.branchColumn, "branch")) }, joins: [] };
    case "employee": return {
      aliases: { processId: "se.process_id", branchId: "se.branch_id" },
      joins: [`LEFT JOIN employees se ON se.id = ${q(need(ds.employeeColumn, "employee"))}`],
    };
    default: return null;
  }
}

/** A user's own branch/process pick. Only narrows (it is ANDed onto the entitlement clause). */
export function narrowScope(a: Aliases, pick: { processIds?: string[]; branchIds?: string[] }): { sql: string; params: unknown[] } {
  const parts: string[] = []; const params: unknown[] = [];
  const add = (alias: string | undefined, ids: string[] | undefined) => {
    if (!ids?.length) return;
    if (!alias) { parts.push("1=0"); return; }
    parts.push(`${alias} IN (${ids.map(() => "?").join(",")})`); params.push(...ids.slice(0, 500));
  };
  add(a.processId, pick.processIds);
  add(a.branchId, pick.branchIds);
  if (parts.includes("1=0")) return { sql: "1=0", params: [] };
  return parts.length ? { sql: parts.join(" AND "), params } : { sql: "1=1", params: [] };
}

/**
 * Viewer can read every row in the organisation: an ORG_WIDE_EXEMPT_ROLES role (super_admin, ceo, coo, cfo, finance
 * and payroll/finance/accounts heads, heads of any department) or an assignment scope of "all" held by one.
 * admin is branch-scoped like hr (owner ruling 2026-10-01).
 */
export async function isOrgWide(userId: string): Promise<boolean> {
  if (await hasAnyRole(userId, ...ORG_WIDE_EXEMPT_ROLES)) return true;
  return hasOrgWideScope(userId, ANALYTICS_VIEWER_ROLES);
}

/** Processes the viewer can read (same predicate as every other surface). */
export async function readableProcessIds(userId: string): Promise<Set<string>> {
  const c = await buildScopeWhereClause(userId, ANALYTICS_VIEWER_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT p.id FROM process_master p WHERE ${c.sql}`, c.params as never[]);
  return new Set(rows.map((r) => String(r.id)));
}

/** The full row clause for this viewer on this dataset, including their optional narrowing. */
export async function buildDatasetScope(userId: string, ds: Dataset, pick: { processIds?: string[]; branchIds?: string[] } = {}): Promise<ScopeClause> {
  const plan = scopeAliases(ds);
  if (!plan) {
    if (ds.scopeMode === "org") {
      if (!(await isOrgWide(userId))) throw new AnalyticsError(`${ds.name} is organisation-wide and needs organisation-wide access`, "FORBIDDEN");
      return { sql: "1=1", params: [], joins: [] };
    }
    if (!ds.scopeProcessId || !(await readableProcessIds(userId)).has(ds.scopeProcessId)) {
      throw new AnalyticsError(`${ds.name} belongs to a process outside your access`, "FORBIDDEN");
    }
    return { sql: "1=1", params: [], joins: [] };
  }
  const ent = await buildScopeWhereClause(userId, ANALYTICS_VIEWER_ROLES, plan.aliases, { allowAdminBypass: true, allowCeoAllRead: true });
  const nar = narrowScope(plan.aliases, pick);
  return { sql: `(${ent.sql}) AND (${nar.sql})`, params: [...ent.params, ...nar.params], joins: plan.joins };
}
