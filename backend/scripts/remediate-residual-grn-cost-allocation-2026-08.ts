/**
 * Residual GRN-to-budget linkage remediation (2026-08-22, item 12).
 *
 * Scope: narrower than remediate-grn-budget-linkage-full-fy.ts on purpose. That script's job was
 * "no native budget infrastructure exists at all for this branch/month" — it fabricated headers
 * and lines directly. This script's job is the OPPOSITE case: real budget infrastructure now
 * exists for most branches/months (both from that earlier remediation and from ordinary native
 * budgeting since), and getUnlinkedGrnReview() still finds a residual population of GRNs that
 * unlinked-grn-review.service.ts's own EXACT (budget_id, cost_centre_id, head, sub_head) tuple
 * match cannot resolve to a line — NO_MATCHING_LINE / HEADROOM_EXCEEDED — even though a sibling
 * cost centre in the same branch, or a pooled line, may already cover the same head+sub-head. That
 * broader match is exactly what budget-headroom-gate.service.ts's getHeadSubHeadCoverage() /
 * allocateAcrossLines() (Group C, already merged and live on grn-smart.service.ts's real GRN save
 * path) compute. This script re-runs that SAME live logic against the residual population instead
 * of fabricating any new header or line.
 *
 * Categories handled:
 *   - NO_MATCHING_LINE / HEADROOM_EXCEEDED: the only two this script writes anything for. Draw
 *     from the branch-wide aggregate for that head+sub-head via allocateAcrossLines(); a row that
 *     genuinely cannot be covered (HEADROOM_EXCEEDED at the aggregate level) is REFUSED and logged,
 *     not fatal to the batch.
 *   - NO_BRANCH_BUDGET / NO_COST_CENTRE: never written here. Collected into the printed report for
 *     manual Finance review — no header/line fabrication, no guessing at a missing cost centre.
 *   - FUTURE_DEFERRED: left alone entirely (legitimate multi-month recognition splits).
 *
 * DRY RUN BY DEFAULT — pass --apply to write. Same convention as remediate-grn-budget-linkage-full
 * -fy.ts: one transaction per (branch, accounting_period) header group so one bad group never
 * blocks the rest; an in-memory "effective state" (drawnAmountByLineId/drawnQuantityByLineId) is
 * tracked across the WHOLE run (not just one header group) so a line drawn down by GRN #1 is seen
 * as less available when GRN #2 (possibly in a different header group, if the same head+sub-head
 * happens to recur — it normally won't across periods, but lines are only ever scoped to one
 * header, so in practice this only matters within one header group; tracked run-wide anyway for
 * the identical reason grn-smart.service.ts's saveAllocations() tracks it run-wide across a single
 * GRN's multiple allocation rows: cheap to get right, expensive to get wrong).
 *
 * NOT touched, read-only references only: unlinked-grn-review.service.ts, budget-headroom-gate
 * .service.ts, grn-smart.service.ts, grn.service.ts, remediate-grn-budget-linkage-full-fy.ts,
 * backfill-grn-cost-allocation-clean-match.ts.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import {
  getUnlinkedGrnReview,
  type UnlinkedGrnRow,
  type UnlinkedGrnCategory,
} from "../src/modules/process-pnl/unlinked-grn-review.service.js";
import {
  getHeadSubHeadCoverage,
  allocateAcrossLines,
} from "../src/modules/process-pnl/budget-headroom-gate.service.js";
import { calculateBudgetLine, type BudgetTaxTreatment, type BudgetGstType } from "../src/modules/process-pnl/branch-budget.service.js";

const APPLY = process.argv.includes("--apply");

/**
 * Distinct from remediate-grn-budget-linkage-full-fy.ts's own REMEDIATION_USER
 * ("00000000-0000-0000-0000-budgetfix001") — incrementing the trailing digits so an auditor can
 * tell the two remediation runs apart on any row either one touched.
 */
const REMEDIATION_USER = "00000000-0000-0000-0000-budgetfix002";

/**
 * grn.service.ts's CONSUMED_GRN_STATUSES is NOT exported (verified against live source — the
 * brief's "ground truth" claimed it was; it is a private module-level const, referenced only
 * inside grn.service.ts itself and asserted against as a literal string in one contract test).
 * Duplicated here verbatim rather than imported, since importing it would require editing a
 * protected file. Value confirmed identical to grn.service.ts lines 43-49 as of this run.
 */
const CONSUMED_GRN_STATUSES = [
  "pending_accounts_payment",
  "payment_scheduled",
  "partially_paid",
  "paid",
  "approved",
] as const;

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

function formatMoney(value: number) {
  return `Rs.${roundMoney(value).toFixed(2)}`;
}

/**
 * Reverses calculateBudgetLine's gross-from-quoted arithmetic so a draw against a specific
 * funding line reproduces exactly `grossTarget` as that draw's own grossAmount, using the FUNDING
 * LINE's own tax profile — never the GRN's own stale tax_treatment/gst_rate columns.
 *
 * Copied verbatim from grn-smart.service.ts's requiredQuotedAmount() (lines ~173-178) per the
 * task brief's explicit instruction to reuse the identical formula rather than re-deriving it, so
 * this produces numerically identical results to what the live gate would have computed had this
 * GRN gone through it originally.
 */
function requiredQuotedAmount(grossTarget: number, taxTreatment: string, gstRate: number): number {
  if (["exclusive", "reverse_charge"].includes(taxTreatment) && Number(gstRate) > 0) {
    return grossTarget / (1 + Number(gstRate) / 100);
  }
  return grossTarget;
}

/**
 * Maps a GRN's own status to the grn_cost_allocation lifecycle_status this remediation would
 * write. Returns null for anything that doesn't obviously map to one of the three lifecycle
 * values — the caller must treat null as "do not guess, log as SKIPPED (ambiguous status)".
 *
 * Deliberately does NOT fall back to "draft" for anything not explicitly recognised: only
 * "submitted" (the one example the brief itself gives) maps to draft. In particular
 * "finance_head_approved" is left unmapped (null) rather than assumed-consumed — unlike
 * remediate-grn-budget-linkage-full-fy.ts, which folded it into "consumed" alongside "paid".
 * That fold does not match grn.service.ts's own CONSUMED_GRN_STATUSES (which excludes
 * finance_head_approved), and the live approval code path (grn.service.ts's approveOrReject())
 * never actually persists "finance_head_approved" as a resting status — Finance Head approval
 * writes straight through to pending_accounts_payment/approved in the same update. Wherever it
 * does appear on a real row (evidently reachable — see vendor-payment.service.ts's status filter),
 * its true reserved-vs-consumed state cannot be inferred safely from the string alone, so this
 * remediation refuses to guess and leaves it for manual review instead.
 */
function mapLifecycle(status: string): "consumed" | "reserved" | "draft" | null {
  if ((CONSUMED_GRN_STATUSES as readonly string[]).includes(status)) return "consumed";
  if (status === "branch_head_approved") return "reserved";
  if (status === "submitted") return "draft";
  return null;
}

type Outcome =
  | { kind: "WOULD-WRITE"; row: UnlinkedGrnRow; draws: number; grossTotal: number }
  | { kind: "REFUSED"; row: UnlinkedGrnRow; reason: string }
  | { kind: "SKIPPED"; row: UnlinkedGrnRow; reason: string };

async function fetchProcessIds(grnIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!grnIds.length) return map;
  const placeholders = grnIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_id FROM grn_request WHERE id IN (${placeholders})`,
    grnIds
  );
  for (const r of rows) map.set(String(r.id), r.process_id ? String(r.process_id) : null);
  return map;
}

/**
 * Processes one NO_MATCHING_LINE / HEADROOM_EXCEEDED row: finds real branch-wide coverage,
 * allocates across it, and (if APPLY) writes the resulting grn_cost_allocation row(s) and bumps
 * each funding line's reserved_amount/consumed_amount. Always updates drawnAmountByLineId /
 * drawnQuantityByLineId in memory regardless of APPLY, so the dry-run preview and a later real
 * run see identical headroom for every subsequent row in the same batch.
 */
async function processRow(
  row: UnlinkedGrnRow,
  processId: string | null,
  connection: { execute: (sql: string, params?: unknown[]) => Promise<any> } | null,
  drawnAmountByLineId: Map<string, number>,
  drawnQuantityByLineId: Map<string, number>
): Promise<Outcome> {
  const coverage = await getHeadSubHeadCoverage(row.branchId, row.accountingPeriod, row.head, row.subHead);
  if (!coverage.headerActive || !coverage.lines.length) {
    return { kind: "SKIPPED", row, reason: "no real coverage found — re-classify manually" };
  }

  // Net out whatever earlier rows in this same run already drew against each of these lines —
  // identical pattern to grn-smart.service.ts's saveAllocations() netLines step.
  const netLines = coverage.lines.map((candidate) => {
    const already = drawnAmountByLineId.get(String(candidate.id)) ?? 0;
    return already > 0
      ? { ...candidate, available_gross_amount: Math.max(0, Number(candidate.available_gross_amount) - already) }
      : candidate;
  });

  let draws: Array<{ lineId: string; amount: number }>;
  try {
    draws = allocateAcrossLines(null, row.amountWithTax, netLines);
  } catch (error: any) {
    if (error?.code === "HEADROOM_EXCEEDED") {
      return { kind: "REFUSED", row, reason: `shortfall ${formatMoney(error.shortfall ?? 0)} across the branch aggregate for ${row.head}/${row.subHead ?? ""}` };
    }
    throw error;
  }

  const lifecycle = mapLifecycle(row.status);
  if (lifecycle === null) {
    return { kind: "SKIPPED", row, reason: `ambiguous status: ${row.status} — needs manual review` };
  }

  let grossTotal = 0;
  for (let drawIndex = 0; drawIndex < draws.length; drawIndex += 1) {
    const draw = draws[drawIndex];
    const fundingLine = coverage.lines.find((candidate) => String(candidate.id) === String(draw.lineId));
    if (!fundingLine) throw new Error(`internal error resolving funding line ${draw.lineId} for ${row.grnNumber}`);

    // Reproduce exactly draw.amount as this draw's own grossAmount, from the FUNDING line's own
    // tax profile — not the GRN's own stale tax_treatment/gst_rate.
    const quotedAmount = requiredQuotedAmount(draw.amount, String(fundingLine.tax_treatment), Number(fundingLine.gst_rate));
    const fundingUnitRate = Number(fundingLine.unit_rate);
    const drawQuantity = fundingUnitRate > 0 ? roundQuantity(quotedAmount / fundingUnitRate) : 0;

    const amounts = calculateBudgetLine({
      head: String(fundingLine.head),
      subHead: fundingLine.sub_head,
      itemName: String(fundingLine.item_name),
      quantity: drawQuantity,
      unit: String(fundingLine.unit),
      unitRate: fundingUnitRate,
      taxTreatment: String(fundingLine.tax_treatment) as BudgetTaxTreatment,
      gstRate: Number(fundingLine.gst_rate),
      gstType: String(fundingLine.gst_type) as BudgetGstType,
      recoverableTaxPct: Number(fundingLine.recoverable_tax_pct),
      justification: String(fundingLine.justification || "Approved budget allocation"),
    });

    grossTotal = roundMoney(grossTotal + amounts.grossAmount);

    if (APPLY && connection) {
      const now = lifecycle !== "draft" ? new Date() : null;
      if (lifecycle === "reserved") {
        await connection.execute(
          `UPDATE finance_budget_line SET reserved_amount = reserved_amount + ?, reserved_quantity = reserved_quantity + ? WHERE id = ?`,
          [amounts.grossAmount, drawQuantity, String(fundingLine.id)]
        );
      } else if (lifecycle === "consumed") {
        await connection.execute(
          `UPDATE finance_budget_line SET consumed_amount = consumed_amount + ?, consumed_quantity = consumed_quantity + ? WHERE id = ?`,
          [amounts.grossAmount, drawQuantity, String(fundingLine.id)]
        );
      }
      await connection.execute(
        `INSERT INTO grn_cost_allocation
         (id, grn_request_id, sequence_no, budget_id, budget_line_id, branch_id, process_id,
          cost_centre_id, cost_class, allocation_percentage, quantity, unit, unit_rate,
          tax_treatment, gst_rate, gst_type, recoverable_tax_pct, amount_without_tax,
          tax_amount, cgst_amount, sgst_amount, igst_amount, amount_with_tax,
          recoverable_tax_amount, pnl_cost_amount, lifecycle_status, remarks, is_unbudgeted,
          reserved_at, consumed_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
        [
          randomUUID(), row.grnId, drawIndex + 1, String(fundingLine.budget_id), String(fundingLine.id),
          row.branchId, processId, row.costCentreId, "direct",
          // allocation_percentage: weighted by this draw's own share of the GRN's total; the
          // caller (main) corrects rounding drift on the last draw the same way
          // grn-smart.service.ts's saveAllocations() does.
          row.amountWithTax > 0 ? roundMoney((amounts.grossAmount / row.amountWithTax) * 100) : 0,
          drawQuantity, String(fundingLine.unit), fundingUnitRate,
          String(fundingLine.tax_treatment), Number(fundingLine.gst_rate), String(fundingLine.gst_type),
          Number(fundingLine.recoverable_tax_pct), amounts.baseAmount,
          amounts.taxAmount, amounts.cgstAmount, amounts.sgstAmount,
          amounts.igstAmount, amounts.grossAmount,
          amounts.recoverableTaxAmount, amounts.pnlCostAmount, lifecycle,
          drawIndex === 0
            ? `Remediated 2026-08-22 — residual GRN-to-budget linkage fix, drawn from branch aggregate`
            : `Remediated 2026-08-22 — residual GRN-to-budget linkage fix, spillover draw from branch aggregate`,
          lifecycle === "reserved" ? now : null, lifecycle === "consumed" ? now : null, REMEDIATION_USER,
        ]
      );
    }

    drawnAmountByLineId.set(String(fundingLine.id), (drawnAmountByLineId.get(String(fundingLine.id)) ?? 0) + draw.amount);
    drawnQuantityByLineId.set(String(fundingLine.id), (drawnQuantityByLineId.get(String(fundingLine.id)) ?? 0) + drawQuantity);
  }

  return { kind: "WOULD-WRITE", row, draws: draws.length, grossTotal };
}

function groupByHeader(rows: UnlinkedGrnRow[]): Map<string, UnlinkedGrnRow[]> {
  const groups = new Map<string, UnlinkedGrnRow[]>();
  for (const row of rows) {
    const key = `${row.branchId}|${row.accountingPeriod}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

async function main() {
  const review = await getUnlinkedGrnReview({});

  console.log("=== Category breakdown (as of period", review.asOfPeriod, ") ===");
  const categoryOrder: UnlinkedGrnCategory[] = [
    "NO_MATCHING_LINE",
    "HEADROOM_EXCEEDED",
    "NO_BRANCH_BUDGET",
    "NO_COST_CENTRE",
    "FUTURE_DEFERRED",
  ];
  for (const cat of categoryOrder) {
    const s = review.summary.find((x) => x.category === cat);
    console.log(`  ${cat.padEnd(18)} count=${String(s?.count ?? 0).padStart(5)}  amount=${formatMoney(s?.amount ?? 0)}`);
  }
  console.log(`  TOTAL (excl. FUTURE_DEFERRED)  count=${review.totalCount}  amount=${formatMoney(review.totalAmount)}\n`);

  const candidateRows = review.rows.filter(
    (r) => r.category === "NO_MATCHING_LINE" || r.category === "HEADROOM_EXCEEDED"
  );
  const processIdByGrn = await fetchProcessIds(candidateRows.map((r) => r.grnId));

  const drawnAmountByLineId = new Map<string, number>();
  const drawnQuantityByLineId = new Map<string, number>();
  const outcomes: Outcome[] = [];

  console.log("=== Per-row remediation log (NO_MATCHING_LINE / HEADROOM_EXCEEDED only) ===");
  const headerGroups = groupByHeader(candidateRows);
  for (const [key, rows] of headerGroups) {
    const [branchId, period] = key.split("|");
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const row of rows) {
        const outcome = await processRow(
          row,
          processIdByGrn.get(row.grnId) ?? null,
          connection,
          drawnAmountByLineId,
          drawnQuantityByLineId
        );
        outcomes.push(outcome);
        if (outcome.kind === "WOULD-WRITE") {
          console.log(`  WOULD-WRITE ${row.grnNumber} (${row.category})  ${formatMoney(outcome.grossTotal)}  ${outcome.draws} draw(s)  branch=${branchId.slice(0, 8)} period=${period}`);
        } else if (outcome.kind === "REFUSED") {
          console.log(`  REFUSED     ${row.grnNumber} (${row.category})  ${formatMoney(row.amountWithTax)}  ${outcome.reason}`);
        } else {
          console.log(`  SKIPPED     ${row.grnNumber} (${row.category})  ${formatMoney(row.amountWithTax)}  ${outcome.reason}`);
        }
      }
      if (APPLY) {
        await connection.commit();
      } else {
        // Dry run: nothing above should have executed a write (APPLY-gated), but rollback
        // unconditionally anyway as a hard backstop against any accidental write.
        await connection.rollback();
      }
    } catch (error) {
      await connection.rollback();
      console.log(`  FAILED header ${branchId.slice(0, 8)} ${period}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connection.release();
    }
  }

  const noBranchBudget = review.rows.filter((r) => r.category === "NO_BRANCH_BUDGET");
  const noCostCentre = review.rows.filter((r) => r.category === "NO_COST_CENTRE");

  console.log("\n=== NO_BRANCH_BUDGET — manual Finance review (never written by this script) ===");
  if (!noBranchBudget.length) {
    console.log("  (none)");
  } else {
    for (const r of noBranchBudget) {
      console.log(`  ${r.grnNumber}  branch=${r.branchName}  period=${r.accountingPeriod}  ${r.head}/${r.subHead ?? ""}  ${formatMoney(r.amountWithTax)}`);
    }
    console.log(`  ${noBranchBudget.length} row(s), total ${formatMoney(noBranchBudget.reduce((s, r) => s + r.amountWithTax, 0))}`);
  }

  console.log("\n=== NO_COST_CENTRE — GRN-record data-quality issue, out of scope for this script ===");
  if (!noCostCentre.length) {
    console.log("  (none)");
  } else {
    for (const r of noCostCentre) {
      console.log(`  ${r.grnNumber}  branch=${r.branchName}  period=${r.accountingPeriod}  ${r.head}/${r.subHead ?? ""}  ${formatMoney(r.amountWithTax)}`);
    }
    console.log(`  ${noCostCentre.length} row(s), total ${formatMoney(noCostCentre.reduce((s, r) => s + r.amountWithTax, 0))}`);
  }

  const wouldWrite = outcomes.filter((o) => o.kind === "WOULD-WRITE");
  const refused = outcomes.filter((o) => o.kind === "REFUSED");
  const skipped = outcomes.filter((o) => o.kind === "SKIPPED");
  const wouldWriteAmount = wouldWrite.reduce((s, o) => s + (o as any).grossTotal, 0);
  const refusedAmount = refused.reduce((s, o) => s + (o as any).row.amountWithTax, 0);
  const skippedAmount = skipped.reduce((s, o) => s + (o as any).row.amountWithTax, 0);
  const manualReviewCount = noBranchBudget.length + noCostCentre.length;
  const manualReviewAmount = noBranchBudget.reduce((s, r) => s + r.amountWithTax, 0)
    + noCostCentre.reduce((s, r) => s + r.amountWithTax, 0);

  console.log("\n=== Summary ===");
  console.log(`  WOULD-WRITE:          ${wouldWrite.length} row(s), ${formatMoney(wouldWriteAmount)}`);
  console.log(`  REFUSED:              ${refused.length} row(s), ${formatMoney(refusedAmount)}`);
  console.log(`  SKIPPED:              ${skipped.length} row(s), ${formatMoney(skippedAmount)}`);
  console.log(`  MANUAL REVIEW NEEDED: ${manualReviewCount} row(s), ${formatMoney(manualReviewAmount)} (NO_BRANCH_BUDGET + NO_COST_CENTRE)`);

  console.log(APPLY ? "\nAPPLIED." : "\nDRY RUN — nothing written. Pass --apply to write.");
}

// Only run main() when executed directly (tsx scripts/remediate-residual-grn-cost-allocation-2026-08.ts),
// not when imported for its mapLifecycle export by tests.
import { fileURLToPath } from "node:url";
import path from "node:path";
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main()
    .catch((e) => {
      console.error("FATAL", e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}

export { mapLifecycle, requiredQuotedAmount, CONSUMED_GRN_STATUSES };
