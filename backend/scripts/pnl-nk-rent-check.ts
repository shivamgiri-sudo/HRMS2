/**
 * Ahmedabad Neelakanth rent, db_bill vs HRMS, per month, Apr 2026 onward. READ-ONLY. Prints amounts, GRN numbers and head names only.
 *   RENT_BILL   db_bill vouchers whose head or sub-head names rent, on Neelakanth cost centres (not rejected), per FinanceMonth
 *   RENT_HRMS   what the P&L counts for those same GRN numbers (readGrnSpend consumed + reserved), and the branch / cost centre it lands on
 *   RENT_GAP    month totals and the vouchers db_bill has that HRMS does not count (or counts at a different amount)
 * Neelakanth cost centres = cost_centre_master rows of branch AHMEDABAD-NEELAKANTH (any company), plus any whose code mentions Neela.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { readGrnSpend } from "../src/modules/process-pnl/pnl-actuals.service.js";

const MON = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

(async () => {
  const [ccs] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id, ccm.cost_centre_code code, ccm.bill_source_id src, ccm.company_name company, bm.branch_name branch
       FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
      WHERE UPPER(COALESCE(bm.branch_name,'')) LIKE '%NEELAKANTH%' OR UPPER(ccm.cost_centre_code) LIKE '%NEELA%'`);
  console.log("RENT_CC " + JSON.stringify(ccs.map((c) => ({ code: c.code, branch: c.branch, company: c.company, hasBillId: c.src != null }))));
  const src = ccs.filter((c) => c.src != null).map((c) => Number(c.src));
  const codeBySrc = new Map(ccs.filter((c) => c.src != null).map((c) => [Number(c.src), String(c.code)]));
  const idByCode = new Map(ccs.map((c) => [String(c.code), String(c.id)]));
  if (!src.length) { console.log("RENT_ERROR no Neelakanth cost centre has a db_bill id"); process.exit(0); }

  const heads = await billQuery<any>(`SELECT HeadingId id, HeadingDesc d FROM tbl_bgt_expenseheadingmaster`);
  const subs = await billQuery<any>(`SELECT SubHeadingId id, HeadingId h, SubHeadingDesc d FROM tbl_bgt_expensesubheadingmaster`);
  const headName = new Map(heads.map((h: any) => [String(h.id).trim(), String(h.d ?? "")]));
  const subName = new Map(subs.map((s: any) => [String(s.id).trim(), String(s.d ?? "")]));

  const rows = await billQuery<any>(
    `SELECT m.Id mid, m.GrnNo grn, m.FinanceMonth fm, m.HeadId hid, m.SubHeadId sid, m.ExpenseEntryType typ, m.EntryStatus est, IFNULL(m.multi_month,'') mm,
            CAST(p.CostCenterId AS UNSIGNED) cc, CAST(p.Amount AS DECIMAL(16,2)) amt, CAST(p.Tax AS DECIMAL(16,2)) tax
       FROM expense_entry_particular p JOIN expense_entry_master m ON m.Id = CAST(p.ExpenseEntry AS UNSIGNED)
      WHERE m.FinanceYear = '2026-27' AND m.ExpenseEntryType IN ('Vendor','Imprest') AND m.RejectDate IS NULL`);
  const rent = rows.filter((r: any) => src.includes(Number(r.cc)) && /rent/i.test(`${headName.get(String(r.hid).trim()) ?? ""} ${subName.get(String(r.sid).trim()) ?? ""}`));

  const byMonth = new Map<string, { amount: number; tax: number; vouchers: Map<string, number> }>();
  for (const r of rent) {
    const fm = String(r.fm).trim();
    const cur = byMonth.get(fm) ?? { amount: 0, tax: 0, vouchers: new Map() };
    cur.amount += Number(r.amt); cur.tax += Number(r.tax ?? 0);
    const ref = norm(r.grn ?? `ID${r.mid}`);
    cur.vouchers.set(ref, (cur.vouchers.get(ref) ?? 0) + Number(r.amt));
    byMonth.set(fm, cur);
    console.log("RENT_BILL " + JSON.stringify({ month: fm, grn: r.grn, head: headName.get(String(r.hid).trim()), sub: subName.get(String(r.sid).trim()), cc: codeBySrc.get(Number(r.cc)), amount: r0(r.amt), tax: r0(r.tax), type: r.typ, status: r.est, multiMonth: r.mm }));
  }

  for (let i = 0; i < MON.length; i++) {
    const period = `2026-${String(i + 4).padStart(2, "0")}`;
    const hrmsRefs = new Map<string, { amount: number; where: Set<string> }>();
    for (const kind of ["consumed", "reserved"] as const) {
      for (const r of await readGrnSpend(period, kind, { withDetail: true })) {
        const ref = norm(r.grnRef); const cur = hrmsRefs.get(ref) ?? { amount: 0, where: new Set() };
        cur.amount += r.amount; cur.where.add(`${r.source}/${kind}`); hrmsRefs.set(ref, cur);
      }
    }
    const b = byMonth.get(MON[i]);
    let counted = 0; const missing: Array<{ grn: string; bill: number; hrms: number }> = [];
    for (const [ref, amt] of b?.vouchers ?? []) {
      const h = hrmsRefs.get(ref);
      counted += Math.min(h?.amount ?? 0, amt);
      if (!h || Math.abs(h.amount - amt) > 1) missing.push({ grn: ref, bill: r0(amt), hrms: r0(h?.amount ?? 0) });
    }
    console.log("RENT_GAP " + JSON.stringify({ period, dbbillRent: r0(b?.amount ?? 0), vouchers: b?.vouchers.size ?? 0, hrmsCountsOfThose: r0(counted), notCountedOrDifferent: missing }));
  }
  void idByCode;
  await closeBillPool().catch(() => undefined);
  await new Promise((resolve) => process.stdout.write("RENT_DONE\n", resolve));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
