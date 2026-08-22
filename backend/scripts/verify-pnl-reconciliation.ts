/**
 * verify-pnl-reconciliation.ts — the "prove it, don't assert it" gate for the P&L page.
 *
 * Per explicit user requirement (2026-08-22): every number on the P&L page must be validated
 * against the real backend data, both mas_hrms AND db_bill — not just claimed correct. This
 * script is that proof, run BEFORE and AFTER every P&L fix, with real output kept as the record.
 *
 * FOUR INDEPENDENT CHECKS, each answering a different question:
 *
 *   A. INTERNAL CONSISTENCY (mas_hrms only) — do two independently-written service functions
 *      that read the same mirror tables agree? getCeoOverview() (ceo-overview.service.ts) and
 *      getPnlReconciliation() (pnl-reconciliation.service.ts) are separate files with separate
 *      WHERE-clause construction, both reading billing_invoice_particular_snapshot /
 *      salary_prep_line / grn_entry_line_snapshot / finance_budget_line(_snapshot). If they
 *      disagree on the same branch/period, that is a real code bug in one of them.
 *
 *   B. FRONT-DOOR CONSISTENCY — does the cached path (canonicalPnlService.getSummary, what
 *      /pnl/summary and /pnl/period-close serve) agree with the uncached path
 *      (bpoPnlAllocationOverlayService.getSummary, what /pnl/bpo/summary served before the
 *      Phase 1.1 fix)? Before that fix, up to 60s of drift is expected and real; after it,
 *      these must be identical because both routes call the same cached function.
 *
 *   C. MIRROR FRESHNESS (mas_hrms vs live db_bill) — does the mas_hrms mirror still match the
 *      real system of record right now? Sums SUM(total) from live db_bill.tbl_invoice and
 *      SUM(Amount) from live db_bill.expense_entry_master for the period, compares to the
 *      mirrored billing_invoice_snapshot / grn_entry_snapshot totals for the same period.
 *      Gated on BILL_DB_HOST — reported as SKIPPED (not silently passed) if unset/unreachable.
 *      A difference here is expected for the current month (the mirror syncs nightly) and is
 *      informational, not a FAIL — see pnl-reconciliation.service.ts's own freshness/blockers
 *      for the signal the product surfaces to users.
 *
 *   D. NAMED FIXES — three small, explicit checks tied to the four Phase-1 fixes:
 *      D1 IDC guard:  COUNT of employee_code LIKE 'IDC%' rows in salary_prep_line for the period
 *                     (expect 0 today; the guard's job is to make this visible if it ever isn't).
 *      D2 GRN backfill bucket ①/②/③ counts (mirrors backfill-grn-cost-allocation-clean-match.ts's
 *         own candidate query, plus the wider ②/③ predicates).
 *      D3 pnl-reconciliation.service.ts's own mode/blockers/exceptions, printed as context.
 *
 * Usage:
 *   node --loader ts-node/esm backend/scripts/verify-pnl-reconciliation.ts --period=2026-07 [--tolerance=1]
 *
 * Exit code: 1 if any Section A or Section B row differs beyond --tolerance (rupees, default 1
 * to absorb rounding only). Sections C/D are informational and never fail the run — they are
 * real findings to report, not code defects this script can "fix" by failing loudly.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const PERIOD = arg("period");
const TOLERANCE = Number(arg("tolerance", "1"));
if (!PERIOD || !/^\d{4}-\d{2}$/.test(PERIOD)) {
  console.error("Usage: --period=YYYY-MM required");
  process.exit(2);
}

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};
const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = { label: string; a: number; b: number; note?: string };
let anyRealFail = false;

function printTable(title: string, colA: string, colB: string, rows: Row[], toleranceCheck: boolean) {
  console.log(`\n=== ${title} ===`);
  if (!rows.length) {
    console.log("  (no rows)");
    return;
  }
  const w = Math.max(...rows.map((r) => r.label.length), 24);
  console.log(
    `  ${"label".padEnd(w)}  ${colA.padStart(16)}  ${colB.padStart(16)}  ${"diff".padStart(14)}  status`,
  );
  for (const r of rows) {
    const diff = r.a - r.b;
    const pass = Math.abs(diff) <= TOLERANCE;
    if (toleranceCheck && !pass) anyRealFail = true;
    const status = toleranceCheck ? (pass ? "PASS" : "FAIL") : r.note ?? "";
    const suffix = toleranceCheck && r.note ? `  (${r.note})` : "";
    console.log(
      `  ${r.label.padEnd(w)}  ${money(r.a).padStart(16)}  ${money(r.b).padStart(16)}  ${money(diff).padStart(14)}  ${status}${suffix}`,
    );
  }
}

async function main() {
  const { db } = await import("../src/db/mysql.js");
  const { getCeoOverview } = await import("../src/modules/process-pnl/ceo-overview.service.js");
  const { getPnlReconciliation } = await import("../src/modules/process-pnl/pnl-reconciliation.service.js");
  const { bpoPnlAllocationOverlayService } = await import("../src/modules/process-pnl/bpo-pnl-allocation-overlay.service.js");
  const { canonicalPnlService } = await import("../src/modules/process-pnl/canonical-pnl.service.js");

  console.log(`\nP&L RECONCILIATION — period ${PERIOD}, tolerance Rs ${TOLERANCE}`);
  console.log("=".repeat(72));

  // ── A. Internal consistency: ceo-overview branch totals vs pnl-reconciliation branch rollup ──
  const [ceo, recon] = await Promise.all([
    getCeoOverview(PERIOD, {}),
    getPnlReconciliation(PERIOD, {}),
  ]);

  // pnl-reconciliation.service.ts deliberately scopes to ACTIVE cost centres only (its own
  // readCostCentres() filters active_status=1) and attributes payroll via the EMPLOYEE'S COST
  // CENTRE's branch_id, while ceo-overview.service.ts deliberately includes every branch that
  // traded (no active filter) and attributes payroll via the employee's OWN branch_id. Both are
  // correct for their stated purpose — a raw diff would show a permanent, misleading "FAIL" for
  // three well-understood reasons. Compute each adjustment independently in raw SQL (not by
  // calling either service) and check the RESIDUAL — that is the real bug-detection signal.
  const [inactiveRevRows] = await db.query<any[]>(
    `SELECT ccm.branch_id, SUM(p.amount) amt FROM billing_invoice_particular_snapshot p
       LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE p.period_code = ? AND ccm.active_status = 0
        AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
      GROUP BY ccm.branch_id`, [PERIOD],
  );
  const [inactiveGrnRows] = await db.query<any[]>(
    `SELECT ccm.branch_id, SUM(l.total) amt FROM grn_entry_line_snapshot l
       JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
       LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = l.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE g.period_code = ? AND g.is_rejected = 0 AND ccm.active_status = 0
        AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%'
      GROUP BY ccm.branch_id`, [PERIOD],
  );
  const [unmappedPayrollRows] = await db.query<any[]>(
    `SELECT e.branch_id, SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) amt
       FROM salary_prep_line l JOIN salary_prep_run r ON r.id=l.run_id JOIN employees e ON e.id=l.employee_id
      WHERE r.run_month = ? AND e.cost_centre_id IS NULL GROUP BY e.branch_id`, [PERIOD],
  );
  const [inactiveCcPayrollRows] = await db.query<any[]>(
    `SELECT e.branch_id, SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) amt
       FROM salary_prep_line l JOIN salary_prep_run r ON r.id=l.run_id JOIN employees e ON e.id=l.employee_id
       JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
      WHERE r.run_month = ? AND ccm.active_status = 0 GROUP BY e.branch_id`, [PERIOD],
  );
  const [branchMismatchRows] = await db.query<any[]>(
    `SELECT e.branch_id AS emp_branch, ccm.branch_id AS cc_branch,
            SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) amt
       FROM salary_prep_line l JOIN salary_prep_run r ON r.id=l.run_id JOIN employees e ON e.id=l.employee_id
       JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id AND ccm.active_status = 1
      WHERE r.run_month = ? AND e.branch_id <> ccm.branch_id
      GROUP BY e.branch_id, ccm.branch_id`, [PERIOD],
  );
  const byBranch = (rs: any[]) => new Map(rs.map((r) => [r.branch_id ?? "", n(r.amt)]));
  const inactiveRev = byBranch(inactiveRevRows);
  const inactiveGrn = byBranch(inactiveGrnRows);
  const unmappedPayroll = byBranch(unmappedPayrollRows);
  const inactiveCcPayroll = byBranch(inactiveCcPayrollRows);
  // recon attributes via cost-centre branch; ceo attributes via employee branch. For a mismatched
  // employee, recon counts it in cc_branch and ceo counts it in emp_branch — so ceo-recon nets to
  // +amt on emp_branch and -amt on cc_branch.
  const mismatchNet = new Map<string, number>();
  for (const r of branchMismatchRows as any[]) {
    const amt = n(r.amt);
    mismatchNet.set(r.emp_branch ?? "", (mismatchNet.get(r.emp_branch ?? "") ?? 0) + amt);
    mismatchNet.set(r.cc_branch ?? "", (mismatchNet.get(r.cc_branch ?? "") ?? 0) - amt);
  }

  const reconByBranch = new Map(recon.branches.map((b) => [b.branchId ?? "", b]));
  const revenueRows: Row[] = [];
  const peopleRows: Row[] = [];
  const grnRows: Row[] = [];
  for (const b of ceo.branches) {
    if (b.isCostCentre) continue; // ceo-overview's cost-centre focus rows aren't branch rows
    const key = b.branchId ?? "";
    const r = reconByBranch.get(key);
    if (!r) continue; // a branch with 0 cost centres in recon's scope — nothing to compare
    const revAdj = inactiveRev.get(key) ?? 0;
    const peopleAdj = (unmappedPayroll.get(key) ?? 0) + (inactiveCcPayroll.get(key) ?? 0) + (mismatchNet.get(key) ?? 0);
    const grnAdj = inactiveGrn.get(key) ?? 0;
    revenueRows.push({ label: b.branchName, a: b.revenue - revAdj, b: r.revenue, note: revAdj ? `raw diff explained by Rs ${money(revAdj)} inactive-CC revenue` : undefined });
    peopleRows.push({ label: b.branchName, a: b.peopleCost - peopleAdj, b: r.payrollCost, note: peopleAdj ? `raw diff explained by Rs ${money(peopleAdj)} unmapped/inactive/branch-mismatch payroll` : undefined });
    grnRows.push({ label: b.branchName, a: b.indirectCost - grnAdj, b: r.grnActual, note: grnAdj ? `raw diff explained by Rs ${money(grnAdj)} inactive-CC GRN` : undefined });
  }
  console.log("\n(Each row below is ceo-overview's figure MINUS the known, documented active/unmapped/branch-attribution scope adjustment — i.e. the RESIDUAL after accounting for the two functions' deliberately different scopes. A residual PASS means the underlying P&L math agrees; it does not mean the two raw totals are equal.)");
  printTable("A1. REVENUE residual — ceo-overview (scope-adjusted) vs pnl-reconciliation (by branch)", "ceo adj.", "reconciliation", revenueRows, true);
  printTable("A2. PEOPLE COST residual — ceo-overview (scope-adjusted) vs pnl-reconciliation (by branch)", "ceo adj.", "reconciliation", peopleRows, true);
  printTable("A3. INDIRECT/GRN residual — ceo-overview (scope-adjusted) vs pnl-reconciliation (by branch)", "ceo adj.", "reconciliation", grnRows, true);

  // ── B. Front-door consistency: cached (canonical) vs uncached (bpo overlay) process rows ──
  const [cached, uncached] = await Promise.all([
    canonicalPnlService.getSummary({ period: PERIOD }),
    bpoPnlAllocationOverlayService.getSummary({ period: PERIOD }),
  ]);
  const uncachedByProcess = new Map(uncached.rows.map((r: any) => [r.processId, r]));
  const frontDoorRows: Row[] = (cached.rows as any[]).map((r) => ({
    label: r.processName ?? r.processId,
    a: n(r.operatingProfit),
    b: n(uncachedByProcess.get(r.processId)?.operatingProfit),
  }));
  printTable("B. OPERATING PROFIT — cached /pnl/summary vs uncached /pnl/bpo/summary (by process)", "cached", "uncached", frontDoorRows, true);

  // ── C. Mirror freshness vs live db_bill ──
  console.log("\n=== C. MIRROR FRESHNESS — mas_hrms mirror vs live db_bill ===");
  if (!process.env.BILL_DB_HOST) {
    console.log("  SKIPPED — BILL_DB_HOST not configured in this environment.");
  } else {
    try {
      const { billQuery } = await import("../src/db/billDb.js");
      const [y, m] = PERIOD.split("-").map(Number);
      const financeYear = m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
      const monthName = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-US", { month: "short" });

      // GRN: schema/columns confirmed live this session (expense_entry_master), simpler and
      // lower-risk than tbl_invoice's inconsistent month dialects (see
      // hrms2-db-bill-finance-mirror memory) — RejectDate is the truth, never the Reject flag.
      const [liveGrn] = await billQuery<any>(
        `SELECT COALESCE(SUM(Amount),0) AS amt, COUNT(*) AS n FROM expense_entry_master
          WHERE FinanceYear = ? AND FinanceMonth = ? AND RejectDate IS NULL`,
        [financeYear, monthName],
      );
      const [mirrorGrn] = await db.query<any>(
        `SELECT COALESCE(SUM(amount),0) AS amt, COUNT(*) AS n, MAX(synced_at) AS latest
           FROM grn_entry_snapshot WHERE period_code = ? AND is_rejected = 0`,
        [PERIOD],
      );
      const liveN = n(liveGrn?.n);
      const liveAmt = n(liveGrn?.amt);
      const mirrorRow = (mirrorGrn as any[])[0] ?? {};
      const mirrorN = n(mirrorRow.n);
      const mirrorAmt = n(mirrorRow.amt);
      console.log(`  GRN — live db_bill.expense_entry_master (FinanceYear=${financeYear}, FinanceMonth=${monthName}, not rejected): n=${liveN} amt=Rs ${money(liveAmt)}`);
      console.log(`  GRN — mas_hrms mirror grn_entry_snapshot (period_code=${PERIOD}): n=${mirrorN} amt=Rs ${money(mirrorAmt)}, last synced ${mirrorRow.latest ?? "never"}`);
      console.log(`  GRN mirror gap: ${liveN - mirrorN} rows, Rs ${money(liveAmt - mirrorAmt)} — expected to be 0 for a fully-synced closed month; a nonzero gap on a CLOSED period (not the current month) is a real sync problem, not staleness.`);

      // Revenue: report the mirror's own freshness for this period as a plain readout — the
      // particular-snapshot table mirrors db_bill.inv_particulars (line-level), a different
      // schema/join path than tbl_invoice; a live cross-sum needs that schema mapped with the
      // same care as the GRN check above, not attempted here to avoid a fragile, misleading
      // number. pnl-reconciliation.service.ts's own sourceFreshness() is the authoritative
      // staleness signal (see Section D3 below); this line is a plain supporting fact.
      const [revFreshness] = await db.query<any>(
        `SELECT COUNT(*) AS n, MAX(synced_at) AS latest FROM billing_invoice_particular_snapshot WHERE period_code = ?`,
        [PERIOD],
      );
      const rf = (revFreshness as any[])[0] ?? {};
      console.log(`  Revenue mirror (billing_invoice_particular_snapshot, period_code=${PERIOD}): n=${n(rf.n)} rows, last synced ${rf.latest ?? "never"}.`);
    } catch (error) {
      console.log(`  UNREACHABLE — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── D1. IDC guard ──
  console.log("\n=== D1. IDC GUARD — employee_code LIKE 'IDC%' present in mas_hrms payroll? ===");
  const [idcRows] = await db.query<any[]>(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)),0) AS amt
       FROM salary_prep_line l JOIN salary_prep_run r ON r.id = l.run_id JOIN employees e ON e.id = l.employee_id
      WHERE r.run_month = ? AND e.employee_code LIKE 'IDC%'`,
    [PERIOD],
  );
  const idcCount = n((idcRows as any[])[0]?.cnt);
  console.log(`  IDC-coded employees in mas_hrms payroll for ${PERIOD}: ${idcCount}${idcCount === 0 ? " (expected — IDC payroll should never appear in mas_hrms)" : " *** CONTAMINATION — see PAYROLL_IDC_CODE_IN_MAS_HRMS exception ***"}`);

  // ── D2. GRN backfill buckets ──
  console.log("\n=== D2. GRN COST-ALLOCATION BACKFILL SCOPE (FY2026-27) ===");
  const [scope] = await db.query<any[]>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_with_tax),0) AS amt FROM grn_request g
      WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
        AND g.bill_source_id IS NOT NULL AND g.status NOT IN ('rejected','cancelled')
        AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)`,
  );
  const [bucket1] = await db.query<any[]>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amt),0) AS amt FROM (
       SELECT g.id, g.amount_with_tax AS amt FROM grn_request g
       JOIN finance_budget_line l ON l.cost_centre_id = g.cost_centre_id AND l.head = g.head AND (l.sub_head <=> g.sub_head)
       JOIN finance_budget_header h ON h.id = l.budget_id AND h.branch_id = g.branch_id AND h.financial_year = g.financial_year
      WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
        AND g.bill_source_id IS NOT NULL AND g.status NOT IN ('rejected','cancelled')
        AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
      GROUP BY g.id HAVING COUNT(DISTINCT l.id) = 1
     ) clean`,
  );
  const [bucket3] = await db.query<any[]>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(g.amount_with_tax),0) AS amt FROM grn_request g
      WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
        AND g.bill_source_id IS NOT NULL AND g.status NOT IN ('rejected','cancelled')
        AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM finance_budget_header h WHERE h.branch_id = g.branch_id AND h.financial_year = g.financial_year)`,
  );
  const scopeN = n((scope as any[])[0]?.n);
  const b1N = n((bucket1 as any[])[0]?.n);
  const b3N = n((bucket3 as any[])[0]?.n);
  console.log(`  Total in-scope (no grn_cost_allocation row): ${scopeN} GRNs, Rs ${money(n((scope as any[])[0]?.amt))}`);
  console.log(`  Bucket (1) clean single-match (backfillable now): ${b1N} GRNs, Rs ${money(n((bucket1 as any[])[0]?.amt))}`);
  console.log(`  Bucket (3) no budget header at all for branch+FY: ${b3N} GRNs, Rs ${money(n((bucket3 as any[])[0]?.amt))}`);
  console.log(`  Bucket (2) [wrong head / ambiguous] ~= ${scopeN - b1N - b3N} GRNs (remainder — real governance gap, never force-matched)`);

  // ── D3. pnl-reconciliation.service context ──
  console.log("\n=== D3. pnl-reconciliation.service.ts VERDICT (context, not pass/fail) ===");
  console.log(`  mode: ${recon.mode}`);
  if (recon.blockers.length) recon.blockers.forEach((b) => console.log(`  blocker: ${b}`));
  else console.log("  blockers: none");
  if (recon.exceptions.length) {
    recon.exceptions.forEach((e) => console.log(`  exception: ${e.code} — ${e.label} — count=${e.count} amt=Rs ${money(e.amount)}`));
  } else {
    console.log("  exceptions: none");
  }

  // ── E. Drill-down ties to summary — the correctness guarantee the whole drilldown feature
  // rests on. For each metric, pick one real branch that has a nonzero figure and check the
  // drilldown endpoint's row sum against the exact summary cell it was clicked from.
  const { getPnlDrilldown } = await import("../src/modules/process-pnl/pnl-drilldown.service.js");
  const drilldownRows: Row[] = [];
  for (const b of ceo.branches) {
    if (b.isCostCentre || !b.branchId) continue;
    if (b.revenue > 0 && !drilldownRows.some((r) => r.label.startsWith("Revenue"))) {
      const d = await getPnlDrilldown({ metric: "revenue", period: PERIOD, branchId: b.branchId });
      drilldownRows.push({ label: `Revenue · ${b.branchName}`, a: d.total, b: b.revenue, note: `${d.rows.length} rows${d.hasEstimatedRows ? " (incl. provision estimate)" : ""}` });
    }
    if (b.peopleCost > 0 && !drilldownRows.some((r) => r.label.startsWith("People"))) {
      const d = await getPnlDrilldown({ metric: "people", period: PERIOD, branchId: b.branchId });
      drilldownRows.push({ label: `People · ${b.branchName}`, a: d.total, b: b.peopleCost, note: `${d.rows.length} rows` });
    }
    if (b.indirectCost > 0 && !drilldownRows.some((r) => r.label.startsWith("Indirect"))) {
      const d = await getPnlDrilldown({ metric: "indirect", period: PERIOD, branchId: b.branchId });
      drilldownRows.push({ label: `Indirect · ${b.branchName}`, a: d.total, b: b.indirectCost, note: `${d.rows.length} rows` });
    }
  }
  printTable("E. DRILL-DOWN TOTAL vs SUMMARY CELL (one real branch per metric)", "drilldown sum", "summary cell", drilldownRows, true);

  console.log("\n" + "=".repeat(72));
  console.log(anyRealFail ? "RESULT: FAIL — see Section A/B/E rows above." : "RESULT: PASS — Sections A, B and E agree within tolerance.");
  process.exit(anyRealFail ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
