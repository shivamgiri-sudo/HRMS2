// backend/scripts/backfill-performance-scorecard-snapshot.ts
// Usage: npx tsx backend/scripts/backfill-performance-scorecard-snapshot.ts 2026-07-01 2026-08-24
import { writeEmployeePerformanceSnapshots } from "../src/modules/performance-scorecard/performance-scorecard-snapshot.service.js";

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    console.error("Usage: backfill-performance-scorecard-snapshot.ts <fromDate YYYY-MM-DD> <toDate YYYY-MM-DD>");
    process.exit(1);
  }
  const from = new Date(fromArg);
  const to = new Date(toArg);
  let totalWritten = 0;
  let totalErrors = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const { written, errors } = await writeEmployeePerformanceSnapshots(dateStr);
    totalWritten += written;
    totalErrors += errors.length;
    console.log(`${dateStr}: wrote ${written} rows${errors.length > 0 ? `, ${errors.length} errors` : ""}`);
    if (errors.length > 0) {
      console.error(`${dateStr} errors:`, errors.slice(0, 5));
    }
  }
  console.log(`Done. Total written: ${totalWritten}, total errors: ${totalErrors}`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
