import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { closeExternalDbPools } from "../src/modules/external-db/external-db.service.js";
import {
  runSafePerformanceSync,
  runSafePerformanceSyncRange,
} from "../src/modules/kpi/performance-safe-sync.service.js";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

async function main() {
  const from = readArg("from");
  const to = readArg("to");
  const result = from && to
    ? await runSafePerformanceSyncRange({
      from,
      to,
      yearMonth: readArg("year-month"),
      sources: readArg("sources"),
      apply: process.argv.includes("--apply"),
    })
    : await runSafePerformanceSync({
      date: readArg("date"),
      yearMonth: readArg("year-month"),
      sources: readArg("sources"),
      apply: process.argv.includes("--apply"),
    });

  console.log("Performance safe sync");
  console.log(`Mode: ${result.mode}`);
  if ("date" in result) console.log(`Date: ${result.date}`);
  if ("from" in result) console.log(`Range: ${result.from} to ${result.to}`);
  console.log(`Month: ${result.yearMonth}`);
  console.log(`Sources: ${result.sources.join(", ")}`);
  console.log(JSON.stringify(result.results, null, 2));
  console.log(result.note);
}

main()
  .catch((error) => {
    console.error("Performance safe sync failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.race([
      closeExternalDbPools().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    await db.end().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
