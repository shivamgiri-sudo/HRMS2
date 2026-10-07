import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereEmployees } from "../../shared/dashboardScope.js";
import { memo } from "./ops-command.cache.js";
import {
  NONE_ID,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";

/** One row per employee the caller may see (row scope enforced in SQL). Everything else joins to this in memory. */
export interface DimEmp {
  id: string;
  code: string;
  name: string;
  branch: string | null;
  process: string | null;
  lob: string | null;
  mgr: string | null;
  doj: string | null;
  exit: string | null;
  leaving: string | null;
  active: number;
  status: string;
}

export interface DimView {
  emps: DimEmp[];
  byId: Map<string, DimEmp>;
  byCode: Map<string, DimEmp>;
}

function toView(emps: DimEmp[]): DimView {
  return {
    emps,
    byId: new Map(emps.map((e) => [e.id, e])),
    byCode: new Map(emps.map((e) => [e.code, e])),
  };
}

/** Scope-only employee load, cached per scope. User filters are applied afterwards in memory (narrowing only). */
async function loadScoped(ctx: OpsCtx): Promise<DimEmp[]> {
  const key = `dim|${JSON.stringify({ l: ctx.scope.level, b: ctx.scope.branchIds, p: ctx.scope.processIds, e: ctx.scope.employeeIds })}`;
  return memo(key, async () => {
    const sc = buildScopeWhereEmployees(ctx.scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code AS code, e.full_name AS name, e.branch_id AS branch, e.process_id AS process,
              e.lob_id AS lob, e.reporting_manager_id AS mgr,
              DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') AS doj, DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') AS exit_d,
              DATE_FORMAT(e.date_of_leaving,'%Y-%m-%d') AS leaving, e.active_status AS active, e.employment_status AS status
         FROM employees e WHERE ${sc.sql}`,
      sc.params,
    );
    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code ?? ""),
      name: String(r.name ?? "").trim(),
      branch: r.branch ?? null,
      process: r.process ?? null,
      lob: r.lob ?? null,
      mgr: r.mgr ?? null,
      doj: r.doj ?? null,
      exit: r.exit_d ?? null,
      leaving: r.leaving ?? null,
      active: Number(r.active ?? 0),
      status: String(r.status ?? ""),
    }));
  });
}

const match = (val: string | null, want: string | undefined) =>
  want === undefined ? true : want === NONE_ID ? val === null : val === want;

export async function loadView(
  ctx: OpsCtx,
  applyFilters = true,
): Promise<DimView> {
  const all = await loadScoped(ctx);
  if (!applyFilters) return toView(all);
  const { branchId, processId, lobId, managerId } = ctx.f;
  if (!branchId && !processId && !lobId && !managerId) return toView(all);
  return toView(
    all.filter(
      (e) =>
        match(e.branch, branchId) &&
        match(e.process, processId) &&
        match(e.lob, lobId) &&
        match(e.mgr, managerId),
    ),
  );
}

export function groupKey(e: DimEmp, dim: OpsDimension): string {
  switch (dim) {
    case "branch":
      return e.branch ?? NONE_ID;
    case "process":
      return e.process ?? NONE_ID;
    case "lob":
      return e.lob ?? NONE_ID;
    case "manager":
      return e.mgr ?? NONE_ID;
    case "employee":
      return e.id;
    default:
      return "all";
  }
}

export const exitDateOf = (e: DimEmp): string | null => e.exit ?? e.leaving;

/** On the payroll on `date` — identical rule to the SQL used elsewhere (legacy rows carry exit in either column). */
export function isActiveAt(e: DimEmp, date: string): boolean {
  if (!e.doj || e.doj > date || e.status === "not_joined") return false;
  const x = exitDateOf(e);
  return (e.active === 1 && x === null) || (x !== null && x > date);
}

export const exitedIn = (e: DimEmp, from: string, to: string): boolean => {
  const x = exitDateOf(e);
  return x !== null && x >= from && x <= to;
};
