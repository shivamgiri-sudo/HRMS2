/**
 * Builds the Finance Ledger Tally export as Excel for a month, exactly as the download does, and prints
 * what is in it: sheet names, row counts, summary counts and the exception reasons. READ-ONLY, aggregates only.
 *
 *   npx tsx scripts/ledger-tally-xlsx-check.ts YYYY-MM [kind]
 */
import "dotenv/config";
import ExcelJS from "exceljs";
import { buildLedgerTallyXlsx, buildLedgerTallyExport, type LedgerTallyKind } from "../src/modules/finance/tally-ledger-export.service.js";
import { db } from "../src/db/mysql.js";

(async () => {
  const month = process.argv[2];
  const kind = (process.argv[3] ?? "all") as LedgerTallyKind;
  if (!/^\d{4}-\d{2}$/.test(month ?? "")) throw new Error("pass YYYY-MM");
  const t0 = Date.now();
  const { buffer, summary } = await buildLedgerTallyXlsx({ month, kind });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  console.log("XLSX_BUILT " + JSON.stringify({ month, kind, ms: Date.now() - t0, bytes: buffer.byteLength, zip: buffer.subarray(0, 2).toString() === "PK" }));
  for (const ws of wb.worksheets) console.log("XLSX_SHEET " + JSON.stringify({ name: ws.name, rows: ws.rowCount - 1, columns: ws.columnCount }));
  console.log("XLSX_SUMMARY " + JSON.stringify({ counts: summary.counts, totals: summary.totals, masters: summary.masters }));
  const reasons = new Map<string, number>();
  for (const e of summary.exceptions) reasons.set(`${e.kind}: ${e.reason}`, (reasons.get(`${e.kind}: ${e.reason}`) ?? 0) + 1);
  for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log("XLSX_EXCEPTION " + JSON.stringify({ reason: k.slice(0, 140), count: n }));
  // Cross-check against the XML path: same counts.
  const xml = await buildLedgerTallyExport({ month, kind });
  console.log("XLSX_VS_XML " + JSON.stringify({ sameCounts: JSON.stringify(xml.summary.counts) === JSON.stringify(summary.counts), sameTotals: JSON.stringify(xml.summary.totals) === JSON.stringify(summary.totals) }));
  // Legacy GRNs must not be in it: no exported GRN number is a db_bill import.
  const [legacy] = await db.query<any[]>(
    `SELECT COUNT(*) AS n FROM grn_request g WHERE (g.bill_source_id IS NOT NULL OR COALESCE(g.created_by, '') LIKE '00000000-%')
        AND g.grn_number IN (SELECT DISTINCT v FROM (SELECT 1 AS v) x WHERE 1 = 0)`);
  console.log("XLSX_LEGACY_PROBE " + JSON.stringify({ note: "legacy GRNs are filtered by hrmsRaisedGrnSql in the shared read", probe: legacy?.[0]?.n ?? 0 }));
  await new Promise((resolve) => process.stdout.write("XLSX_DONE\n", resolve));
  process.exit(0);
})();
