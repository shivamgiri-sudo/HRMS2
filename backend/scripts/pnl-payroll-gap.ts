/**
 * HRMS payroll vs db_bill salary_data for one month: where does the difference sit? READ-ONLY.
 * Aggregates only (no names, no per-employee output): component totals, employee overlap, the size
 * distribution of per-employee differences and duplicate payroll lines.
 *
 *   npx tsx scripts/pnl-payroll-gap.ts YYYY-MM [YYYY-MM ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import { nonVoidRunSql } from "../src/modules/payroll/run-status.js";

const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

(async () => {
  const periods = process.argv.slice(2);
  if (!periods.length) throw new Error("pass periods");
  const [lineCols] = await db.query<RowDataPacket[]>("SHOW COLUMNS FROM salary_prep_line");
  const have = new Set(lineCols.map((c) => String(c.Field)));
  const pick = (c: string) => (have.has(c) ? `COALESCE(spl.${c}, 0)` : "0");
  const billCols = (await billQuery<any>("SHOW COLUMNS FROM salary_data")).map((c: any) => ({ name: String(c.Field), type: String(c.Type) }));
  const lower = new Map(billCols.map((c) => [c.name.toLowerCase(), c.name]));
  const codeCol = ["empcode", "emp_code", "employeecode", "employee_code", "empid", "emp_id"].map((c) => lower.get(c)).find(Boolean) ?? null;
  const companyCol = ["company", "companyname", "company_name", "costcompany", "cost_company_name"].map((c) => lower.get(c)).find(Boolean) ?? null;
  console.log("GAP_LINECOLS " + JSON.stringify([...have]));
  console.log("GAP_META " + JSON.stringify({ periods, billCodeColumn: codeCol, billCompanyColumn: companyCol, billColumns: billCols.map((c) => `${c.name}:${c.type}`) }));
  // db_bill stores every amount as varchar(50): cast the ones that explain a payroll difference.
  const SUM_COLS = ["Gross", "Gross1", "CTC", "ESICCompany", "EPFCompany", "AdminChrg", "Incentive", "ExtraDayIncentive", "Arrear", "PLI",
    "ESIC", "EPF", "LeaveDeduction", "OtherDeduction", "LoanDed", "TotalDeduction", "NetSalary", "EarnedDays"].filter((c) => lower.has(c.toLowerCase()));
  const numericBill = SUM_COLS.map((c) => lower.get(c.toLowerCase())!);
  const dec = (c: string) => `CAST(NULLIF(TRIM(\`${c}\`), '') AS DECIMAL(18,2))`;

  for (const period of periods) {
    // HRMS side, per employee (payroll lines of non-void runs of the month).
    const [h] = await db.query<RowDataPacket[]>(
      `SELECT e.employee_code AS code, COALESCE(bm.branch_name, 'Unassigned') AS branch,
              COUNT(*) AS n_lines,
              SUM(${pick("gross_salary")}) AS gross, SUM(${pick("pf_employer")}) AS pf, SUM(${pick("esic_employer")}) AS esic,
              SUM(${pick("gratuity")}) AS gratuity, SUM(${pick("incentive_total")}) AS incentive,
              SUM(${pick("other_deductions")} + ${pick("loan_emi")} + ${pick("advance_recovery")}) AS other_ded,
              SUM(${pick("lwp_deduction")}) AS lwp
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ? AND ${nonVoidRunSql("spr")}
         LEFT JOIN employees e ON e.id = spl.employee_id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
        GROUP BY e.employee_code, branch`, [period]);
    const hr = new Map<string, { branch: string; cost: number; ctc: number; inc: number; lines: number }>();
    const tot = { ctc: 0, inc: 0, ded: 0, lwp: 0, gross: 0, pf: 0, esic: 0, grat: 0, lines: 0 };
    for (const r of h) {
      const ctc = num(r.gross) + num(r.pf) + num(r.esic) + num(r.gratuity);
      const cost = ctc + num(r.incentive) - num(r.other_ded) - num(r.lwp);
      tot.ctc += ctc; tot.inc += num(r.incentive); tot.ded += num(r.other_ded); tot.lwp += num(r.lwp);
      tot.gross += num(r.gross); tot.pf += num(r.pf); tot.esic += num(r.esic); tot.grat += num(r.gratuity); tot.lines += num(r.n_lines);
      hr.set(String(r.code), { branch: String(r.branch), cost, ctc, inc: num(r.incentive), lines: num(r.n_lines) });
    }
    console.log("GAP_HRMS " + JSON.stringify({ period, employees: hr.size, lines: tot.lines, gross: r0(tot.gross), pfEmployer: r0(tot.pf), esicEmployer: r0(tot.esic), gratuity: r0(tot.grat), incentive: r0(tot.inc), otherDeductions: r0(tot.ded), lwp: r0(tot.lwp), ctcPaid: r0(tot.ctc), peopleCost: r0(tot.ctc + tot.inc - tot.ded - tot.lwp) }));
    const dupLines = [...hr.values()].filter((x) => x.lines > 1);
    console.log("GAP_HRMS_DUP " + JSON.stringify({ period, employeesWithMultipleLines: dupLines.length, extraLines: dupLines.reduce((t, x) => t + x.lines - 1, 0), costOnThose: r0(dupLines.reduce((t, x) => t + x.cost, 0)) }));

    // db_bill side.
    const sums = numericBill.map((c) => `SUM(COALESCE(${dec(c)}, 0)) AS \`s_${c}\``).join(", ");
    const where = `DATE_FORMAT(SalayDate,'%Y-%m') = '${period}'${companyCol ? ` AND LOWER(TRIM(COALESCE(\`${companyCol}\`, ''))) <> 'idc'` : ""}`;
    const totals = await billQuery<any>(`SELECT COUNT(*) AS n, ${sums} FROM salary_data WHERE ${where}`);
    const t = totals[0] ?? {};
    const out: Record<string, number> = {};
    for (const c of numericBill) { const v = r0(t[`s_${c}`]); if (v !== 0) out[c] = v; }
    console.log("GAP_DBBILL " + JSON.stringify({ period, rows: num(t.n), numericSums: out }));

    if (codeCol && lower.get("ctc")) {
      const rows = await billQuery<any>(
        `SELECT TRIM(\`${codeCol}\`) AS code, SUM(COALESCE(${dec(lower.get("ctc")!)}, 0)) AS ctc, COUNT(*) AS n
           FROM salary_data WHERE ${where} GROUP BY TRIM(\`${codeCol}\`)`);
      const bill = new Map(rows.map((r: any) => [String(r.code), { ctc: num(r.ctc), n: num(r.n) }]));
      const dupBill = rows.filter((r: any) => num(r.n) > 1);
      console.log("GAP_DBBILL_DUP " + JSON.stringify({ period, codes: bill.size, codesWithMultipleRows: dupBill.length }));
      let onlyH = 0, onlyHCost = 0, onlyB = 0, onlyBCost = 0, both = 0, diffSum = 0;
      const bucket = { le0: [0, 0], b1: [0, 0], b2: [0, 0], b3: [0, 0], b4: [0, 0], neg1: [0, 0], neg2: [0, 0] } as Record<string, number[]>;
      const byBranch = new Map<string, { onlyH: number; onlyHCost: number; diff: number; n: number }>();
      const onlyHByBranch = new Map<string, number>();
      for (const [code, x] of hr) {
        const b = bill.get(code);
        const br = byBranch.get(x.branch) ?? { onlyH: 0, onlyHCost: 0, diff: 0, n: 0 };
        if (!b) { onlyH++; onlyHCost += x.cost; br.onlyH++; br.onlyHCost += x.cost; onlyHByBranch.set(x.branch, (onlyHByBranch.get(x.branch) ?? 0) + 1); byBranch.set(x.branch, br); continue; }
        both++;
        const d = x.cost - b.ctc; diffSum += d; br.diff += d; br.n++; byBranch.set(x.branch, br);
        const k = Math.abs(d) < 1 ? "le0" : d > 0 ? (d <= 1000 ? "b1" : d <= 5000 ? "b2" : d <= 20000 ? "b3" : "b4") : (d >= -1000 ? "neg1" : "neg2");
        bucket[k][0]++; bucket[k][1] += d;
      }
      for (const [code, b] of bill) if (!hr.has(code)) { onlyB++; onlyBCost += b.ctc; }
      console.log("GAP_OVERLAP " + JSON.stringify({ period, both, onlyInHrms: onlyH, onlyInHrmsCost: r0(onlyHCost), onlyInDbBill: onlyB, onlyInDbBillCost: r0(onlyBCost), sumDiffWhereBoth: r0(diffSum) }));
      console.log("GAP_DIFF_BUCKETS " + JSON.stringify({ period, zero: bucket.le0, hrmsHigher_le1k: bucket.b1, hrmsHigher_1k_5k: bucket.b2, hrmsHigher_5k_20k: bucket.b3, hrmsHigher_gt20k: bucket.b4, hrmsLower_le1k: bucket.neg1, hrmsLower_gt1k: bucket.neg2 }));
      // Matched employees: HRMS gross vs db_bill full gross (Gross) and earned gross (Gross1) and CTC.
      const detail = await billQuery<any>(
        `SELECT TRIM(\`${codeCol}\`) AS code,
                SUM(COALESCE(${dec(lower.get("gross")!)}, 0)) AS gross_full, SUM(COALESCE(${dec(lower.get("gross1")!)}, 0)) AS gross_earned,
                SUM(COALESCE(${dec(lower.get("ctc")!)}, 0)) AS ctc, SUM(COALESCE(${dec(lower.get("incentive")!)}, 0)) AS inc,
                SUM(COALESCE(${dec(lower.get("arrear")!)}, 0)) AS arrear, SUM(COALESCE(${dec(lower.get("earneddays")!)}, 0)) AS earned_days,
                MAX(TRIM(\`${lower.get("leftstatus")!}\`)) AS left_status, MAX(TRIM(\`${lower.get("fnfstatus")!}\`)) AS fnf_status
           FROM salary_data WHERE ${where} GROUP BY TRIM(\`${codeCol}\`)`);
      const hgross = new Map<string, number>();
      for (const r of h) hgross.set(String(r.code), (hgross.get(String(r.code)) ?? 0) + num(r.gross));
      const m = { n: 0, hGross: 0, bFull: 0, bEarned: 0, bCtc: 0, bInc: 0, bArrear: 0, nearFull: 0, nearEarned: 0, other: 0 };
      const miss = { n: 0, ctc: 0, gross: 0, earnedDays: 0, left: 0, fnf: 0, zeroDays: 0 };
      for (const r of detail) {
        const code = String(r.code);
        if (hr.has(code)) {
          m.n++; m.hGross += hgross.get(code) ?? 0; m.bFull += num(r.gross_full); m.bEarned += num(r.gross_earned); m.bCtc += num(r.ctc); m.bInc += num(r.inc); m.bArrear += num(r.arrear);
          const hg = hgross.get(code) ?? 0;
          if (Math.abs(hg - num(r.gross_full)) <= 1) m.nearFull++; else if (Math.abs(hg - num(r.gross_earned)) <= 1) m.nearEarned++; else m.other++;
        } else {
          miss.n++; miss.ctc += num(r.ctc); miss.gross += num(r.gross_earned); miss.earnedDays += num(r.earned_days);
          if (String(r.left_status ?? "").trim() && !/^(0|no|false|active)$/i.test(String(r.left_status).trim())) miss.left++;
          if (String(r.fnf_status ?? "").trim() && !/^(0|no|false|none)$/i.test(String(r.fnf_status).trim())) miss.fnf++;
          if (num(r.earned_days) <= 0) miss.zeroDays++;
        }
      }
      console.log("GAP_MATCHED " + JSON.stringify({ period, employees: m.n, hrmsGross: r0(m.hGross), dbbillGrossFull: r0(m.bFull), dbbillGrossEarned: r0(m.bEarned), dbbillCtc: r0(m.bCtc), dbbillIncentive: r0(m.bInc), dbbillArrear: r0(m.bArrear), hrmsEqualsDbbillFullGross: m.nearFull, hrmsEqualsDbbillEarnedGross: m.nearEarned, neither: m.other }));
      console.log("GAP_ONLY_DBBILL " + JSON.stringify({ period, employees: miss.n, ctc: r0(miss.ctc), earnedGross: r0(miss.gross), earnedDays: r0(miss.earnedDays), withLeftStatus: miss.left, withFnfStatus: miss.fnf, zeroEarnedDays: miss.zeroDays }));
      for (const [b, x] of byBranch) console.log("GAP_BRANCH " + JSON.stringify({ period, branch: b, bothCount: x.n, sumDiffWhereBoth: r0(x.diff), onlyInHrms: x.onlyH, onlyInHrmsCost: r0(x.onlyHCost) }));
    }
  }
  await new Promise((resolve) => process.stdout.write("GAP_DONE\n", resolve));
  process.exit(0);
})();
