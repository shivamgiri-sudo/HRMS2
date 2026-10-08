/** READ-ONLY. Reports which of the given EmpCodes exist in db_bill.masjclrentry. Writes nothing. */
import "dotenv/config";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

async function main() {
  const codes = (process.env.CODES ?? "")
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (!codes.length) throw new Error("CODES env is empty");
  const ph = codes.map(() => "?").join(",");
  const rows = await billQuery<{ code: string; EmpName: string }>(
    `SELECT UPPER(TRIM(EmpCode)) AS code, EmpName FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) IN (${ph})`,
    codes,
  );
  const found = new Map<string, string[]>();
  for (const r of rows) found.set(r.code, [...(found.get(r.code) ?? []), r.EmpName]);
  const missing = codes.filter((c) => !found.has(c));
  for (const c of codes) if (found.has(c)) console.log(`FOUND   ${c}  rows=${found.get(c)!.length}  ${found.get(c)![0]}`);
  for (const c of missing) console.log(`MISSING ${c}`);
  console.log(`SUMMARY found=${found.size} missing=${missing.length} of ${codes.length}`);
  const tot = await billQuery<{ n: number }>(`SELECT COUNT(*) AS n FROM masjclrentry`);
  const mx = await billQuery<{ code: string }>(`SELECT TRIM(EmpCode) AS code FROM masjclrentry WHERE EmpCode LIKE 'MAS636%' ORDER BY EmpCode DESC LIMIT 5`);
  console.log(`SANITY total_rows=${tot[0]?.n} top_MAS636=${mx.map((m) => m.code).join("|") || "none"}`);
  await closeBillPool();
}
main().catch((e) => { console.error(e); process.exit(1); });
