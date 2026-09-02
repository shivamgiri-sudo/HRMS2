/**
 * Backfill grn_cost_allocation for migrated GRNs (db_bill -> grn_request via
 * migrate-grn-from-dbbill.ts, which never wrote this table) whose cost centre + head +
 * sub_head + branch + financial_year resolve UNAMBIGUOUSLY to an existing active budget
 * line — "bucket ①" from the 2026-08-21 budget-consumption-gap investigation.
 *
 * WHY THIS EXISTS. Confirmed live: 1,640 of 1,659 real FY2026-27 GRNs (₹3.63cr) have zero
 * grn_cost_allocation row, so the Branch Budget page's consumption figures (sourced only
 * from that table) show near-zero spend against branches with real, approved, sometimes
 * already-PAID vendor/imprest expense. Of those, 256 (₹1.13cr) resolve to exactly one
 * budget line with no ambiguity — this script backfills only those. The other two buckets
 * (budget line exists but under a different head; branch has no FY2026-27 budget at all)
 * are real governance gaps, not a mapping bug, and are deliberately NOT force-matched here.
 *
 * HOW THE TAX SPLIT IS DERIVED. The migrated GRN only carries amount_with_tax (no GST
 * breakdown). Rather than hand-deriving base/tax (risking a wrong P&L GST-cost split),
 * this reuses calculateBudgetLine() (branch-budget.service.ts) — the exact function the
 * native multi-line split UI uses — solved for one line: pick unitRate so that running
 * {quantity:1, unitRate, ...line's own tax_treatment/gst_rate/gst_type} through it
 * reproduces the GRN's real amount_with_tax as grossAmount. Verified per-row (assertion,
 * not assumed) that the reproduced gross matches within a paisa; any GRN that doesn't
 * reproduce exactly is SKIPPED and reported, never forced.
 *
 * HOW BUDGET CONSUMPTION IS RECORDED. First attempt (2026-08-21) called
 * budgetConsumptionService.reserve()/consume() directly and wrote ZERO of 241 rows — every
 * one refused, for two reasons neither of which is really about THIS backfill:
 *   (a) lockActiveBudgetLine() requires the budget HEADER status='active'; most FY2026-27
 *       headers haven't finished the new approval workflow yet (expected, given the native
 *       budget system is barely populated — see the spec doc this investigation produced).
 *   (b) reserve() unconditionally calls budgetClosureService.assertSubheadOpen(), which
 *       reads a table (finance_budget_subhead_closure) that does not exist on this DB —
 *       a genuinely separate, in-flight migration gap from another concurrent session's
 *       Branch Budget overhaul work, left untouched per the no-touching-other-sessions rule.
 * Both gates exist to decide whether to PERMIT NEW spend — not the right question for
 * recording spend that already, verifiably happened in the past (these GRNs are already
 * finance_head_approved or paid). Per explicit user decision, this backfill writes
 * finance_budget_line.reserved_amount/consumed_amount DIRECTLY instead of going through
 * reserve()/consume(), skipping both gates, but keeping the one check that still matters
 * for a backfill — the amount must not push the line's reserved+consumed total past its
 * gross_amount (checked here, not assumed away). Per the GRN's own current status:
 *   - draft / submitted            -> grn_cost_allocation row only, lifecycle_status='draft'
 *                                      (matches the native rule: draft reserves nothing)
 *   - branch_head_approved         -> reserved_amount += amount, lifecycle_status='reserved'
 *   - finance_head_approved / paid -> consumed_amount += amount, lifecycle_status='consumed'
 *   - rejected / cancelled         -> SKIPPED entirely (no real spend occurred)
 *
 * A GRN whose amount would push the line over its gross_amount is REPORTED, not forced —
 * that means the "clean match" is real but the budget itself cannot actually absorb this
 * spend on paper, which is its own finding for finance, not a bug in this script.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. One transaction per GRN (commit/rollback
 * independently), so one bad row never blocks the rest of the batch.
 */
import mysql, { type PoolConnection } from "mysql2/promise";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { calculateBudgetLine } from "../src/modules/process-pnl/branch-budget.service.js";

const APPLY = process.argv.includes("--apply");
/** Same synthetic actor id migrate-grn-from-dbbill.ts uses for every migrated row, so an
 *  auditor can recognize both the GRN and its allocation as coming from the same
 *  non-human migration path rather than a real user action. */
const MIGRATION_USER = "00000000-0000-0000-0000-dbbill000001";

function roundMoney(v: number) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

/** Inverts calculateBudgetLine's forward math for a single line: given the target gross
 *  (the GRN's real amount_with_tax) and the budget line's own tax_treatment/gst_rate,
 *  finds the unitRate that reproduces exactly that gross when quantity=1. */
function unitRateForTargetGross(targetGross: number, taxTreatment: string, gstRate: number): number {
  if (["exclusive", "reverse_charge"].includes(taxTreatment) && gstRate > 0) {
    return roundMoney(targetGross / (1 + gstRate / 100));
  }
  // inclusive, exempt, non_gst, or a 0%-rate exclusive/reverse_charge line: grossAmount
  // equals quotedAmount (= quantity * unitRate) directly in every one of those cases.
  return targetGross;
}

interface TargetGrn {
  grn_id: string;
  grn_number: string;
  status: string;
  amount_with_tax: string;
  branch_id: string;
  cost_centre_id: string;
  budget_line_id: string;
  budget_id: string;
}

async function findCleanMatches(hrms: mysql.Connection): Promise<TargetGrn[]> {
  // h.period_code = g.accounting_period is load-bearing, not redundant with financial_year: a
  // (cost_centre, head, sub_head) combination is usually native-budgeted for only ONE month within
  // the financial year (whichever month the new budgeting workflow has actually reached), so
  // without this the "exactly one unambiguous match" check below picked that one real month's line
  // as the "clean match" for every OTHER month's GRN too -- confirmed live 2026-09-02: 52 GRNs from
  // April-July silently drew against August's budget line this way (see
  // remediate-clean-match-wrong-period-linkage.ts, which reverses the damage from the first run).
  // A GRN whose own month has no budget line of its own is a real governance gap now, same bucket
  // as "branch has no FY2026-27 budget at all" -- not something this backfill should paper over by
  // borrowing a different month's line.
  const [rows] = await hrms.query<any[]>(`
    SELECT g.id AS grn_id, g.grn_number, g.status, g.amount_with_tax, g.branch_id,
           g.cost_centre_id, MIN(l.id) AS budget_line_id, MIN(l.budget_id) AS budget_id
    FROM grn_request g
    JOIN finance_budget_line l ON l.cost_centre_id = g.cost_centre_id AND l.head = g.head AND (l.sub_head <=> g.sub_head)
    JOIN finance_budget_header h ON h.id = l.budget_id AND h.branch_id = g.branch_id AND h.financial_year = g.financial_year
      AND h.period_code = g.accounting_period
    WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
      AND g.bill_source_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
      AND g.status NOT IN ('rejected', 'cancelled')
    GROUP BY g.id
    HAVING COUNT(DISTINCT l.id) = 1
  `);
  return rows;
}

async function loadBudgetLine(hrms: mysql.Connection, lineId: string) {
  const [rows] = await hrms.query<any[]>(
    `SELECT l.*, h.status AS budget_status FROM finance_budget_line l
     JOIN finance_budget_header h ON h.id = l.budget_id
     WHERE l.id = ?`,
    [lineId]
  );
  return rows[0];
}

/** Same query reserve()/consume() themselves use to compute headroom (branch-budget's own
 *  `availability()`), read fresh inside the row's own transaction below via FOR UPDATE —
 *  the one gate this backfill keeps: a historical GRN still must not push a line's
 *  reserved+consumed past its approved gross_amount. */
async function loadBudgetLineForUpdate(connection: PoolConnection, lineId: string) {
  const [rows] = await connection.execute<any[]>(
    `SELECT * FROM finance_budget_line WHERE id = ? FOR UPDATE`,
    [lineId]
  );
  return rows[0];
}

async function processOne(pool: mysql.Pool, target: TargetGrn, hrms: mysql.Connection) {
  const line = await loadBudgetLine(hrms, target.budget_line_id);
  if (!line) return { grn: target, outcome: "SKIP" as const, reason: "budget line vanished between scan and apply" };

  const amountWithTax = Number(target.amount_with_tax);
  const unitRate = unitRateForTargetGross(amountWithTax, String(line.tax_treatment), Number(line.gst_rate));
  const amounts = calculateBudgetLine({
    head: String(line.head), subHead: line.sub_head, itemName: String(line.item_name),
    quantity: 1, unit: String(line.unit), unitRate,
    taxTreatment: line.tax_treatment, gstRate: Number(line.gst_rate), gstType: line.gst_type,
    recoverableTaxPct: Number(line.recoverable_tax_pct), justification: "Backfilled from migrated GRN",
  });

  const reproducedGross = amounts.grossAmount;
  if (Math.abs(reproducedGross - amountWithTax) > 0.02) {
    return {
      grn: target, outcome: "SKIP" as const,
      reason: `tax-split reproduction mismatch: target ${amountWithTax} vs reproduced ${reproducedGross} (line tax_treatment=${line.tax_treatment}, gst_rate=${line.gst_rate})`,
    };
  }

  let lifecycleStatus: "draft" | "reserved" | "consumed" = "draft";
  if (target.status === "branch_head_approved") lifecycleStatus = "reserved";
  else if (target.status === "finance_head_approved" || target.status === "paid") lifecycleStatus = "consumed";

  if (!APPLY) {
    return { grn: target, outcome: "WOULD_APPLY" as const, reason: `-> lifecycle_status=${lifecycleStatus}, budget_line=${line.item_name}` };
  }

  const connection: PoolConnection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // The one gate kept: re-read the line FOR UPDATE inside this row's own transaction
    // (fresh, not the dry-run-time snapshot) and refuse if this amount would push
    // reserved+consumed past the line's approved gross_amount — same headroom check
    // budgetConsumptionService's own availability() does, just without the
    // active-header-status or subhead-closure gates (see file header note).
    if (lifecycleStatus === "reserved" || lifecycleStatus === "consumed") {
      const freshLine = await loadBudgetLineForUpdate(connection, target.budget_line_id);
      if (!freshLine) throw new Error("budget line vanished before write");
      const available = roundMoney(
        Number(freshLine.gross_amount || 0) - Number(freshLine.reserved_amount || 0) - Number(freshLine.consumed_amount || 0)
      );
      if (amounts.grossAmount > available + 0.01) {
        throw new Error(`GRN_EXCEEDS_BUDGET_AMOUNT: exceeds available budget by ${(amounts.grossAmount - available).toFixed(2)}`);
      }
      if (lifecycleStatus === "reserved") {
        await connection.execute(
          `UPDATE finance_budget_line SET reserved_amount = reserved_amount + ?, reserved_quantity = reserved_quantity + 1 WHERE id = ?`,
          [amounts.grossAmount, target.budget_line_id]
        );
      } else {
        await connection.execute(
          `UPDATE finance_budget_line SET consumed_amount = consumed_amount + ?, consumed_quantity = consumed_quantity + 1 WHERE id = ?`,
          [amounts.grossAmount, target.budget_line_id]
        );
      }
    }

    const now = lifecycleStatus !== "draft" ? new Date() : null;
    await connection.execute(
      `INSERT INTO grn_cost_allocation
       (id, grn_request_id, sequence_no, budget_id, budget_line_id, branch_id, process_id,
        cost_centre_id, cost_class, allocation_percentage, quantity, unit, unit_rate,
        tax_treatment, gst_rate, gst_type, recoverable_tax_pct, amount_without_tax,
        tax_amount, cgst_amount, sgst_amount, igst_amount, amount_with_tax,
        recoverable_tax_amount, pnl_cost_amount, lifecycle_status, remarks, is_unbudgeted,
        reserved_at, consumed_at, created_by)
       VALUES (?,?,1,?,?,?,?,?,?,100.000000,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      [
        randomUUID(), target.grn_id, line.budget_id, target.budget_line_id, target.branch_id,
        line.process_id ?? null, target.cost_centre_id, "direct",
        line.unit, unitRate, line.tax_treatment, line.gst_rate, line.gst_type,
        line.recoverable_tax_pct, amounts.baseAmount, amounts.taxAmount, amounts.cgstAmount,
        amounts.sgstAmount, amounts.igstAmount, amounts.grossAmount, amounts.recoverableTaxAmount,
        amounts.pnlCostAmount, lifecycleStatus, "Backfilled 2026-08-21 — migrated GRN, clean budget-line match",
        lifecycleStatus === "reserved" ? now : null,
        lifecycleStatus === "consumed" ? now : null,
        MIGRATION_USER,
      ]
    );

    await connection.commit();
    return { grn: target, outcome: "APPLIED" as const, reason: `lifecycle_status=${lifecycleStatus}` };
  } catch (error) {
    await connection.rollback();
    return { grn: target, outcome: "REFUSED" as const, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    connection.release();
  }
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    connectionLimit: 5,
  });

  try {
    const targets = await findCleanMatches(hrms);
    console.log(`\nClean-match in-scope GRNs: ${targets.length}`);
    console.log(`Total amount: ${targets.reduce((s, t) => s + Number(t.amount_with_tax), 0).toFixed(2)}\n`);

    const results = { APPLIED: 0, WOULD_APPLY: 0, SKIP: 0, REFUSED: 0 };
    const problems: string[] = [];

    for (const target of targets) {
      const result = await processOne(pool, target, hrms);
      results[result.outcome]++;
      if (result.outcome === "SKIP" || result.outcome === "REFUSED") {
        problems.push(`  ${target.grn_number} (${result.outcome}): ${result.reason}`);
      }
    }

    console.log("=== Summary ===");
    console.table(results);
    if (problems.length) {
      console.log(`\n${problems.length} GRN(s) could not be processed:`);
      console.log(problems.join("\n"));
    }
    console.log(APPLY ? "\nAPPLIED." : "\nDRY RUN — nothing written. Pass --apply to write.");
  } finally {
    await hrms.end();
    await pool.end();
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
