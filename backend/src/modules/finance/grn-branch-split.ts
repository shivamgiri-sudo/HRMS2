import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { ownCompanyCostCentreSql } from "../../shared/ownCompanyCostCentre.js";
import { refuse } from "../process-pnl/finance-error.js";
import { assertFinanceRecordBranch, type FinanceBranchScope } from "./finance-access-scope.js";
import { isHeadOfficeBranch } from "./grn-head-office-bypass.js";

/**
 * Head Office GRN split across branches (owner requirement 2026-10-07).
 *
 * Head Office pays a bill, the Finance Head splits its cost across branches, and each branch's
 * share lands on THAT BRANCH'S BACK OFFICE (BO) cost centre, consumes THAT BRANCH'S own budget and
 * shows in THAT BRANCH'S P&L. Head Office keeps the vendor payable and any share it holds itself.
 *
 * This module holds the two things that must never be guessed: who may raise such a GRN, and which
 * cost centre is a branch's Back Office.
 */

type Executor = Pick<PoolConnection, "execute"> | typeof db;

/** Off by default: enabled only after the branch BO audit (backend/scripts/audit-branch-bo-cost-centres.ts). */
export function isBranchSplitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.GRN_BRANCH_SPLIT_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Who may split a Head Office GRN across branches: the Finance Head (or a super admin, who can do
 * everything and is how this is tested), on a VENDOR GRN raised at Head Office. Imprest GRNs settle
 * from one manager's float and are never split across branches.
 */
export async function assertBranchSplitAllowed(input: {
  grnBranchId: string | null | undefined;
  grnType: string;
  actorRole: string;
  actorRoles?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  if (!isBranchSplitEnabled(input.env)) {
    throw refuse(403, "BRANCH_SPLIT_DISABLED", "Splitting a Head Office GRN across branches is not enabled yet");
  }
  const roles = [input.actorRole, ...(input.actorRoles ?? [])].filter(Boolean).map((r) => r.toLowerCase());
  if (!roles.includes("finance_head") && !roles.includes("super_admin")) {
    throw refuse(403, "BRANCH_SPLIT_ROLE", "Only the Finance Head can split a Head Office GRN across branches");
  }
  if (input.grnType !== "vendor") {
    throw refuse(400, "BRANCH_SPLIT_VENDOR_ONLY", "Only vendor GRNs can be split across branches");
  }
  if (!(await isHeadOfficeBranch(input.grnBranchId))) {
    throw refuse(403, "BRANCH_SPLIT_HEAD_OFFICE_ONLY", "Only a GRN raised at Head Office can be split across branches");
  }
}

export interface BackOfficeCandidate {
  id: string;
  code: string;
  name: string | null;
  /** Declared Back Office by type (cc_type / cost_center_type / process_type), not just by its code. */
  byType: boolean;
  /** Code has a /BO/ segment. */
  byCode: boolean;
  /** Billed to a client: such a cost centre earns revenue, so it is not the branch's overhead pool. */
  clientBilled: boolean;
}

const BO_TYPE_WORDS = new Set(["backoffice", "back office", "back_office", "bo"]);

/** Pure classification of one cost_centre_master row. Exported for tests. */
export function classifyBackOffice(row: Record<string, unknown>): BackOfficeCandidate {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const code = String(row.cost_centre_code ?? "");
  const byType =
    BO_TYPE_WORDS.has(norm(row.cc_type)) ||
    BO_TYPE_WORDS.has(norm(row.cost_center_type)) ||
    norm(row.process_type) === "back_office";
  const byCode = /\/BO\//i.test(code);
  const clientBilled =
    Number(row.revenue_flag) === 1 ||
    Number(row.billing_flag) === 1 ||
    Boolean(String(row.billing_client_name ?? "").trim());
  return {
    id: String(row.id),
    code,
    name: row.cost_centre_name ? String(row.cost_centre_name) : null,
    byType,
    byCode,
    clientBilled,
  };
}

export type BackOfficePick =
  | { ok: true; costCentre: BackOfficeCandidate; candidates: BackOfficeCandidate[] }
  | { ok: false; reason: "NONE" | "AMBIGUOUS"; candidates: BackOfficeCandidate[] };

/**
 * Which candidate is the branch's Back Office, or why none can be chosen safely.
 *
 * Tier 1: declared Back Office by type and not billed to a client.
 * Tier 2 (only when tier 1 is empty): a /BO/ code, not billed to a client.
 * Exactly one in the winning tier is the answer. Zero or several is NEVER guessed — a branch can
 * hold several /BO/ codes (a client cost centre such as NOIDA-2/576 beside the BO pool /577), and
 * putting a branch's overhead on the wrong one would misstate two P&Ls. The caller then asks the
 * Finance Head to pick explicitly from `candidates`.
 */
export function pickBackOffice(candidates: BackOfficeCandidate[]): BackOfficePick {
  const tier1 = candidates.filter((c) => c.byType && !c.clientBilled);
  const tier2 = candidates.filter((c) => c.byCode && !c.clientBilled);
  const winners = tier1.length ? tier1 : tier2;
  if (winners.length === 1) return { ok: true, costCentre: winners[0], candidates };
  return { ok: false, reason: winners.length === 0 ? "NONE" : "AMBIGUOUS", candidates };
}

/** Every active cost centre of the branch that could be its Back Office. */
export async function listBackOfficeCandidates(branchId: string, executor: Executor = db): Promise<BackOfficeCandidate[]> {
  const [rows] = (await executor.execute(
    `SELECT ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, ccm.cc_type, ccm.cost_center_type,
            ccm.process_type, ccm.revenue_flag, ccm.billing_flag, ccm.billing_client_name
       FROM cost_centre_master ccm
      WHERE ccm.branch_id = ? AND ccm.active_status = 1 AND ccm.status = 'active'
        AND ${ownCompanyCostCentreSql("ccm")}
        AND (ccm.close_date IS NULL OR ccm.close_date > CURDATE())
        AND (ccm.go_live_date IS NULL OR ccm.go_live_date <= CURDATE())
        AND (
              LOWER(TRIM(COALESCE(ccm.cc_type, ''))) IN ('backoffice', 'back office', 'back_office', 'bo')
           OR LOWER(TRIM(COALESCE(ccm.cost_center_type, ''))) IN ('backoffice', 'back office', 'back_office', 'bo')
           OR UPPER(TRIM(COALESCE(ccm.process_type, ''))) = 'BACK_OFFICE'
           OR UPPER(ccm.cost_centre_code) LIKE '%/BO/%'
        )
      ORDER BY ccm.cost_centre_code`,
    [branchId],
  )) as [RowDataPacket[], unknown];
  return rows.map((row) => classifyBackOffice(row));
}

/**
 * The cost centre a branch's share lands on. With `requestedCostCentreId` (the Finance Head's
 * explicit pick) it must be one of the branch's candidates; without it, exactly one must exist.
 */
export async function resolveBranchBackOffice(
  branchId: string,
  requestedCostCentreId: string | null | undefined,
  branchLabel: string,
  executor: Executor = db,
): Promise<BackOfficeCandidate> {
  const candidates = await listBackOfficeCandidates(branchId, executor);
  const requested = String(requestedCostCentreId ?? "").trim();
  if (requested) {
    const picked = candidates.find((c) => c.id === requested);
    if (!picked) {
      throw refuse(409, "BO_COST_CENTRE_INVALID",
        `${branchLabel}: the chosen cost centre is not one of this branch's Back Office cost centres`);
    }
    return picked;
  }
  const pick = pickBackOffice(candidates);
  if (pick.ok) return pick.costCentre;
  if (pick.reason === "NONE") {
    throw refuse(409, "BO_COST_CENTRE_MISSING",
      `${branchLabel} has no active Back Office cost centre — set one up before splitting a GRN to this branch`);
  }
  throw Object.assign(
    refuse(409, "BO_COST_CENTRE_AMBIGUOUS",
      `${branchLabel} has more than one possible Back Office cost centre (${candidates.map((c) => c.code).join(", ")}) — pick one`),
    { candidates: candidates.map((c) => ({ id: c.id, code: c.code, name: c.name })) },
  );
}

/**
 * List filter: GRNs the caller may SEE. Their own branch's GRNs, plus Head Office GRNs that hold a
 * share on their branch — an allocation row whose branch differs from the GRN header's. That test
 * needs no new column (every ordinary allocation row carries the header's branch), so a list query
 * built on it works before and after migration 2121.
 */
export function grnBranchVisibility(scope: FinanceBranchScope, alias = "g"): { sql: string; params: string[] } {
  if (scope.mode === "all") return { sql: "1=1", params: [] };
  const marks = scope.branchIds.map(() => "?").join(", ");
  return {
    sql: `(${alias}.branch_id IN (${marks}) OR EXISTS (
      SELECT 1 FROM grn_cost_allocation sa
       WHERE sa.grn_request_id = ${alias}.id AND sa.branch_id <> ${alias}.branch_id AND sa.branch_id IN (${marks})))`,
    params: [...scope.branchIds, ...scope.branchIds],
  };
}

/**
 * READ access to one GRN: its own branch, or a branch that bears a share of it. Returns the
 * caller's branch ids that bear a share when access came only through a share (so the response
 * can be limited to those shares), or null when the caller owns the GRN's branch. Writes never use
 * this: a share's branch can read the bill, only Head Office changes it.
 */
export async function assertGrnReadAccess(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  grnId: string;
  headerBranchId: string | null | undefined;
}): Promise<string[] | null> {
  const who = { userId: input.userId, primaryRole: input.primaryRole, userRoles: input.userRoles };
  try {
    await assertFinanceRecordBranch({ ...who, recordBranchId: input.headerBranchId });
    return null;
  } catch (headerError) {
    const [rows] = (await db.execute(
      `SELECT DISTINCT branch_id FROM grn_cost_allocation WHERE grn_request_id = ? AND branch_id <> ?`,
      [input.grnId, String(input.headerBranchId ?? "")],
    )) as [RowDataPacket[], unknown];
    const mine: string[] = [];
    for (const row of rows) {
      try {
        await assertFinanceRecordBranch({ ...who, recordBranchId: String(row.branch_id) });
        mine.push(String(row.branch_id));
      } catch {
        /* not this caller's branch */
      }
    }
    if (!mine.length) throw headerError;
    return mine;
  }
}

export interface BranchSplitBranchOption {
  branchId: string;
  branchName: string;
  isHeadOffice: boolean;
  /** ok = exactly one Back Office cost centre; none / ambiguous = this branch cannot receive a share yet. */
  status: "ok" | "none" | "ambiguous";
  resolved: { id: string; code: string; name: string | null } | null;
  candidates: Array<{ id: string; code: string; name: string | null }>;
}

/**
 * What the GRN form needs to offer "split across branches": whether the feature is on, and for
 * every trading branch its Back Office cost centre or the reason none can be chosen. The same list
 * is the pre-launch audit: every branch that is not "ok" must be fixed (or explicitly picked)
 * before the flag is switched on.
 */
export async function getBranchSplitOptions(env: NodeJS.ProcessEnv = process.env): Promise<{
  enabled: boolean;
  branches: BranchSplitBranchOption[];
}> {
  const [branchRows] = (await db.execute(
    `SELECT DISTINCT bm.id, bm.branch_name
       FROM branch_master bm
       JOIN cost_centre_master ccm ON ccm.branch_id = bm.id
      WHERE ccm.active_status = 1 AND ccm.status = 'active' AND ${ownCompanyCostCentreSql("ccm")}
      ORDER BY bm.branch_name`,
  )) as [RowDataPacket[], unknown];
  const branches: BranchSplitBranchOption[] = [];
  for (const row of branchRows) {
    const branchId = String(row.id);
    const candidates = await listBackOfficeCandidates(branchId);
    const pick = pickBackOffice(candidates);
    const brief = (c: BackOfficeCandidate) => ({ id: c.id, code: c.code, name: c.name });
    branches.push({
      branchId,
      branchName: String(row.branch_name),
      isHeadOffice: await isHeadOfficeBranch(branchId),
      status: pick.ok ? "ok" : pick.reason === "NONE" ? "none" : "ambiguous",
      resolved: pick.ok ? brief(pick.costCentre) : null,
      candidates: candidates.filter((c) => !c.clientBilled).map(brief),
    });
  }
  return { enabled: isBranchSplitEnabled(env), branches };
}
