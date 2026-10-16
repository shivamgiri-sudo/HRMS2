/**
 * Read-only: builds the HRMS Tally files from production data exactly as the UI downloads them, so they can be
 * compared with the legacy files Accounts sent (MASSEP.xlsx vendor GRN, MASAUGIMP.xlsx imprest GRN, MAS SALARY VCH).
 * Every statement is checked to be a SELECT first. Prints each file gzipped + base64 between markers.
 *
 *   npx tsx scripts/tally-format-validate.ts 2026-08 2026-09 2026-10
 */
import "dotenv/config";
import { gzipSync } from "node:zlib";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const guard = <T extends (...a: any[]) => any>(fn: T): T =>
  ((sql: any, ...rest: any[]) => {
    const text = typeof sql === "string" ? sql : String(sql?.sql ?? "");
    if (!/^\s*\(?\s*SELECT\b/i.test(text)) throw new Error(`read-only dump refused: ${text.slice(0, 60)}`);
    return fn(sql, ...rest);
  }) as T;
(db as any).execute = guard(db.execute.bind(db));
(db as any).query = guard(db.query.bind(db));
(db as any).getConnection = async () => { throw new Error("read-only dump: no connections"); };

const { loadGrnTallyDownload, buildGrnTallyXlsx } = await import("../src/modules/finance/grn-tally-download.service.js");
const { buildLedgerTallyXlsx } = await import("../src/modules/finance/tally-ledger-export.service.js");
const { salaryVoucherService } = await import("../src/modules/finance/salary-voucher.service.js");
const { buildCsv, buildXlsx } = await import("../src/modules/finance/salary-voucher-formats.js");
const { hrmsRaisedGrnSql, ownCompanyGrnSql } = await import("../src/shared/ownCompanyCostCentre.js");

const emit = (name: string, buf: Buffer | string, info?: unknown) => {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  console.log(`\n=== ${name} === ${info ? JSON.stringify(info) : ""}`);
  const b64 = gzipSync(b).toString("base64");
  console.log(`FILE-BEGIN ${name} ${b.length}`);
  for (let i = 0; i < b64.length; i += 3000) console.log(`FILEB64 ${b64.slice(i, i + 3000)}`);
  console.log(`FILE-END ${name}`);
};
const tryRun = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { console.log(`\n=== ${name} === FAILED ${(e as Error).stack?.split("\n").slice(0, 4).join(" | ")}`); }
};

const months = process.argv.slice(2).filter((m) => /^\d{4}-\d{2}$/.test(m));
for (const month of months) {
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

  await tryRun(`status-audit-${month}`, async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT g.grn_type, g.status, COUNT(*) n, SUM(g.grn_number IS NOT NULL AND TRIM(g.grn_number) <> '') numbered
         FROM grn_request g
        WHERE ${ownCompanyGrnSql("g")} AND ${hrmsRaisedGrnSql("g")}
          AND COALESCE(g.approved_at, g.finance_head_reviewed_at) >= ? AND COALESCE(g.approved_at, g.finance_head_reviewed_at) < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY g.grn_type, g.status ORDER BY g.grn_type, g.status`, [from, to]);
    console.log(`\nSTATUS-AUDIT ${month} (own-company HRMS-raised GRNs with an approval/review date in the month): ${JSON.stringify(rows)}`);
    const [pend] = await db.query<RowDataPacket[]>(
      `SELECT g.status, COUNT(*) n FROM grn_request g
        WHERE ${ownCompanyGrnSql("g")} AND ${hrmsRaisedGrnSql("g")} AND g.grn_number IS NOT NULL AND TRIM(g.grn_number) <> ''
          AND g.status NOT IN ('finance_head_approved','pending_accounts_payment','payment_scheduled','partially_paid','paid','approved','cancelled','consumption_reversed')
        GROUP BY g.status`);
    console.log(`NUMBERED-BUT-NOT-FINAL (all time; the old filter would have exported these): ${JSON.stringify(pend)}`);
  });

  await tryRun(`grn-rows-${month}`, async () => {
    for (const [label, includeLegacyDuplicates] of [["guard", false], ["noguard", true]] as const) {
      const data = await loadGrnTallyDownload({ branchScope: { mode: "all" }, month, grnType: "all", includeLegacyDuplicates });
      const rows = data.rows.map((r: any) => ({
        grn: r.grnNumber, type: r.grnType, status: r.status, approvedOn: r.approvedOn, bill: r.invoiceNumber, party: r.vendorName,
        gross: r.gross, tds: r.tdsAmount, vch: r.header?.voucherNumber ?? null, vchDate: r.header?.date ?? null, ex: r.exception,
      }));
      emit(`rows-${label}-${month}.json`, JSON.stringify(rows), { rows: rows.length, exceptions: rows.filter((r) => r.ex).length });
      emit(`vendor-${label}-${month}.xlsx`, await buildGrnTallyXlsx(data, "vendor"));
      emit(`imprest-${label}-${month}.xlsx`, await buildGrnTallyXlsx(data, "imprest"));
    }
  });

  await tryRun(`tab-${month}`, async () => {
    for (const kind of ["grn", "imprest", "all"] as const) {
      const { buffer, summary } = await buildLedgerTallyXlsx({ month, kind });
      emit(`tab-${kind}-${month}.xlsx`, buffer, { counts: summary.counts, totals: summary.totals, exceptions: summary.exceptions.slice(0, 15) });
    }
  });

  await tryRun(`salary-${month}`, async () => {
    const [runs] = await db.query<RowDataPacket[]>(
      `SELECT id, run_month, status, total_employees FROM salary_prep_run WHERE run_month = ? ORDER BY created_at DESC LIMIT 3`, [month]);
    console.log(`\nsalary runs ${month}: ${JSON.stringify(runs)}`);
    const run = runs.find((r) => Number(r.total_employees) > 0) ?? runs[0];
    if (!run) return;
    const generated: any = await salaryVoucherService.generate(String(run.id), {});
    const vouchers = generated.vouchers ?? generated;
    emit(`salary-${month}.csv`, buildCsv(vouchers), { run: run.id, vouchers: vouchers.length });
    emit(`salary-${month}.xlsx`, await buildXlsx(vouchers));
  });
}
process.exit(0);
