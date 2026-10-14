/**
 * Read-only: builds the Finance Ledger -> Tally files from production data so they can be test-imported
 * into a TallyPrime outside production. Every statement is checked to be a SELECT before it runs.
 *
 *   npx tsx scripts/ledger-tally-dump.ts 2026-09 2026-10
 *
 * Prints each month's summary, then the "everything" XML gzipped + base64 between markers.
 */
import "dotenv/config";
import { gzipSync } from "node:zlib";
import { db } from "../src/db/mysql.js";

const guard = <T extends (...a: any[]) => any>(fn: T): T =>
  ((sql: string, ...rest: any[]) => {
    if (!/^\s*\(?\s*SELECT\b/i.test(String(sql))) throw new Error(`read-only dump refused: ${String(sql).slice(0, 60)}`);
    return fn(sql, ...rest);
  }) as T;
(db as any).execute = guard(db.execute.bind(db));
(db as any).query = guard(db.query.bind(db));

const { buildLedgerTallyExport } = await import("../src/modules/finance/tally-ledger-export.service.js");
const months = process.argv.slice(2).filter((m) => /^\d{4}-\d{2}$/.test(m));
for (const month of months.length ? months : ["2026-09", "2026-10"]) {
  const { xml, summary } = await buildLedgerTallyExport({ month, kind: "all" });
  console.log(`\n=== ${month} ===`);
  console.log(JSON.stringify({ ...summary, exceptions: undefined, exceptionCount: summary.exceptions.length }));
  for (const e of summary.exceptions.slice(0, 40)) console.log(`  EXC ${e.kind} ${e.ref}: ${e.reason}`);
  const b64 = gzipSync(Buffer.from(xml, "utf8")).toString("base64");
  console.log(`XML-BEGIN ${month} ${xml.length}`);
  for (let i = 0; i < b64.length; i += 3000) console.log(`XMLB64 ${b64.slice(i, i + 3000)}`);
  console.log(`XML-END ${month}`);
}
process.exit(0);
