import "dotenv/config";
import { verifyPerformanceRun } from "../src/modules/performance-ingestion/performance-manual-upload-verification.service.js";
import { closeDbPool } from "../src/db/mysql.js";

function argument(name: string): string | null {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim() || null;
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "").trim() || null : null;
}

function printUsage(): void {
  console.log("Usage: npm run performance:verify-manual-upload -- --run-id <uuid> [--json]");
}

async function main(): Promise<void> {
  const runId = argument("--run-id");
  if (!runId) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  const certification = await verifyPerformanceRun(runId);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(certification, null, 2));
  } else {
    console.log(`Performance manual-upload certification: ${certification.certified ? "PASS" : "FAIL"}`);
    console.log(`Dataset: ${certification.datasetName} (${certification.datasetKey})`);
    console.log(`Run: ${certification.runId} · ${certification.mode} · ${certification.status}`);
    console.log("");
    for (const item of certification.checks) {
      const evidence = item.expected !== undefined || item.actual !== undefined
        ? ` [expected=${String(item.expected ?? "-")}, actual=${String(item.actual ?? "-")}]`
        : "";
      console.log(`${item.passed ? "PASS" : "FAIL"} ${item.code}: ${item.label}${evidence}`);
      console.log(`  ${item.detail}`);
    }
    console.log("");
    console.log("Counts:");
    console.log(JSON.stringify(certification.counts, null, 2));
  }

  if (!certification.certified) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool().catch(() => undefined);
  });
