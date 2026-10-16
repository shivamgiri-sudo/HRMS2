import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";
import { ownCompanyBranchSql } from "../../shared/ownCompanyCostCentre.js";

export interface HeadBranch { branchId: string; branchCode: string; branchName: string }
export interface HeadScope {
  branches: HeadBranch[];
  viaHomeFallback: boolean;
  orgWide: boolean;
  emptyReason: string | null;
}

const EMPTY_REASON = "No MAS Call Net branch in your scope";

async function loadMasBranches(branchIds: string[] | null): Promise<HeadBranch[]> {
  const where = [
    "b.active_status = 1",
    "b.close_date IS NULL",
    ownCompanyBranchSql("b"),
  ];
  const params: unknown[] = [];
  if (branchIds) {
    where.unshift("b.id IN (?)");
    params.push(branchIds);
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT b.id, b.branch_code, b.branch_name FROM branch_master b WHERE ${where.join(" AND ")} ORDER BY b.branch_name`,
    params,
  );
  return rows.map((r) => ({
    branchId: String(r.id),
    branchCode: String(r.branch_code ?? ""),
    branchName: String(r.branch_name ?? ""),
  }));
}

/** Every active MAS Call Net branch (used by the cache warmer; not scope-checked). */
export function listAllMasBranches(): Promise<HeadBranch[]> {
  return loadMasBranches(null);
}

/** Branches a Branch Head sees: MAS Call Net, active, not closed. Never identified by name. */
export async function resolveHeadBranches(userId: string): Promise<HeadScope> {
  let scope: Awaited<ReturnType<typeof resolveDashboardScope>>;
  try {
    scope = await resolveDashboardScope(userId, "branch_head");
  } catch (err) {
    if ((err as Error)?.name === "DashboardScopeConfigurationError") {
      return { branches: [], viaHomeFallback: false, orgWide: false, emptyReason: "Your role has no branch scope configured" };
    }
    throw err;
  }
  const orgWide = scope.level === "ORG_ALL";
  let ids: string[] | null = orgWide ? null : [...scope.branchIds];
  let viaHomeFallback = false;

  if (!orgWide && (ids as string[]).length === 0) {
    const [emp] = await db.query<RowDataPacket[]>(
      "SELECT branch_id FROM employees WHERE user_id = ? AND branch_id IS NOT NULL LIMIT 1",
      [userId],
    );
    const home = emp[0]?.branch_id ? String(emp[0].branch_id) : null;
    ids = home ? [home] : [];
    viaHomeFallback = true;
  }

  const branches = ids && ids.length === 0 ? [] : await loadMasBranches(ids);
  return {
    branches,
    viaHomeFallback: viaHomeFallback && branches.length > 0,
    orgWide,
    emptyReason: branches.length === 0 ? EMPTY_REASON : null,
  };
}
