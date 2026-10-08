import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { budgetExGstSql } from "./pnl-ex-gst.js";

/**
 * THE ONE BUDGET READER for every P&L surface (owner rule, 2026-09-23).
 *
 * Two stores hold budget, with no sync between them in either direction:
 *   - HRMS (mas_hrms app tables): finance_budget_header / finance_budget_line (+ _allocation), the
 *     governed budget workspace (branch-budget.service.ts) that GRN submission is gated against.
 *   - The db_bill mirror: finance_budget_snapshot / finance_budget_line_snapshot, refreshed nightly
 *     by db-bill-finance-sync.worker.ts. Older months exist only here.
 *
 * RULE, decided per (branch, month): when HRMS has an ACTIVE finance_budget_header for that branch
 * and period, the budget comes from HRMS ONLY; the mirror is read only for branch + month
 * combinations with no active HRMS budget. Never both for the same branch and month, so nothing is
 * counted twice.
 *
 * "ACTIVE" = finance_budget_header.status = 'active' — the conservative definition:
 *   - it is the only status budget-headroom-gate.service.ts lets a GRN draw against, and the one
 *     Live P&L already read (pnl-reconciliation readBudgets);
 *   - migration 1523 moved every 'finance_head_approved' header to 'active' when the accounts-head
 *     stage was dropped, and 'accounts_head_approved' is never written any more, so neither is a
 *     live "approved" state today (bpo-pnl.service.ts getBudgetMeta still lists them defensively);
 *   - 'closed' is a SUPERSEDED budget (branch-budget deleteOrSupersede) whose replacement is a new
 *     header for the same branch + period — counting it would double the budget;
 *   - draft / submitted / branch_head_approved / rejected / revision_required are not sanctioned.
 * A branch whose HRMS budget is still in draft therefore keeps its mirror figure until it goes
 * active, rather than showing nothing.
 *
 * Branch identity: the mirror carries a branch NAME, and branch_master holds duplicate spellings
 * (three Head Office rows). The per-branch decision is made on the normalised name
 * (UPPER(TRIM(branch_name))) so an HRMS header on any spelling suppresses the mirror for all of
 * them; mirror money is keyed to MIN(id) of that name, exactly as before.
 *
 * Amount basis per source:
 *   - HRMS: EX-GST base_amount (owner rule 2026-09-24: "Revenue and GRN — all components — must be
 *     NON-GST amounts"; GRN actuals moved to amount_without_tax in the same change, so budget and
 *     GRN stay on one basis). Until 2026-09-24 this read pnl_cost_amount, which carried the
 *     non-recoverable GST slice. A branch-level line's allocation rows are read at THEIR own
 *     base_amount. pnl-ex-gst.ts's budgetExGstSql guards a legacy row with no base recorded. A line
 *     planned at branch level (cost_centre_id IS NULL) that has allocation rows is expanded into
 *     those rows; one without allocations stays a branch-level entry with no cost centre. Approved
 *     HRMS top-ups (finance_budget_topup_request) are applied INTO the lines by budget-topup.service,
 *     so there is no separate top-up entry on this side.
 *   - Mirror: finance_budget_line_snapshot.amount on 'CostCenter' lines of approved headers — read
 *     AS IS. GST BASIS UNVERIFIED: db_bill's budget line carries a single amount with no tax split,
 *     so whether it is ex-GST cannot be derived from the mirror; it is not adjusted here.
 *     (active_status = 1 AND is_rejected = 0; 'Particular' rows repeat the same money), plus one
 *     header-level 'top_up' entry per budget carrying reopen_additional_amount, which names no cost
 *     centre (see budget-top-up-attribution.ts for how a scope may claim one).
 *
 * WHY LIVE P&L's THREE BUDGET FIGURES DIFFER (explained 2026-09-24; e.g. Aug 2026: raw HRMS line
 * total Rs 98.61L ex-GST over 5 active headers, branchBudget Rs 98.12L, allocatedBudget Rs 96.37L).
 * Nothing is lost to rounding: a branch-level line's allocation rows are produced by
 * allocatePoolAmount's largest-remainder split and sum EXACTLY to the line (branch-budget-
 * allocation.service computeLineAllocations), so expanding them changes no total. The gaps are
 * scope, decided in pnl-reconciliation.service getPnlReconciliation, not in this reader:
 *   1. allocatedBudget = SUM of budgetByCostCentreId over the ROWS Live P&L shows. It therefore
 *      leaves out
 *        a. branch-level lines with NO allocation rows (costCentreId null — computeLineAllocations
 *           found no eligible own-company cost centre in the branch): budget of the branch, of no
 *           cost centre. They ARE in branchBudget. By design: never invent a cost-centre split.
 *        b. lines on a cost centre that is not a row: not own-company (OWN_COMPANY_SQL), outside a
 *           branch/process filter, or CLOSED TODAY with no revenue / GRN / payroll in the period
 *           (b-closed was fixed 2026-09-24: hasPeriodActivity now also keeps a cost centre that
 *           has budget for the period, so a budgeted-but-idle cost centre closed after the month
 *           keeps that month's budget).
 *        c. mirror header top-ups (never carry a cost centre).
 *   2. branchBudget = SUM of budgetByBranchId over the branches that have at least one Live P&L
 *      cost-centre row (branchMap is built from the rows). A header whose branch has no row — all
 *      its cost centres non-own-company/closed-and-idle, or the header sits on a duplicate
 *      branch_master spelling (three Head Office ids) its cost centres do not use — is left out,
 *      as is a header with no branch_id ("" key).
 * So raw - branchBudget = active-header budget on branches with no Live P&L row, and
 * branchBudget - allocatedBudget = (1a) + (1b) + (1c) within the shown branches (a line on a cost
 * centre of ANOTHER branch moves between branches but stays in allocatedBudget).
 */

export type BudgetSource = "hrms" | "mirror";

export interface BudgetEntry {
  source: BudgetSource;
  /** HRMS header id, or the mirror's bill_source_id of the budget header. */
  budgetRef: string;
  /** Stable per-entry id for drilldown rows. */
  entryRef: string;
  kind: "line" | "top_up";
  /** HRMS: header.branch_id. Mirror: MIN(branch_master.id) for the normalised branch name. */
  branchId: string | null;
  branchName: string | null;
  /** Null for a mirror top-up and for an HRMS branch-level line with no allocation rows. */
  costCentreId: string | null;
  costCentreCode: string | null;
  label: string;
  amount: number;
}

const PERIOD_RE = /^\d{4}-\d{2}$/;
const n = (v: unknown): number => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
export const normBranchName = (name: unknown): string => String(name ?? "").trim().toUpperCase();
export const normCode = (code: unknown): string => String(code ?? "").trim().toUpperCase();

/** The header status that makes an HRMS budget the source for its branch + month. See banner. */
export const ACTIVE_HRMS_BUDGET_STATUS = "active";

async function readHrmsEntries(period: string): Promise<{ entries: BudgetEntry[]; branchNames: Set<string>; branchIds: Set<string> }> {
  const out = { entries: [] as BudgetEntry[], branchNames: new Set<string>(), branchIds: new Set<string>() };
  if (!(await tableExists("finance_budget_header"))) return out;

  // Which branches have an active HRMS budget this month — even one with no lines yet, because the
  // rule is "an active header exists", not "it has money".
  const [headers] = await db.execute<RowDataPacket[]>(
    `SELECT h.id, h.branch_id, bm.branch_name
       FROM finance_budget_header h
       LEFT JOIN branch_master bm ON bm.id = h.branch_id
      WHERE h.period_code = ? AND h.status = '${ACTIVE_HRMS_BUDGET_STATUS}'`,
    [period],
  );
  for (const h of headers) {
    if (h.branch_id) out.branchIds.add(String(h.branch_id));
    if (h.branch_name) out.branchNames.add(normBranchName(h.branch_name));
  }
  if (headers.length === 0 || !(await tableExists("finance_budget_line"))) return out;

  const hasAllocation = await tableExists("finance_budget_line_allocation");
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT h.id AS budget_id, h.branch_id, bm.branch_name,
            l.id AS line_id, ${hasAllocation ? "a.id" : "NULL"} AS allocation_id,
            l.head, l.sub_head, l.item_name,
            ${hasAllocation ? "COALESCE(a.cost_centre_id, l.cost_centre_id)" : "l.cost_centre_id"} AS cost_centre_id,
            ccm.cost_centre_code,
            ${hasAllocation
              ? `CASE WHEN a.id IS NOT NULL THEN ${budgetExGstSql("a")} ELSE ${budgetExGstSql("l")} END`
              : budgetExGstSql("l")} AS amount
       FROM finance_budget_header h
       JOIN finance_budget_line l ON l.budget_id = h.id
       ${hasAllocation ? "LEFT JOIN finance_budget_line_allocation a ON a.budget_line_id = l.id AND l.cost_centre_id IS NULL" : ""}
       LEFT JOIN branch_master bm ON bm.id = h.branch_id
       LEFT JOIN cost_centre_master ccm
              ON ccm.id = ${hasAllocation ? "COALESCE(a.cost_centre_id, l.cost_centre_id)" : "l.cost_centre_id"}
      WHERE h.period_code = ? AND h.status = '${ACTIVE_HRMS_BUDGET_STATUS}'`,
    [period],
  );
  for (const r of lines) {
    const label = [r.head, r.sub_head, r.item_name].map((v) => (v ? String(v).trim() : "")).filter(Boolean).join(" / ");
    out.entries.push({
      source: "hrms",
      budgetRef: String(r.budget_id),
      entryRef: `hrms-${r.line_id}${r.allocation_id ? `-${r.allocation_id}` : ""}`,
      kind: "line",
      branchId: r.branch_id ? String(r.branch_id) : null,
      branchName: r.branch_name ? String(r.branch_name) : null,
      costCentreId: r.cost_centre_id ? String(r.cost_centre_id) : null,
      costCentreCode: r.cost_centre_code ? String(r.cost_centre_code) : null,
      label: label || "Budget line",
      amount: n(r.amount),
    });
  }
  return out;
}

const BRANCH_BY_NAME_SQL = `(SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
                               FROM branch_master GROUP BY UPPER(TRIM(branch_name)))`;
const CC_BY_CODE_SQL = `(SELECT MIN(id) AS id, cost_centre_code AS code
                           FROM cost_centre_master GROUP BY cost_centre_code)`;

async function readMirrorEntries(period: string): Promise<BudgetEntry[]> {
  const out: BudgetEntry[] = [];
  if (!(await tableExists("finance_budget_snapshot")) || !(await tableExists("finance_budget_line_snapshot"))) return out;
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT l.bill_source_id, l.budget_source_id, l.expense_type_name, l.amount,
            b.branch_name, bm.id AS branch_id, cc.id AS cost_centre_id
       FROM finance_budget_line_snapshot l
       JOIN finance_budget_snapshot b
         ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
       LEFT JOIN ${BRANCH_BY_NAME_SQL} bm
              ON bm.nm COLLATE utf8mb4_unicode_ci = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
       LEFT JOIN ${CC_BY_CODE_SQL} cc
              ON cc.code COLLATE utf8mb4_unicode_ci = l.expense_type_name COLLATE utf8mb4_unicode_ci
      WHERE l.period_code = ? AND l.expense_type = 'CostCenter'
        AND b.active_status = 1 AND b.is_rejected = 0`,
    [period],
  );
  for (const r of lines) {
    out.push({
      source: "mirror",
      budgetRef: String(r.budget_source_id),
      entryRef: `bud-${r.bill_source_id}`,
      kind: "line",
      branchId: r.branch_id ? String(r.branch_id) : null,
      branchName: r.branch_name ? String(r.branch_name) : null,
      costCentreId: r.cost_centre_id ? String(r.cost_centre_id) : null,
      costCentreCode: r.expense_type_name ? String(r.expense_type_name) : null,
      label: r.expense_type_name ? String(r.expense_type_name) : "Budget line",
      amount: n(r.amount),
    });
  }
  // Header-level top-ups: one row per budget, so they cannot be joined through the lines without
  // multiplying by the line count.
  const [topUps] = await db.execute<RowDataPacket[]>(
    `SELECT b.bill_source_id, b.reopen_additional_amount, b.branch_name, bm.id AS branch_id
       FROM finance_budget_snapshot b
       LEFT JOIN ${BRANCH_BY_NAME_SQL} bm
              ON bm.nm COLLATE utf8mb4_unicode_ci = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
      WHERE b.period_code = ? AND b.active_status = 1 AND b.is_rejected = 0
        AND b.reopen_additional_amount <> 0`,
    [period],
  );
  for (const r of topUps) {
    out.push({
      source: "mirror",
      budgetRef: String(r.bill_source_id),
      entryRef: `topup-${r.bill_source_id}`,
      kind: "top_up",
      branchId: r.branch_id ? String(r.branch_id) : null,
      branchName: r.branch_name ? String(r.branch_name) : null,
      costCentreId: null,
      costCentreCode: null,
      label: "Sanctioned top-up",
      amount: n(r.reopen_additional_amount),
    });
  }
  return out;
}

/**
 * Every budget entry for one month, HRMS first and the mirror only for branches HRMS has no active
 * budget for. See the banner for the rule; every P&L budget figure is a sum over this list.
 */
export async function readBudgetEntries(period: string): Promise<BudgetEntry[]> {
  if (!PERIOD_RE.test(period)) return [];
  const hrms = await readHrmsEntries(period);
  const mirror = await readMirrorEntries(period);
  return [
    ...hrms.entries,
    ...mirror.filter((e) => !mirrorSuppressed(e, hrms.branchNames, hrms.branchIds)),
  ];
}

/** A mirror entry is dropped when its branch (by normalised name, or by resolved id) has an active
 *  HRMS budget for the month. Exported for the unit test. */
export function mirrorSuppressed(e: BudgetEntry, hrmsBranchNames: Set<string>, hrmsBranchIds: Set<string>): boolean {
  if (e.source !== "mirror") return false;
  if (e.branchName && hrmsBranchNames.has(normBranchName(e.branchName))) return true;
  return Boolean(e.branchId && hrmsBranchIds.has(e.branchId));
}

/** Budget per branch id ("" = the entry resolved to no branch). */
export function budgetByBranchId(entries: BudgetEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    const key = e.branchId ?? "";
    out.set(key, (out.get(key) ?? 0) + e.amount);
  }
  return out;
}

/** Budget per cost centre id — only entries that name a cost centre (never a header top-up or an
 *  unallocated branch-level HRMS line). */
export function budgetByCostCentreId(entries: BudgetEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (!e.costCentreId) continue;
    out.set(e.costCentreId, (out.get(e.costCentreId) ?? 0) + e.amount);
  }
  return out;
}

/** Entries whose cost centre CODE is one of `codes` (case/space-insensitive, as the SQL IN on a
 *  unicode_ci column used to be). */
export function entriesForCodes(entries: BudgetEntry[], codes: string[]): BudgetEntry[] {
  const want = new Set(codes.map(normCode).filter(Boolean));
  return entries.filter((e) => e.kind === "line" && e.costCentreCode && want.has(normCode(e.costCentreCode)));
}

/**
 * Header-level top-ups attributable to a set of cost-centre codes (see budget-top-up-attribution.ts
 * for the rule): a top-up belongs to the set only when EVERY line of its budget is in the set;
 * otherwise it is `shared` and never pro-rated. Only mirror budgets carry top-up entries, so HRMS
 * budgets contribute nothing here (their top-ups are already inside the lines).
 */
export function topUpsForCodes(entries: BudgetEntry[], codes: string[]): { attributable: number; shared: number } {
  const out = { attributable: 0, shared: 0 };
  const want = new Set(codes.map(normCode).filter(Boolean));
  if (want.size === 0) return out;
  const perBudget = new Map<string, { topUp: number; lines: number; inScope: number; hasTopUp: boolean }>();
  const slot = (ref: string) => {
    let s = perBudget.get(ref);
    if (!s) {
      s = { topUp: 0, lines: 0, inScope: 0, hasTopUp: false };
      perBudget.set(ref, s);
    }
    return s;
  };
  for (const e of entries) {
    const key = `${e.source}:${e.budgetRef}`;
    if (e.kind === "top_up") {
      const s = slot(key);
      s.topUp += e.amount;
      s.hasTopUp = true;
    } else {
      const s = slot(key);
      s.lines += 1;
      if (e.costCentreCode && want.has(normCode(e.costCentreCode))) s.inScope += 1;
    }
  }
  for (const s of perBudget.values()) {
    if (!s.hasTopUp || s.topUp === 0 || s.inScope === 0) continue;
    if (s.inScope === s.lines) out.attributable += s.topUp;
    else out.shared += s.topUp;
  }
  return out;
}

export const sumAmount = (entries: BudgetEntry[]): number => entries.reduce((t, e) => t + e.amount, 0);
