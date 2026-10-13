/**
 * Voucher-level non-people comparison, HRMS P&L vs db_bill, for chosen branch-months. READ-ONLY.
 * Input: "YYYY-MM|BRANCH NAME" items (comma separated).
 *
 * HRMS side = exactly what the P&L counts (readGrnSpend consumed + reserved, withDetail), filtered to the branch's cost centres.
 * db_bill side = expense_entry_master / expense_entry_particular, type Vendor/Imprest, not rejected, FinanceYear 2026-27, FinanceMonth = month,
 *                cost centre mapped through cost_centre_master.bill_source_id to the same branch.
 * Both are grouped by GRN number and matched. Output (GRN numbers and amounts only):
 *   CMP_SUMMARY  per category: count and amount   (BOTH_SAME, BOTH_DIFF, ONLY_HRMS, ONLY_BILL, TWIN_BY_AMOUNT)
 *   CMP_ITEM     the largest items of every non-matching category with leg / status / multi_month / mirror presence
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { readGrnSpend } from "../src/modules/process-pnl/pnl-actuals.service.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function one(period: string, branchName: string) {
  const [ccs] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id, ccm.cost_centre_code AS code, ccm.bill_source_id AS src FROM cost_centre_master ccm JOIN branch_master bm ON bm.id = ccm.branch_id WHERE UPPER(TRIM(bm.branch_name)) = ?`, [norm(branchName)]);
  const ids = new Set(ccs.map((c) => String(c.id)));
  const codeById = new Map(ccs.map((c) => [String(c.id), String(c.code)]));
  const srcIds = new Set(ccs.filter((c) => c.src != null).map((c) => Number(c.src)));
  const codeBySrc = new Map(ccs.filter((c) => c.src != null).map((c) => [Number(c.src), String(c.code)]));

  type Item = { ref: string; amount: number; legs: Set<string>; cc: Set<string>; extra: Record<string, unknown> };
  const hrms = new Map<string, Item>();
  for (const kind of ["consumed", "reserved"] as const) {
    const rows = await readGrnSpend(period, kind, { withDetail: true });
    for (const r of rows) {
      if (!r.costCentreId || !ids.has(r.costCentreId)) continue;
      const ref = norm(r.grnRef ?? "(no ref)");
      const it = hrms.get(ref) ?? { ref, amount: 0, legs: new Set(), cc: new Set(), extra: {} };
      it.amount += r.amount; it.legs.add(`${r.source ?? "?"}/${kind}`); it.cc.add(codeById.get(r.costCentreId) ?? "?");
      hrms.set(ref, it);
    }
  }

  const [y, m] = period.split("-").map(Number);
  const fm = MON[m - 1];
  const fy = m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
  const bill = new Map<string, Item>();
  if (srcIds.size) {
    const rows = await billQuery<any>(
      `SELECT m.Id mid, m.GrnNo grn, m.ExpenseEntryType typ, m.EntryStatus est, IFNULL(m.multi_month,'') mm, CAST(p.CostCenterId AS UNSIGNED) cc, CAST(p.Amount AS DECIMAL(16,2)) amt
         FROM expense_entry_particular p JOIN expense_entry_master m ON m.Id = CAST(p.ExpenseEntry AS UNSIGNED)
        WHERE m.FinanceYear = ? AND m.FinanceMonth = ? AND m.ExpenseEntryType IN ('Vendor','Imprest') AND m.RejectDate IS NULL`, [fy, fm]);
    for (const r of rows) {
      if (!srcIds.has(Number(r.cc))) continue;
      const ref = norm(r.grn ?? `ID${r.mid}`);
      const it = bill.get(ref) ?? { ref, amount: 0, legs: new Set(), cc: new Set(), extra: { type: r.typ, status: r.est, multi: r.mm, id: r.mid } };
      it.amount += Number(r.amt ?? 0); it.cc.add(codeBySrc.get(Number(r.cc)) ?? "?");
      bill.set(ref, it);
    }
  }

  const cats: Record<string, Array<{ ref: string; hrms: number; bill: number; info: string }>> = { BOTH_SAME: [], BOTH_DIFF: [], ONLY_HRMS: [], ONLY_BILL: [], TWIN_BY_AMOUNT: [] };
  const onlyBill = new Set<string>();
  for (const [ref, h] of hrms) {
    const b = bill.get(ref);
    if (b) (Math.abs(h.amount - b.amount) <= 1 ? cats.BOTH_SAME : cats.BOTH_DIFF).push({ ref, hrms: h.amount, bill: b.amount, info: `${[...h.legs].join("+")} cc=${[...h.cc].join(",")}` });
  }
  for (const [ref, b] of bill) if (!hrms.has(ref)) onlyBill.add(ref);
  const onlyHrmsRefs = [...hrms.keys()].filter((r) => !bill.has(r));
  // Same amount under another number in the other system = the same invoice keyed twice.
  const usedBill = new Set<string>();
  for (const ref of onlyHrmsRefs) {
    const h = hrms.get(ref)!;
    const twin = [...onlyBill].find((br) => !usedBill.has(br) && Math.abs(bill.get(br)!.amount - h.amount) <= 1 && h.amount >= 1000);
    if (twin) { usedBill.add(twin); cats.TWIN_BY_AMOUNT.push({ ref: `${ref} ~ ${twin}`, hrms: h.amount, bill: bill.get(twin)!.amount, info: `${[...h.legs].join("+")} | bill ${JSON.stringify(bill.get(twin)!.extra)}` }); }
    else cats.ONLY_HRMS.push({ ref, hrms: h.amount, bill: 0, info: `${[...h.legs].join("+")} cc=${[...h.cc].join(",")}` });
  }
  // For vouchers only in db_bill: is the voucher in the HRMS mirror at all, and under which period / rejection?
  const billOnlyRefs = [...onlyBill].filter((r) => !usedBill.has(r));
  const mirror = new Map<string, { period: string; rej: number }>();
  for (let i = 0; i < billOnlyRefs.length; i += 200) {
    const part = billOnlyRefs.slice(i, i + 200);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT UPPER(TRIM(grn_no)) g, period_code p, is_rejected r FROM grn_entry_snapshot WHERE UPPER(TRIM(grn_no)) IN (${part.map(() => "?").join(",")})`, part).catch(() => [[]] as unknown as [RowDataPacket[]]);
    for (const r of rows as RowDataPacket[]) mirror.set(String(r.g), { period: String(r.p), rej: Number(r.r) });
  }
  for (const ref of billOnlyRefs) {
    const b = bill.get(ref)!; const mm = mirror.get(ref);
    cats.ONLY_BILL.push({ ref, hrms: 0, bill: b.amount, info: `bill ${JSON.stringify(b.extra)} cc=${[...b.cc].join(",")} mirror=${mm ? `${mm.period}${mm.rej ? " rejected" : ""}` : "ABSENT"}` });
  }
  const key = `${period}|${branchName}`;
  console.log("CMP_META " + JSON.stringify({ key, hrmsVouchers: hrms.size, billVouchers: bill.size, hrmsTotal: r0([...hrms.values()].reduce((t, v) => t + v.amount, 0)), billTotal: r0([...bill.values()].reduce((t, v) => t + v.amount, 0)) }));
  for (const [c, list] of Object.entries(cats)) console.log("CMP_SUMMARY " + JSON.stringify({ key, category: c, count: list.length, hrms: r0(list.reduce((t, v) => t + v.hrms, 0)), bill: r0(list.reduce((t, v) => t + v.bill, 0)) }));
  for (const c of ["BOTH_DIFF", "ONLY_HRMS", "ONLY_BILL", "TWIN_BY_AMOUNT"]) {
    for (const it of cats[c].sort((a, b) => Math.abs(b.hrms - b.bill) - Math.abs(a.hrms - a.bill)).slice(0, 14)) console.log("CMP_ITEM " + JSON.stringify({ key, category: c, ref: it.ref, hrms: r0(it.hrms), bill: r0(it.bill), info: it.info.slice(0, 260) }));
  }
}

(async () => {
  const items = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const it of items) { const [p, b] = it.split("|"); try { await one(p, b); } catch (e) { console.log("CMP_ERROR " + JSON.stringify({ item: it, error: e instanceof Error ? e.message : String(e) })); } }
  await closeBillPool().catch(() => undefined);
  await new Promise((resolve) => process.stdout.write("CMP_DONE\n", resolve));
  process.exit(0);
})();
