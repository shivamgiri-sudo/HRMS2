import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { closeExternalDbPools } from "../src/modules/external-db/external-db.service.js";
import { previewPerformanceSources } from "../src/modules/kpi/performance-source-preview.service.js";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function yesterday(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const date = readArg("date") ?? process.env.PERFORMANCE_PREVIEW_DATE ?? yesterday(todayInIndia());
  const yearMonth = readArg("year-month") ?? process.env.PERFORMANCE_PREVIEW_MONTH ?? date.slice(0, 7);
  const result = await previewPerformanceSources({ date, yearMonth });

  console.log("Performance source preview - read only");
  console.log(`Date: ${result.date}`);
  console.log(`Month: ${result.yearMonth}`);
  console.table(Object.values(result.sources).map((source) => ({
    source: source.key,
    connector: source.connectorKey,
    configured: source.configured,
    active: source.active,
    credentials: source.hasCredentials,
    lastTestOk: source.lastTestOk,
    ok: source.ok,
    sourceRows: source.sourceRows,
    mappedRows: source.mappedRows,
    unmappedRows: source.unmappedRows,
    metricFactsPreviewed: source.metrics.length,
    errors: source.errors.join(" | "),
  })));

  for (const source of Object.values(result.sources)) {
    if (source.metrics.length > 0) {
      console.log(`\n${source.key} metric sample`);
      console.table(source.metrics.slice(0, 10));
    }
    if (source.unmappedIdentifiers.length > 0) {
      console.log(`\n${source.key} unmapped identifiers sample`);
      console.table(source.unmappedIdentifiers.map((identifier) => ({ identifier })));
    }
  }

  console.log("\nPreview completed. No INSERT, UPDATE, DELETE, ALTER or DROP statement was executed by this command.");
}

main()
  .catch((error) => {
    console.error("Performance source preview failed:", error instanceof Error ? error.message : error);
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
