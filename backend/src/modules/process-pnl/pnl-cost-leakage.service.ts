import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * Cost Leakage Review — money that is real, but that no process's P&L can see.
 *
 * This is a different question from the Reconciliation tab, which asks whether the numbers that
 * ARE counted agree with their sources. This asks what never reaches a process line at all, and
 * therefore silently flatters every Operating Profit % computed below it.
 *
 * WHY IT DEFAULTS TO THE CURRENT FINANCIAL YEAR. Measured on production 2026-09-03, the unlinked
 * GRN population is 80,907 records worth Rs 101.8 crore — but roughly 78,000 of those are migrated
 * 2017-2019 history that was never expected to carry a cost allocation. Reporting the raw total
 * makes a live problem of 262 records worth Rs 22.67 lakh invisible underneath it, which is part
 * of why the existing Unlinked GRN Review list does not get worked through. The legacy population
 * is still reported here, as its own explicitly non-actionable bucket, so the number remains
 * available without drowning the signal.
 *
 * Every bucket declares whether it is actionable. A bucket appearing here does NOT mean it has
 * been fixed or that any reported figure has changed — nothing in this file writes anything.
 */

export type LeakageSeverity = "critical" | "warning" | "info";

export interface LeakageRow {
  id: string;
  label: string;
  detail: string | null;
  count: number;
  amount: number;
}

export interface LeakageBucket {
  code: string;
  title: string;
  /** Plain-language statement of what this is and why it matters. Rendered as written. */
  detail: string;
  severity: LeakageSeverity;
  /** False for context buckets that are correct as they stand and need no action. */
  actionable: boolean;
  count: number;
  amount: number;
  rows: LeakageRow[];
}

export interface CostLeakageReview {
  financeYear: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  buckets: LeakageBucket[];
  /** Sum of the actionable buckets only — never the informational ones. */
  actionableAmount: number;
}

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

/** Indian financial year (April-March) containing the given period. */
export function financeYearBounds(period: string): { label: string; from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return {
    label: `FY${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    from: `${startYear}-04`,
    to: `${startYear + 1}-03`,
  };
}

/** GRN states representing committed cost — the same set the Unlinked GRN reviewer uses. */
const LIVE_GRN_STATUS = "g.status NOT IN ('draft', 'rejected', 'cancelled')";
const NO_ALLOCATION = "NOT EXISTS (SELECT 1 FROM grn_cost_allocation a WHERE a.grn_request_id = g.id)";

/**
 * Cost centres with no active staff at all.
 *
 * Process attribution in pnl-actuals.service.ts is derived from the modal process of the employees
 * posted to a cost centre, because cost_centre_master.process_id is NULL on every live row. A cost
 * centre with nobody on it therefore resolves to process_id = NULL, and accumulate() only adds a
 * row to byProcess when the process id is truthy — so its spend reaches branch and company totals
 * but is structurally invisible at process level, which is the grain every OP% conversation
 * actually happens at.
 */
async function stafflessCostCentres(from: string, to: string): Promise<LeakageBucket> {
  const rows: LeakageRow[] = [];
  let count = 0;
  let amount = 0;
  if ((await tableExists("cost_centre_master")) && (await tableExists("grn_request"))) {
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, bm.branch_name,
              COUNT(g.id) AS grn_count,
              SUM(COALESCE(g.pnl_cost_amount, g.amount_with_tax)) AS amount
         FROM cost_centre_master ccm
         JOIN grn_request g
           ON g.cost_centre_id = ccm.id AND ${LIVE_GRN_STATUS}
          AND g.accounting_period BETWEEN ? AND ?
         LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
        WHERE ccm.active_status = 1
          AND NOT EXISTS (SELECT 1 FROM employees e
                           WHERE e.cost_centre_id = ccm.id AND e.active_status = 1)
        GROUP BY ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, bm.branch_name
        ORDER BY amount DESC`,
      [from, to],
    );
    for (const r of result) {
      count += 1;
      amount += n(r.amount);
      rows.push({
        id: String(r.id),
        label: String(r.cost_centre_name ?? r.cost_centre_code ?? "Unnamed cost centre"),
        detail: [r.branch_name, `${n(r.grn_count)} GRN${n(r.grn_count) === 1 ? "" : "s"}`]
          .filter(Boolean).join(" · "),
        count: n(r.grn_count),
        amount: n(r.amount),
      });
    }
  }
  return {
    code: "STAFFLESS_COST_CENTRE",
    title: "Spend on cost centres with no staff",
    detail:
      "A cost centre's process is inferred from the employees posted to it. These carry real spend "
      + "but have no active employees, so they resolve to no process and drop out of every "
      + "process-level P&L. The cost still sits in branch and company totals, so process Operating "
      + "Profit % reads better than the business actually performed.",
    severity: amount > 0 ? "critical" : "info",
    actionable: true,
    count,
    amount,
    rows: rows.slice(0, 50),
  };
}

/**
 * GRNs that reached a committed state this financial year without a cost allocation.
 *
 * Split by whether the record even carries a cost centre, because the two need different fixes: a
 * missing cost centre is a data-quality problem on the GRN itself, while a GRN that has one and
 * still failed to allocate points at a budget gap.
 */
async function unlinkedGrnCurrentFy(from: string, upTo: string): Promise<LeakageBucket> {
  const rows: LeakageRow[] = [];
  let count = 0;
  let amount = 0;
  if ((await tableExists("grn_request")) && (await tableExists("grn_cost_allocation"))) {
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT g.accounting_period,
              CASE WHEN g.cost_centre_id IS NULL OR TRIM(g.cost_centre_id) = ''
                   THEN 'no_cost_centre' ELSE 'has_cost_centre' END AS kind,
              COUNT(*) AS grn_count,
              SUM(COALESCE(g.pnl_cost_amount, g.amount_with_tax)) AS amount
         FROM grn_request g
        WHERE ${LIVE_GRN_STATUS} AND ${NO_ALLOCATION}
          AND g.accounting_period BETWEEN ? AND ?
        GROUP BY g.accounting_period, kind
        ORDER BY g.accounting_period DESC`,
      [from, upTo],
    );
    for (const r of result) {
      count += n(r.grn_count);
      amount += n(r.amount);
      rows.push({
        id: `${r.accounting_period}-${r.kind}`,
        label: String(r.accounting_period),
        detail: r.kind === "no_cost_centre"
          ? "No cost centre on the GRN — nothing to attribute it against"
          : "Has a cost centre, but no budget line absorbed it",
        count: n(r.grn_count),
        amount: n(r.amount),
      });
    }
  }
  return {
    code: "UNLINKED_GRN_CURRENT_FY",
    title: "Committed GRNs with no cost allocation (this financial year to date)",
    detail:
      "These GRNs are past draft and not rejected, so they represent committed spend, but no cost "
      + "allocation row was ever written for them. Until one is, the amount reaches no budget line "
      + "and no process cost line. Counted only up to the current month: a GRN dated to a future "
      + "accounting period has deliberately not been budgeted yet and is not a gap, the same "
      + "FUTURE_DEFERRED distinction the Unlinked GRN reviewer already makes.",
    severity: amount > 0 ? "warning" : "info",
    actionable: true,
    count,
    amount,
    rows,
  };
}

/** Spend on sub-heads deliberately kept out of the P&L — correct, but never audited anywhere. */
async function excludedTreatmentSpend(from: string, to: string): Promise<LeakageBucket> {
  const rows: LeakageRow[] = [];
  let count = 0;
  let amount = 0;
  if ((await tableExists("finance_expense_sub_head_master")) && (await tableExists("grn_request"))) {
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT sh.sub_head_name, sh.pnl_treatment, COUNT(*) AS grn_count,
              SUM(COALESCE(g.pnl_cost_amount, g.amount_with_tax)) AS amount
         FROM grn_request g
         JOIN finance_expense_sub_head_master sh
           ON UPPER(TRIM(sh.sub_head_name)) COLLATE utf8mb4_unicode_ci
            = UPPER(TRIM(g.sub_head)) COLLATE utf8mb4_unicode_ci
        WHERE sh.pnl_treatment IN ('excluded', 'capex')
          AND ${LIVE_GRN_STATUS}
          AND g.accounting_period BETWEEN ? AND ?
        GROUP BY sh.sub_head_name, sh.pnl_treatment
        ORDER BY amount DESC`,
      [from, to],
    );
    for (const r of result) {
      count += n(r.grn_count);
      amount += n(r.amount);
      rows.push({
        id: String(r.sub_head_name),
        label: String(r.sub_head_name),
        detail: `Treated as ${String(r.pnl_treatment)} — deliberately outside the P&L`,
        count: n(r.grn_count),
        amount: n(r.amount),
      });
    }
  }
  return {
    code: "EXCLUDED_TREATMENT_SPEND",
    title: "Spend excluded from the P&L by configuration",
    detail:
      "Sub-heads flagged 'excluded' or 'capex' are kept out of the P&L on purpose, which is right "
      + "for genuine capital items. Nothing anywhere reports how much that is, so a sub-head "
      + "flagged by mistake would remove an entire category with nothing to catch it. Shown here so "
      + "the exclusion stays a decision rather than an assumption.",
    severity: "info",
    actionable: false,
    count,
    amount,
    rows,
  };
}

/** Migrated history, reported so the current-year figures cannot be mistaken for the whole. */
async function legacyUnlinkedGrn(from: string): Promise<LeakageBucket> {
  const rows: LeakageRow[] = [];
  let count = 0;
  let amount = 0;
  if ((await tableExists("grn_request")) && (await tableExists("grn_cost_allocation"))) {
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT LEFT(g.accounting_period, 4) AS yr, COUNT(*) AS grn_count,
              SUM(COALESCE(g.pnl_cost_amount, g.amount_with_tax)) AS amount
         FROM grn_request g
        WHERE ${LIVE_GRN_STATUS} AND ${NO_ALLOCATION} AND g.accounting_period < ?
        GROUP BY yr
        ORDER BY yr DESC`,
      [from],
    );
    for (const r of result) {
      count += n(r.grn_count);
      amount += n(r.amount);
      rows.push({
        id: String(r.yr),
        label: String(r.yr),
        detail: "Migrated history — not expected to carry a cost allocation",
        count: n(r.grn_count),
        amount: n(r.amount),
      });
    }
  }
  return {
    code: "LEGACY_UNLINKED_GRN",
    title: "Unlinked GRNs from before this financial year",
    detail:
      "Historical records migrated from the legacy finance system. They were never allocated and "
      + "are not a live gap — listed only so the current-year figure is not mistaken for the entire "
      + "unlinked population, and so this volume is understood as the reason the Unlinked GRN "
      + "Review list is hard to work through.",
    severity: "info",
    actionable: false,
    count,
    amount,
    rows,
  };
}

/**
 * The expense-claim ledger, reported as unusable rather than silently imported.
 *
 * process-pnl.service.ts carries query paths for an expense_claims/expense_items schema that does
 * not exist in this database; they are inert and, as it turns out, correct to be inert. See that
 * file's "DEAD BY DESIGN" note for the full evidence. This bucket exists so the ledger is visible
 * and its exclusion is a recorded decision rather than an oversight nobody can see.
 */
async function unusableExpenseLedger(): Promise<LeakageBucket> {
  const rows: LeakageRow[] = [];
  let count = 0;
  let amount = 0;
  if (await tableExists("expense_claim")) {
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT ec.status, COUNT(*) AS claim_count, SUM(ec.amount) AS amount,
              SUM(ec.cost_centre_id IS NULL) AS no_cost_centre,
              MAX(ec.expense_date) AS latest
         FROM expense_claim ec
        GROUP BY ec.status`,
    );
    for (const r of result) {
      count += n(r.claim_count);
      amount += n(r.amount);
      rows.push({
        id: String(r.status),
        label: `Status: ${String(r.status)}`,
        detail: `${n(r.no_cost_centre)} of ${n(r.claim_count)} carry no cost centre · latest entry `
          + `${r.latest ? String(r.latest).slice(0, 10) : "none"}`,
        count: n(r.claim_count),
        amount: n(r.amount),
      });
    }
  }
  return {
    code: "UNUSABLE_EXPENSE_LEDGER",
    title: "Expense-claim ledger, deliberately not in the P&L",
    detail:
      "This ledger cannot be booked as cost as it stands: nothing in it is approved, no row carries "
      + "a cost centre, its employee references are placeholders rather than real people, its "
      + "largest entries are capital items, and some rows duplicate GRNs already recognised. It is "
      + "shown so the omission is deliberate and visible. It must not be wired into the P&L before "
      + "approval, attribution and de-duplication are fixed at source.",
    severity: "info",
    actionable: false,
    count,
    amount,
    rows,
  };
}

export async function getCostLeakageReview(period: string): Promise<CostLeakageReview> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw Object.assign(new Error("period must be YYYY-MM"), { statusCode: 400 });
  }
  const fy = financeYearBounds(period);
  const buckets = await Promise.all([
    stafflessCostCentres(fy.from, period),
    unlinkedGrnCurrentFy(fy.from, period),
    excludedTreatmentSpend(fy.from, period),
    legacyUnlinkedGrn(fy.from),
    unusableExpenseLedger(),
  ]);
  return {
    financeYear: fy.label,
    periodFrom: fy.from,
    periodTo: fy.to,
    generatedAt: new Date().toISOString(),
    buckets,
    actionableAmount: buckets.filter((b) => b.actionable).reduce((s, b) => s + b.amount, 0),
  };
}

/**
 * The GRNs behind one staffless cost centre, over the same window the bucket counted.
 *
 * Deliberately NOT served by getPnlDrilldown(). That takes a single period and reads the
 * grn_entry_line_snapshot mirror; this bucket is financial-year-to-date and reads grn_request. Both
 * sources are real and they do reconcile, but a row totalling the year opened against one month
 * shows nothing whenever the spend happened earlier — measured live, BSS-HR's Rs 25.02 lakh sits in
 * 2026-04 to 2026-07, so opening it "as at September" would have rendered an empty drawer under a
 * populated row. Same source and same window as the figure clicked, so this ties by construction.
 */
export async function getStafflessCostCentreSpend(
  period: string,
  costCentreId: string,
): Promise<{ rows: LeakageRow[]; total: number }> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw Object.assign(new Error("period must be YYYY-MM"), { statusCode: 400 });
  }
  if (!(await tableExists("grn_request"))) return { rows: [], total: 0 };
  const fy = financeYearBounds(period);
  const [result] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.accounting_period, g.head, g.sub_head, g.bill_date, g.status,
            COALESCE(g.pnl_cost_amount, g.amount_with_tax) AS amount
       FROM grn_request g
      WHERE g.cost_centre_id = ?
        AND ${LIVE_GRN_STATUS}
        AND g.accounting_period BETWEEN ? AND ?
      ORDER BY amount DESC`,
    [costCentreId, fy.from, period],
  );
  const rows: LeakageRow[] = result.map((r) => ({
    id: String(r.id),
    label: r.grn_number ? String(r.grn_number) : "GRN (number pending approval)",
    detail: [r.accounting_period, r.head, r.sub_head, r.status]
      .filter(Boolean).map(String).join(" · "),
    count: 1,
    amount: n(r.amount),
  }));
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}
