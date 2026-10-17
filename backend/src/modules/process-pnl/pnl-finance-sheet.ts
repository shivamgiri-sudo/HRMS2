import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import type { PeopleCostByKey, PnlPeopleBucket } from "./pnl-running-salary.service.js";

/**
 * FINANCE'S MAS CALLNET P&L SHEET, for the months Finance closed in db_bill (owner rule 2026-10-17).
 *
 * Before 2026-10 Finance kept the books in db_bill and published the P&L as a sheet
 * ("MAS-Projection 2026-27 G-Sheet"), loaded into pnl_finance_sheet_line by
 * scripts/import-finance-pnl-sheet.mjs. For those months the HRMS P&L follows it:
 *
 *  - SALARY is the sheet's: agents from db_bill pay, DSC/BMC from Finance's per-employee lists (type,
 *    process and CTC basis), which exist only in the sheet. HRMS payroll is not read for these months.
 *  - INDIRECT COST stays the db_bill GRNs (readGrnSpend leg 3) plus a "Finance allocation" (leg 5):
 *    what the sheet carries that db_bill does not — computer hire charged between group companies,
 *    shared-building rent and CAM split across Onfido and NOD, monthly accruals. It is the sheet's
 *    IDC minus the db_bill GRNs without asset sub-heads, so with MAS Callnet asset purchases kept in
 *    (owner) the P&L reads sheet IDC + asset purchases.
 *  - REVENUE is db_bill's invoices plus a "Finance revenue adjustment": the sheet's revenue minus the invoices, per
 *    process. Finance books some lines differently from the invoice (Onfido labelling FTEs at delivered, not billed;
 *    Viega, invoiced on a DialDesk-coded cost centre HRMS keeps out; ALTRX, SCPT, Wedding Invitation, which db_bill has
 *    no MAS Callnet invoice for), so the P&L reads the sheet's revenue with the invoice as its visible base.
 *
 * From 2026-10 Finance works in HRMS and none of this applies.
 */
export const FINANCE_SHEET_LAST_PERIOD = "2026-09";

export const isFinanceSheetPeriod = (period: string): boolean =>
  /^\d{4}-\d{2}$/.test(period) && period <= FINANCE_SHEET_LAST_PERIOD;

export interface FinanceSheetLine {
  sheetBranch: string;
  sheetProcess: string;
  branchId: string | null;
  processId: string | null;
  revenue: number;
  agentSalary: number;
  dscSalary: number;
  bmcSalary: number;
  idcTotal: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function readFinanceSheetLines(period: string): Promise<FinanceSheetLine[]> {
  if (!isFinanceSheetPeriod(period) || !(await tableExists("pnl_finance_sheet_line"))) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sheet_branch, sheet_process, branch_id, process_id, revenue, agent_salary, dsc_salary, bmc_salary, idc_total
       FROM pnl_finance_sheet_line WHERE period_code = ?`,
    [period],
  );
  return rows.map((r) => ({
    sheetBranch: String(r.sheet_branch),
    sheetProcess: String(r.sheet_process),
    branchId: r.branch_id ? String(r.branch_id) : null,
    processId: r.process_id ? String(r.process_id) : null,
    revenue: n(r.revenue),
    agentSalary: n(r.agent_salary),
    dscSalary: n(r.dsc_salary),
    bmcSalary: n(r.bmc_salary),
    idcTotal: n(r.idc_total),
  }));
}

const addBuckets = (into: Map<string, Record<PnlPeopleBucket, number>>, key: string, line: FinanceSheetLine) => {
  const cur = into.get(key) ?? { agent_salary: 0, dsc_people: 0, bmc_people: 0 };
  into.set(key, {
    agent_salary: cur.agent_salary + line.agentSalary,
    dsc_people: cur.dsc_people + line.dscSalary,
    bmc_people: cur.bmc_people + line.bmcSalary,
  });
};

/**
 * The sheet's salary as people cost, or null when the period is not a Finance-sheet month or the sheet
 * has not been loaded for it (then the caller keeps HRMS payroll). A sheet process with no HRMS process
 * counts in its branch only.
 */
export async function readFinanceSheetPeopleCost(period: string): Promise<PeopleCostByKey | null> {
  const lines = await readFinanceSheetLines(period);
  if (!lines.length) return null;
  const out: PeopleCostByKey = {
    byBranch: new Map(),
    byProcess: new Map(),
    coverageByBranch: new Map(),
    coverageByProcess: new Map(),
    asOfDate: null,
    fromFinanceSheet: true,
  };
  for (const line of lines) {
    if (line.branchId) addBuckets(out.byBranch, line.branchId, line);
    if (line.processId) addBuckets(out.byProcess, line.processId, line);
  }
  return out;
}

export interface FinanceAllocationRow {
  branchId: string;
  processId: string | null;
  amount: number;
}

/**
 * Leg 5 of readGrnSpend: per branch and process, the sheet's IDC minus the db_bill GRNs without asset
 * sub-heads (`operatingSpend`, keyed "branch|process", "" for no process). Every mapped sheet process gets
 * its own row; what the sheet keeps at branch level, and db_bill GRNs on processes the sheet does not
 * name, settle in one branch row. Per branch the rows sum to sheet IDC - db_bill operating GRNs exactly.
 * Rows can be negative: Finance spreads shared costs by seats, db_bill books them to one cost centre.
 */
export function financeAllocationRows(
  lines: FinanceSheetLine[],
  operatingSpend: Map<string, number>,
): FinanceAllocationRow[] {
  return sheetLessBookRows(lines, (line) => line.idcTotal, operatingSpend);
}

/**
 * The Finance revenue adjustment: per branch and process, the sheet's revenue minus what HRMS books from db_bill's
 * invoices (`invoiced`, keyed "branch|process", "" for no process). Same shape and rules as financeAllocationRows.
 */
export function financeRevenueAdjustmentRows(
  lines: FinanceSheetLine[],
  invoiced: Map<string, number>,
): FinanceAllocationRow[] {
  return sheetLessBookRows(lines, (line) => line.revenue, invoiced);
}

function sheetLessBookRows(
  lines: FinanceSheetLine[],
  pick: (line: FinanceSheetLine) => number,
  operatingSpend: Map<string, number>,
): FinanceAllocationRow[] {
  const sheetByKey = new Map<string, number>();
  const branches = new Set<string>();
  for (const line of lines) {
    if (!line.branchId) continue;
    branches.add(line.branchId);
    const key = `${line.branchId}|${line.processId ?? ""}`;
    sheetByKey.set(key, (sheetByKey.get(key) ?? 0) + pick(line));
  }
  const out: FinanceAllocationRow[] = [];
  for (const branchId of branches) {
    let sheetBranch = 0;
    let grnBranch = 0;
    for (const [key, amount] of sheetByKey) if (key.startsWith(`${branchId}|`)) sheetBranch += amount;
    for (const [key, amount] of operatingSpend) if (key.startsWith(`${branchId}|`)) grnBranch += amount;
    let assigned = 0;
    for (const [key, sheetAmount] of sheetByKey) {
      const [b, processId] = key.split("|");
      if (b !== branchId || !processId) continue;
      const amount = sheetAmount - (operatingSpend.get(key) ?? 0);
      assigned += amount;
      if (Math.abs(amount) >= 0.005) out.push({ branchId, processId, amount });
    }
    const rest = sheetBranch - grnBranch - assigned;
    if (Math.abs(rest) >= 0.005) out.push({ branchId, processId: null, amount: rest });
  }
  return out;
}

/**
 * The cost centre a mapped sheet process is booked to on cost-centre views (Live P&L, cost-centre scope on CEO Overview):
 * the process's own MAS Callnet cost centre that db_bill knows (bill_source_id), first by code. A process with no cost centre keeps
 * its money at branch level.
 */
export async function financeSheetCostCentres(processIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(processIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, id FROM cost_centre_master
      WHERE process_id IN (${ids.map(() => "?").join(",")})
        -- MAS Callnet cost centres only: Bla Bli Blu's first cost centre is an IDC one (BSS/IB/NOIDA-DD/985), which Live P&L
        -- does not list, so Rs 5.66 L of its April salary vanished there.
        AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'
      ORDER BY process_id, (bill_source_id IS NULL), cost_centre_code, id`,
    ids,
  );
  for (const r of rows) if (!out.has(String(r.process_id))) out.set(String(r.process_id), String(r.id));
  return out;
}

export interface FinanceSheetPayroll {
  byCostCentre: Map<string, { cost: number; staff: number }>;
  /** Sheet salary with no HRMS cost centre: per branch, with the process when the sheet line has one. */
  unallocated: Array<{ branchId: string; processId: string | null; cost: number }>;
}

/** The sheet's salary for cost-centre views, or null when the month is not a loaded Finance-sheet month. */
export async function readFinanceSheetPayroll(period: string): Promise<FinanceSheetPayroll | null> {
  const lines = await readFinanceSheetLines(period);
  if (!lines.length) return null;
  const ccOf = await financeSheetCostCentres(lines.map((l) => l.processId ?? ""));
  const out: FinanceSheetPayroll = { byCostCentre: new Map(), unallocated: [] };
  for (const line of lines) {
    const cost = line.agentSalary + line.dscSalary + line.bmcSalary;
    if (!cost || !line.branchId) continue;
    const cc = line.processId ? ccOf.get(line.processId) : undefined;
    if (cc) {
      const cur = out.byCostCentre.get(cc) ?? { cost: 0, staff: 0 };
      out.byCostCentre.set(cc, { cost: cur.cost + cost, staff: 0 });
    } else {
      out.unallocated.push({ branchId: line.branchId, processId: line.processId, cost });
    }
  }
  return out;
}
