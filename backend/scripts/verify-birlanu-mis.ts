/**
 * Proves the Birlanu MIS aggregation (src/modules/process-performance/birlanu-mis.ts)
 * reproduces the reference workbook's own cached numbers.
 *
 *   npx tsx scripts/verify-birlanu-mis.ts "C:/path/Birlanu_MR AUG-2026.xlsb"
 *
 * Read-only: opens the workbook, renders each Data row in the same text shape
 * db_masmis.birlanu_sale stores, runs the very same builders the API uses, and
 * compares against the values Excel cached on the dashboard sheets. Touches no database.
 */
import XLSX from "xlsx";
import { buildMis, rowToFact, TAT_BUCKETS, type RawRow } from "../src/modules/process-performance/birlanu-mis.js";

const file = process.argv[2];
if (!file) { console.error("usage: verify-birlanu-mis.ts <workbook.xlsb>"); process.exit(2); }

const wb = XLSX.readFile(file, { cellFormula: false });
const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Data"], { header: 1, raw: true, defval: null });
const col = (c: string) => XLSX.utils.decode_col(c);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const serialToDmy = (v: unknown) => {
  if (typeof v !== "number") return "";
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  return `${d.getUTCDate()}-${MON[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
};
const daysToHms = (v: unknown) => {
  if (typeof v !== "number") return "-";
  const s = Math.round(v * 86400);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const cell = (r: unknown[], c: string) => r[col(c)];

const raws: RawRow[] = [];
for (let i = 1; i < data.length; i++) {
  const r = data[i];
  if (!r || cell(r, "D") === null || cell(r, "D") === undefined) continue;
  raws.push({
    weeks: cell(r, "B"), lead_register_month: cell(r, "D"), lead_register_date: serialToDmy(cell(r, "N")), call_type: cell(r, "P"),
    calling_status: cell(r, "Q"), interested_status: cell(r, "R"), sub_calling_status: cell(r, "S"), sub_sub_calling_status: cell(r, "T"),
    enquiry_source: cell(r, "L"), brand: cell(r, "AD"), organic_paid: cell(r, "BQ"), lead_closer_status: cell(r, "AU"),
    lead_closer_month: cell(r, "BP"), seller_email_id: cell(r, "AS"), sale_mt: cell(r, "BE"), sale_inr: cell(r, "BF"),
    bucket: cell(r, "BY"), frt: daysToHms(cell(r, "BW")),
  });
}
const mis = buildMis(raws.map(rowToFact), {});
console.log(`Data rows: ${raws.length}; months in scope: ${mis.scope.months.join(", ")}`);

let pass = 0; let fail = 0;
function check(label: string, mine: number, excel: unknown, tol = 0.5) {
  const x = Number(excel ?? 0);
  const ok = Math.abs(mine - x) <= tol;
  if (ok) pass++; else { fail++; console.log(`  MISMATCH ${label}: mine=${mine} excel=${x}`); }
}
const sheet = (n: string) => wb.Sheets[n];
const v = (n: string, a: string) => (sheet(n)[a] ? sheet(n)[a].v : 0);

/* Performance Dashboard: rows 5.. = Apr'26.. ; C enq, D conn, F validated(Interested), H qualified(LAS), J conv, L vol, M value, N LC, P vol, Q value */
mis.performance.months.forEach((m, i) => {
  const r = 5 + i; const pd = "Performance Dashboard";
  const lbl = (s: string) => `Performance ${m.month} ${s}`;
  check(lbl("enquiries"), m.enquiries, v(pd, `C${r}`)); check(lbl("connected"), m.connected, v(pd, `D${r}`));
  check(lbl("validated"), m.validated, v(pd, `F${r}`)); check(lbl("qualified"), m.qualified, v(pd, `H${r}`));
  check(lbl("converted"), m.converted, v(pd, `J${r}`)); check(lbl("vol MT"), m.volMt, v(pd, `L${r}`), 1);
  check(lbl("value"), m.valueLacs * 1e5, v(pd, `M${r}`), 1); check(lbl("LC closer"), m.lcCloser, v(pd, `N${r}`));
  check(lbl("vol closer"), m.volMtCloser, v(pd, `P${r}`), 1); check(lbl("value closer"), m.valueLacsCloser * 1e5, v(pd, `Q${r}`), 1);
});
const pt = mis.performance.total;
check("Performance total enquiries", pt.enquiries, v("Performance Dashboard", "C17")); check("Performance total converted", pt.converted, v("Performance Dashboard", "J17"));
check("Performance total value", pt.valueLacs * 1e5, v("Performance Dashboard", "M17"), 1);

/* Business Dashboard: D..H = Apr..Aug ; rows 3,4,9,10,11,15,16,18 */
const cols = ["D", "E", "F", "G", "H", "I"];
mis.business.perMonth.forEach((m, i) => {
  const c = cols[i]; const bd = "Business Dashboard"; const lbl = (s: string) => `Business ${m.month} ${s}`;
  check(lbl("validated"), m.validated, v(bd, `${c}3`)); check(lbl("organic validated"), m.organicV, v(bd, `${c}4`));
  check(lbl("conv"), m.conv, v(bd, `${c}9`)); check(lbl("conv organic"), m.convOrganic, v(bd, `${c}10`)); check(lbl("conv paid"), m.convPaid, v(bd, `${c}11`));
  check(lbl("revenue L"), m.revenue, v(bd, `${c}15`), 0.01); check(lbl("revenue organic L"), m.revenueOrganic, v(bd, `${c}16`), 0.01);
  check(lbl("first billing L"), m.firstBilling, v(bd, `${c}18`), 0.01);
  check(lbl("conv%"), m.convPct / 100, v(bd, `${c}12`), 0.0006); check(lbl("paid conv%"), m.convPaidPct / 100, v(bd, `${c}14`), 0.0006);
});
const st = ["closed_with_order", "closed_with_dealership", "closed_without_order", "closed_without_dealership", "closed_with_solution", "underprocess", "followup", "pending", "no_response_from_sales_team", "no_response_from_customer", "no_response", "invalid_close", "dropped"];
st.forEach((s, i) => {
  const mine = mis.business.closureBreakup.find((x) => x.status === s)?.count ?? 0;
  check(`Business YTD status ${s}`, mine, v("Business Dashboard", `P${21 + i}`));
});

/* Channel Wise Disposition: 'Overall' block rows 4..15 connect, 17..21 not connect, col O grand total, columns D.. by source */
const cwd = "Channel Wise Disposition";
const srcCols: Record<string, string> = { Meta: "D", IndiaMART: "E", Inbound: "F", ChatBot: "G", GetDistributor: "H", Mail: "I", Other: "J", Plantix: "K", TradeIndia: "L", Exhibition: "M", WebSite: "N" };
mis.disposition.connect.forEach((r, i) => {
  check(`Disposition ${r.status} total`, r.total, v(cwd, `O${4 + i}`));
  for (const [s, c] of Object.entries(srcCols)) if (r.by[s] !== undefined) check(`Disposition ${r.status}/${s}`, r.by[s], v(cwd, `${c}${4 + i}`));
});
mis.disposition.notConnect.forEach((r, i) => check(`Disposition ${r.status} total`, r.total, v(cwd, `O${17 + i}`)));
check("Disposition grand total", mis.disposition.grand, v(cwd, "O23"));

/* Lead TAT: sheet is set to Aug'26 / Whole Month. Row 4.. sources ; B..O buckets */
const tatMonth = String(v("Lead TAT", "A1"));
const tat = buildMis(raws.map(rowToFact), { month: tatMonth }).leadTat;
const tatCols = "BCDEFGHIJKLMNO".split("");
for (let r = 4; r <= 16; r++) {
  const src = String(v("Lead TAT", `A${r}`));
  const mine = tat.bySource.find((x) => x.source.toLowerCase() === src.toLowerCase());
  TAT_BUCKETS.forEach((b, i) => check(`TAT ${tatMonth} ${src} ${b}`, mine?.counts[i] ?? 0, v("Lead TAT", `${tatCols[i]}${r}`)));
}
check("TAT within total", tat.totals.within, v("Lead TAT", "P17")); check("TAT out total", tat.totals.out, v("Lead TAT", "Q17"));

/* Product Wise: rows 5.. brands, B overall enq, C leads, D conv, F revenue ; closer block rows 19.. */
const pw = "Product Wise&Source -Revenue";
mis.productWise.byRegister.rows.forEach((r) => {
  for (let row = 5; row <= 11; row++) if (String(v(pw, `A${row}`)).toLowerCase() === r.brand.toLowerCase()) {
    check(`Product ${r.brand} enq`, r.overall.enquiries, v(pw, `B${row}`)); check(`Product ${r.brand} leads`, r.overall.leads, v(pw, `C${row}`));
    check(`Product ${r.brand} conv`, r.overall.conversions, v(pw, `D${row}`)); check(`Product ${r.brand} revenue`, r.overall.revenue, v(pw, `F${row}`), 1);
  }
});
mis.productWise.byCloser.rows.forEach((r) => {
  for (let row = 19; row <= 25; row++) if (String(v(pw, `A${row}`)).toLowerCase() === r.brand.toLowerCase()) {
    check(`Product(closer) ${r.brand} conv`, r.overall.conversions, v(pw, `D${row}`)); check(`Product(closer) ${r.brand} revenue`, r.overall.revenue, v(pw, `F${row}`), 1);
  }
});

console.log(`\n${pass} checks passed, ${fail} mismatched.`);
process.exit(fail ? 1 : 0);
