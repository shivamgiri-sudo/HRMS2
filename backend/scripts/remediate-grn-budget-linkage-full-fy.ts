/**
 * Full remediation for the FY2026-27 GRN-to-budget linkage gap (see
 * hrms2-grn-cost-allocation-budget-blind-spot memory, and the 2026-08-22 investigation that
 * found the native monthly-budget system had only 6 headers total, all Aug/Sep 2026 — meaning
 * essentially no month of FY2026-27 had a real budget for most of this real, already-approved
 * vendor/imprest spend to link against).
 *
 * OWNER DECISION (2026-08-22): fix every month, not just the live one — including four already
 * -closed months (Apr-Jul 2026) and a handful of GRNs whose accounting_period is a genuinely
 * future period (Oct 2026 - Mar 2027), which are legitimate multi-month cost-recognition
 * splits of a single May-2026 bill (see grn-period-allocation.service.ts), not bad data.
 *
 * WHAT THIS DOES, per (branch, accounting_period):
 *   1. If no finance_budget_header exists for that branch+month, create one directly as
 *      status='active' (owner decision: write in already-active, skipping the Branch Head /
 *      Finance Head review chain — same bypass precedent as
 *      backfill-grn-cost-allocation-clean-match.ts, justified the same way: this is RECORDING
 *      spend that already, verifiably happened, not permitting new spend).
 *   2. Within that header, for each (cost_centre, head, sub_head) group of orphaned GRNs:
 *        - if no finance_budget_line exists, creates one sized to EXACTLY that month's real
 *          spend for that combo (no forward-looking buffer — a month-scoped line only ever
 *          needs to cover that month, unlike an annual figure).
 *        - if one exists but is short, tops it up by exactly the shortfall.
 *   3. Writes a grn_cost_allocation row per GRN and updates reserved_amount/consumed_amount,
 *      exactly mirroring the native reserve()/consume() bookkeeping — see budget-consumption
 *      .service.ts — but applied directly (bypassing lockActiveBudgetLine's header-status gate
 *      and the subhead-closure gate) for the same reason item 1 does.
 *
 * TAX SPLIT: reconstructed via calculateBudgetLine() (branch-budget.service.ts), solved for the
 * target gross the same way backfill-grn-cost-allocation-clean-match.ts already does — never
 * hand-derived, so the base/GST split matches what the native UI would have produced.
 *
 * The one gate kept (same as the earlier backfill): each write re-reads its line FOR UPDATE
 * inside its own transaction and refuses if the amount would push reserved+consumed past
 * gross_amount. Should never trigger here since lines are freshly sized to the group's exact
 * total demand, but a shared cost-centre/head/sub-head appearing in more than one group is not
 * assumed impossible.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. One transaction per (branch, period) header, so a
 * bad header never blocks the rest of the batch.
 */
import mysql, { type PoolConnection } from "mysql2/promise";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { calculateBudgetLine, type BudgetTaxTreatment } from "../src/modules/process-pnl/branch-budget.service.js";

const APPLY = process.argv.includes("--apply");
/** Distinct from MIGRATION_USER in the earlier backfill — this sentinel marks rows written by
 *  THIS remediation (2026-08-22), not the original db_bill migration, so an auditor can tell
 *  the two apart. */
const REMEDIATION_USER = "00000000-0000-0000-0000-budgetfix001";

function roundMoney(v: number) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

function unitRateForTargetGross(targetGross: number, taxTreatment: string, gstRate: number): number {
  if (["exclusive", "reverse_charge"].includes(taxTreatment) && gstRate > 0) {
    return roundMoney(targetGross / (1 + gstRate / 100));
  }
  return targetGross;
}

interface TargetGrn {
  grn_id: string; grn_number: string; status: string;
  branch_id: string; cost_centre_id: string; head: string; sub_head: string | null;
  accounting_period: string; financial_year: string;
  amount_with_tax: string; unit: string | null; process_id: string | null;
  tax_treatment: string; gst_rate: string; gst_type: string; recoverable_tax_pct: string;
}

async function fetchTargets(hrms: mysql.Connection): Promise<TargetGrn[]> {
  const [rows] = await hrms.query<any[]>(`
    SELECT g.id AS grn_id, g.grn_number, g.status, g.branch_id, g.cost_centre_id, g.head, g.sub_head,
           g.accounting_period, g.financial_year, g.amount_with_tax, g.unit, g.process_id,
           g.tax_treatment, g.gst_rate, g.gst_type, g.recoverable_tax_pct
      FROM grn_request g
     WHERE g.accounting_period >= '2026-04' AND g.accounting_period <= '2027-03'
       AND g.bill_source_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)
       AND g.status NOT IN ('draft', 'rejected', 'cancelled')
       AND g.cost_centre_id IS NOT NULL
  `);
  return rows;
}

type LineGroup = {
  key: string; branchId: string; period: string; costCentreId: string; head: string; subHead: string | null;
  grns: TargetGrn[]; demand: number;
};
type HeaderGroup = {
  branchId: string; period: string; financialYear: string;
  lineGroups: Map<string, LineGroup>;
};

function groupTargets(targets: TargetGrn[]): Map<string, HeaderGroup> {
  const headers = new Map<string, HeaderGroup>();
  for (const g of targets) {
    const hKey = `${g.branch_id}|${g.accounting_period}`;
    let h = headers.get(hKey);
    if (!h) { h = { branchId: g.branch_id, period: g.accounting_period, financialYear: g.financial_year, lineGroups: new Map() }; headers.set(hKey, h); }
    const lKey = `${g.cost_centre_id}|${g.head}|${g.sub_head ?? ""}`;
    let l = h.lineGroups.get(lKey);
    if (!l) { l = { key: lKey, branchId: g.branch_id, period: g.accounting_period, costCentreId: g.cost_centre_id, head: g.head, subHead: g.sub_head, grns: [], demand: 0 }; h.lineGroups.set(lKey, l); }
    l.grns.push(g);
    l.demand = roundMoney(l.demand + Number(g.amount_with_tax));
  }
  return headers;
}

async function generateBudgetNumber(conn: PoolConnection, branchId: string, periodCode: string, id: string): Promise<string> {
  const [rows] = await conn.execute<any[]>(`SELECT branch_seq FROM branch_master WHERE id = ? LIMIT 1`, [branchId]);
  const seq = Number(rows[0]?.branch_seq ?? 0);
  return `BUD/${seq}/${periodCode.replace("-", "")}/${id.slice(0, 8).toUpperCase()}`;
}

async function processHeader(pool: mysql.Pool, hrms: mysql.Connection, hg: HeaderGroup, log: string[]) {
  const connection: PoolConnection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingHeaderRows] = await connection.execute<any[]>(
      `SELECT * FROM finance_budget_header WHERE branch_id = ? AND period_code = ? FOR UPDATE`,
      [hg.branchId, hg.period]
    );
    let headerId: string;
    let headerIsNew = false;
    let headerTotals = { base: 0, tax: 0, gross: 0, pnl: 0 };
    if (existingHeaderRows[0]) {
      headerId = String(existingHeaderRows[0].id);
      headerTotals = {
        base: Number(existingHeaderRows[0].base_budget_amount), tax: Number(existingHeaderRows[0].tax_budget_amount),
        gross: Number(existingHeaderRows[0].gross_budget_amount), pnl: Number(existingHeaderRows[0].pnl_budget_amount),
      };
    } else {
      headerId = randomUUID();
      headerIsNew = true;
      const budgetNumber = await generateBudgetNumber(connection, hg.branchId, hg.period, headerId);
      if (APPLY) {
        await connection.execute(
          `INSERT INTO finance_budget_header
           (id, budget_number, branch_id, period_code, financial_year, status,
            base_budget_amount, tax_budget_amount, gross_budget_amount, pnl_budget_amount, created_by)
           VALUES (?,?,?,?,?,'active',0,0,0,0,?)`,
          [headerId, budgetNumber, hg.branchId, hg.period, hg.financialYear, REMEDIATION_USER]
        );
      }
    }

    for (const lg of hg.lineGroups.values()) {
      const [existingLineRows] = await connection.execute<any[]>(
        `SELECT * FROM finance_budget_line WHERE budget_id = ? AND cost_centre_id = ? AND head = ? AND (sub_head <=> ?) FOR UPDATE`,
        [headerId, lg.costCentreId, lg.head, lg.subHead]
      );
      let line = existingLineRows[0];
      let lineId: string;
      const sample = lg.grns[0];
      const taxTreatment = String(sample.tax_treatment) as BudgetTaxTreatment;
      const gstRate = Number(sample.gst_rate);
      const gstType = sample.gst_type as any;
      const recoverablePct = Number(sample.recoverable_tax_pct);
      const unit = sample.unit?.trim() || "Month";

      // Tracks the line's effective state (whether newly created or existing) independent of
      // APPLY, so the per-GRN allocation pass below always has real values to work with —
      // relying on a re-SELECT after an INSERT that dry-run mode deliberately never performs
      // was the bug that made every dry-run "NEW LINE" fail immediately after being logged.
      let effectiveLine: {
        unit: string; tax_treatment: string; gst_rate: number; gst_type: string; recoverable_tax_pct: number;
        head: string; sub_head: string | null; item_name: string;
        gross_amount: number; reserved_amount: number; consumed_amount: number;
      };

      if (!line) {
        lineId = randomUUID();
        const unitRate = unitRateForTargetGross(lg.demand, taxTreatment, gstRate);
        const values = calculateBudgetLine({
          head: lg.head, subHead: lg.subHead, itemName: `${lg.head}${lg.subHead ? " - " + lg.subHead : ""}`,
          quantity: 1, unit, unitRate, taxTreatment, gstRate, gstType, recoverableTaxPct: recoverablePct,
          justification: "Remediated 2026-08-22 — migrated GRN(s) with no native monthly budget line for this branch/period/head/sub-head. Sized to this month's real spend.",
        });
        log.push(`  NEW LINE  ${hg.branchId.slice(0,8)} ${hg.period} ${lg.head}/${lg.subHead ?? ""}  gross=${values.grossAmount}  (${lg.grns.length} GRNs)`);
        if (APPLY) {
          await connection.execute(
            `INSERT INTO finance_budget_line
             (id, budget_id, cost_centre_id, planning_level, process_id, head, sub_head,
              item_name, item_description, quantity, unit, unit_rate,
              tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
              cgst_amount, sgst_amount, igst_amount, base_amount, tax_amount,
              gross_amount, recoverable_tax_amount, pnl_cost_amount,
              justification, expenditure_type, alert_threshold_pct)
             VALUES (?,?,?,'cost_centre',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'opex',80)`,
            [
              lineId, headerId, lg.costCentreId, sample.process_id ?? null, lg.head, lg.subHead,
              `${lg.head}${lg.subHead ? " - " + lg.subHead : ""}`, null, 1, unit, unitRate,
              taxTreatment, gstRate, gstType, recoverablePct,
              values.cgstAmount, values.sgstAmount, values.igstAmount, values.baseAmount, values.taxAmount,
              values.grossAmount, values.recoverableTaxAmount, values.pnlCostAmount,
              "Remediated 2026-08-22 — migrated GRN(s) with no native monthly budget line for this branch/period/head/sub-head. Sized to this month's real spend.",
            ]
          );
        }
        headerTotals.base = roundMoney(headerTotals.base + values.baseAmount);
        headerTotals.tax = roundMoney(headerTotals.tax + values.taxAmount);
        headerTotals.gross = roundMoney(headerTotals.gross + values.grossAmount);
        headerTotals.pnl = roundMoney(headerTotals.pnl + values.pnlCostAmount);
        effectiveLine = {
          unit, tax_treatment: taxTreatment, gst_rate: gstRate, gst_type: gstType, recoverable_tax_pct: recoverablePct,
          head: lg.head, sub_head: lg.subHead, item_name: `${lg.head}${lg.subHead ? " - " + lg.subHead : ""}`,
          gross_amount: values.grossAmount, reserved_amount: 0, consumed_amount: 0,
        };
      } else {
        lineId = String(line.id);
        effectiveLine = {
          unit: String(line.unit), tax_treatment: String(line.tax_treatment), gst_rate: Number(line.gst_rate),
          gst_type: String(line.gst_type), recoverable_tax_pct: Number(line.recoverable_tax_pct),
          head: String(line.head), sub_head: line.sub_head, item_name: String(line.item_name),
          gross_amount: Number(line.gross_amount), reserved_amount: Number(line.reserved_amount), consumed_amount: Number(line.consumed_amount),
        };
        const available = roundMoney(Number(line.gross_amount) - Number(line.reserved_amount) - Number(line.consumed_amount));
        const shortfall = roundMoney(Math.max(0, lg.demand - available));
        if (shortfall > 0.01) {
          const lineTaxTreatment = String(line.tax_treatment);
          const lineGstRate = Number(line.gst_rate);
          const unitRate = unitRateForTargetGross(shortfall, lineTaxTreatment, lineGstRate);
          const values = calculateBudgetLine({
            head: String(line.head), subHead: line.sub_head, itemName: String(line.item_name),
            quantity: 1, unit: String(line.unit), unitRate, taxTreatment: lineTaxTreatment as BudgetTaxTreatment,
            gstRate: lineGstRate, gstType: line.gst_type, recoverableTaxPct: Number(line.recoverable_tax_pct),
            justification: "topup",
          });
          log.push(`  TOP-UP    ${hg.branchId.slice(0,8)} ${hg.period} ${lg.head}/${lg.subHead ?? ""}  +${values.grossAmount} (was avail ${available}, demand ${lg.demand})`);
          if (APPLY) {
            await connection.execute(
              `UPDATE finance_budget_line
                  SET base_amount = base_amount + ?, tax_amount = tax_amount + ?,
                      gross_amount = gross_amount + ?, recoverable_tax_amount = recoverable_tax_amount + ?,
                      pnl_cost_amount = pnl_cost_amount + ?,
                      cgst_amount = cgst_amount + ?, sgst_amount = sgst_amount + ?, igst_amount = igst_amount + ?
                WHERE id = ?`,
              [values.baseAmount, values.taxAmount, values.grossAmount, values.recoverableTaxAmount,
               values.pnlCostAmount, values.cgstAmount, values.sgstAmount, values.igstAmount, lineId]
            );
          }
          headerTotals.base = roundMoney(headerTotals.base + values.baseAmount);
          headerTotals.tax = roundMoney(headerTotals.tax + values.taxAmount);
          headerTotals.gross = roundMoney(headerTotals.gross + values.grossAmount);
          headerTotals.pnl = roundMoney(headerTotals.pnl + values.pnlCostAmount);
          effectiveLine.gross_amount = roundMoney(effectiveLine.gross_amount + values.grossAmount);
        }
      }

      // Per-GRN allocation, using the LINE's own tax profile (fresh or existing) so every
      // row's split is internally consistent with the line it's charged against. Tracked via
      // effectiveLine in-memory rather than a re-SELECT — a freshly-created line has nothing to
      // re-select in dry-run mode (never inserted), and the in-memory running total gives an
      // accurate preview of any REFUSED case either way, not just after --apply.
      for (const g of lg.grns) {
        const amt = roundMoney(Number(g.amount_with_tax));
        if (amt <= 0) continue;
        const lineTaxTreatment = effectiveLine.tax_treatment;
        const lineGstRate = effectiveLine.gst_rate;
        const unitRate = unitRateForTargetGross(amt, lineTaxTreatment, lineGstRate);
        const values = calculateBudgetLine({
          head: effectiveLine.head, subHead: effectiveLine.sub_head, itemName: effectiveLine.item_name,
          quantity: 1, unit: effectiveLine.unit, unitRate, taxTreatment: lineTaxTreatment as BudgetTaxTreatment,
          gstRate: lineGstRate, gstType: effectiveLine.gst_type as any, recoverableTaxPct: effectiveLine.recoverable_tax_pct,
          justification: "alloc",
        });

        let lifecycle: "draft" | "reserved" | "consumed" = "draft";
        if (g.status === "submitted") lifecycle = "draft";
        else if (g.status === "branch_head_approved") lifecycle = "reserved";
        else if (g.status === "finance_head_approved" || g.status === "paid") lifecycle = "consumed";

        const avail = roundMoney(effectiveLine.gross_amount - effectiveLine.reserved_amount - effectiveLine.consumed_amount);
        if (lifecycle !== "draft" && values.grossAmount > avail + 0.01) {
          log.push(`  REFUSED   ${g.grn_number}: exceeds available by ${(values.grossAmount - avail).toFixed(2)}`);
          continue;
        }
        if (lifecycle === "reserved") effectiveLine.reserved_amount = roundMoney(effectiveLine.reserved_amount + values.grossAmount);
        else if (lifecycle === "consumed") effectiveLine.consumed_amount = roundMoney(effectiveLine.consumed_amount + values.grossAmount);

        if (APPLY) {
          if (lifecycle === "reserved") {
            await connection.execute(`UPDATE finance_budget_line SET reserved_amount = reserved_amount + ?, reserved_quantity = reserved_quantity + 1 WHERE id = ?`, [values.grossAmount, lineId]);
          } else if (lifecycle === "consumed") {
            await connection.execute(`UPDATE finance_budget_line SET consumed_amount = consumed_amount + ?, consumed_quantity = consumed_quantity + 1 WHERE id = ?`, [values.grossAmount, lineId]);
          }
          const now = lifecycle !== "draft" ? new Date() : null;
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
              randomUUID(), g.grn_id, headerId, lineId, g.branch_id, g.process_id ?? null, g.cost_centre_id, "direct",
              effectiveLine.unit, unitRate, lineTaxTreatment, lineGstRate, effectiveLine.gst_type,
              effectiveLine.recoverable_tax_pct, values.baseAmount, values.taxAmount, values.cgstAmount,
              values.sgstAmount, values.igstAmount, values.grossAmount, values.recoverableTaxAmount,
              values.pnlCostAmount, lifecycle, "Remediated 2026-08-22 — full-FY GRN-to-budget linkage fix",
              lifecycle === "reserved" ? now : null, lifecycle === "consumed" ? now : null, REMEDIATION_USER,
            ]
          );
        }
      }
    }

    if (APPLY) {
      await connection.execute(
        `UPDATE finance_budget_header SET base_budget_amount=?, tax_budget_amount=?, gross_budget_amount=?, pnl_budget_amount=? WHERE id=?`,
        [headerTotals.base, headerTotals.tax, headerTotals.gross, headerTotals.pnl, headerId]
      );
    }

    await connection.commit();
    log.push(`OK header ${hg.branchId.slice(0,8)} ${hg.period} (${headerIsNew ? "NEW" : "existing"}) — ${hg.lineGroups.size} line group(s)`);
  } catch (error) {
    await connection.rollback();
    log.push(`FAILED header ${hg.branchId.slice(0,8)} ${hg.period}: ${error instanceof Error ? error.message : String(error)}`);
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
    const targets = await fetchTargets(hrms);
    const headers = groupTargets(targets);
    console.log(`GRNs in scope: ${targets.length}`);
    console.log(`Total amount: ${targets.reduce((s, t) => s + Number(t.amount_with_tax), 0).toFixed(2)}`);
    console.log(`Header groups (branch x month): ${headers.size}\n`);

    const log: string[] = [];
    for (const hg of headers.values()) {
      await processHeader(pool, hrms, hg, log);
    }
    console.log(log.join("\n"));
    console.log(APPLY ? "\nAPPLIED." : "\nDRY RUN — nothing written. Pass --apply to write.");
  } finally {
    await hrms.end();
    await pool.end();
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
