/**
 * Read-only: builds EVERY HRMS Tally import file from production data, exactly as the UI downloads them, so they
 * can be test-imported into a TallyPrime outside production. Every statement is checked to be a SELECT first.
 *
 *   npx tsx scripts/ledger-tally-dump.ts 2026-09 2026-10
 *
 *   month-<m>      Finance Ledger "Tally Export" tab, everything (masters + GRN + payments + journals)
 *   grn-<m>        GRN page Tally download (XML), vendor and imprest
 *   bank-<acct>-<m> Bank Ledger "Tally XML" for each bank account's released payment vouchers in the month
 *   salary-<m>     Salary voucher XML for the latest real payroll run of the month (serials from 1 = preview)
 *   gst-<gstin>-<m> GST Sales / Credit Note XML (preview path: nothing is written)
 *
 * Prints each file's summary, then the XML gzipped + base64 between markers.
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

const { buildLedgerTallyExport, buildPaymentVoucherTallyXml, tallyCompanyName } = await import("../src/modules/finance/tally-ledger-export.service.js");
const { loadGrnTallyDownload, buildGrnTallyXml } = await import("../src/modules/finance/grn-tally-download.service.js");
const { salaryVoucherService } = await import("../src/modules/finance/salary-voucher.service.js");
const { buildTallyXml } = await import("../src/modules/finance/salary-voucher-formats.js");
const { tallyVoucherService } = await import("../src/modules/gst/tally-voucher/tally-voucher.service.js");
const { listVoucherKinds } = await import("../src/modules/gst/tally-voucher/tally-voucher-kinds.js");

const emit = (name: string, xml: string, info: unknown) => {
  console.log(`\n=== ${name} === ${JSON.stringify(info)}`);
  const b64 = gzipSync(Buffer.from(xml, "utf8")).toString("base64");
  console.log(`XML-BEGIN ${name} ${xml.length}`);
  for (let i = 0; i < b64.length; i += 3000) console.log(`XMLB64 ${b64.slice(i, i + 3000)}`);
  console.log(`XML-END ${name}`);
};
const tryRun = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { console.log(`\n=== ${name} === FAILED ${(e as Error).message}`); }
};

const months = process.argv.slice(2).filter((m) => /^\d{4}-\d{2}$/.test(m));
console.log(`company setting (GRN_TALLY_COMPANY): ${tallyCompanyName() ?? "(not set)"}`);
for (const month of months.length ? months : ["2026-09", "2026-10"]) {
  const from = `${month}-01`;
  const to = `${month}-31`;

  await tryRun(`month-${month}`, async () => {
    const { xml, summary } = await buildLedgerTallyExport({ month, kind: "all" });
    emit(`month-${month}`, xml, { ...summary, exceptions: summary.exceptions.slice(0, 20) });
  });

  await tryRun(`grn-${month}`, async () => {
    const data = await loadGrnTallyDownload({ branchScope: { mode: "all" }, month, grnType: "all" });
    emit(`grn-${month}`, buildGrnTallyXml(data), { rows: data.rows.length, exceptions: data.rows.filter((r: any) => r.exception).length });
  });

  await tryRun(`bank-${month}`, async () => {
    const [accts] = await db.query<RowDataPacket[]>(`SELECT id, account_name, tally_ledger_name FROM company_bank_account WHERE active_status = 1`);
    for (const a of accts) {
      const [ids] = await db.query<RowDataPacket[]>(
        `SELECT DISTINCT je.source_id FROM journal_entry je JOIN journal_entry_line l ON l.journal_entry_id = je.id
          WHERE je.source_type = 'payment_voucher' AND l.account_type = 'bank_account' AND l.account_id = ?
            AND je.entry_date >= ? AND je.entry_date <= ?`, [a.id, from, to]);
      const built = await buildPaymentVoucherTallyXml(ids.map((r) => String(r.source_id)));
      emit(`bank-${String(a.account_name).replace(/\W+/g, "_")}-${month}`, built.xml, { bank: a.tally_ledger_name, vouchers: built.count, exceptions: built.exceptions });
    }
  });

  await tryRun(`salary-${month}`, async () => {
    const [runs] = await db.query<RowDataPacket[]>(
      `SELECT id, run_month, status, total_employees FROM salary_prep_run WHERE run_month = ? ORDER BY created_at DESC LIMIT 3`, [month]);
    console.log(`\nsalary runs ${month}: ${JSON.stringify(runs)}`);
    const run = runs.find((r) => Number(r.total_employees) > 0) ?? runs[0];
    if (!run) return;
    const generated: any = await salaryVoucherService.generate(String(run.id), { serialFrom: 1 });
    const vouchers = generated.vouchers ?? generated;
    emit(`salary-${month}`, buildTallyXml(vouchers, tallyCompanyName(), String(run.id)), {
      run: run.id, status: run.status, vouchers: vouchers.length,
      unbalanced: vouchers.filter((v: any) => !v.totals?.balanced).map((v: any) => v.voucher_no),
      ledgers: [...new Set(vouchers.flatMap((v: any) => v.lines.map((l: any) => l.ledger_name)))],
      centres: [...new Set(vouchers.map((v: any) => `${v.cost_category} | ${v.cost_centre}`))],
    });
  });

  await tryRun(`gst-${month}`, async () => {
    const { gstExportService } = await import("../src/modules/gst/gst-export.service.js");
    const regs = ((await gstExportService.listRegistrations()) as any[]).slice(0, 6);
    console.log(`\ngst registrations: ${JSON.stringify(regs)}`);
    const kinds = listVoucherKinds().map((k: any) => k.kind);
    for (const r of regs) {
      const p: any = await tallyVoucherService.preview({ companyGstin: String(r.company_gstin), periodMonth: month, voucherKinds: kinds });
      emit(`gst-${r.company_gstin}-${month}`, p.xml, { company: p.companyName, summary: p.summary });
    }
  });
}
process.exit(0);
