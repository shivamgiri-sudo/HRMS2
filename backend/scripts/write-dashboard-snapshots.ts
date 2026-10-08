/**
 * Records one day of dashboard_metric_snapshot, which is what every trend arrow reads.
 *
 * Intended as a nightly job, after the attendance reconciliation has run — snapshots taken
 * mid-reconciliation would freeze a half-processed attendance figure as the baseline the
 * next day is judged against.
 *
 *   npx tsx scripts/write-dashboard-snapshots.ts --dry-run       # compute, write nothing
 *   npx tsx scripts/write-dashboard-snapshots.ts --scope=org
 *   npx tsx scripts/write-dashboard-snapshots.ts --scope=org,branch
 *   npx tsx scripts/write-dashboard-snapshots.ts                 # org + branch + process
 *
 * A trend needs at least two runs on different days before any arrow appears. That is not a
 * defect to work around by back-filling invented history: a fabricated baseline would put a
 * made-up percentage on a real tile.
 */
import { db } from "../src/db/mysql.js";
import {
  resolveSnapshotTargets,
  writeDashboardSnapshots,
  type SnapshotScopeKind,
} from "../src/modules/dashboards/dashboard-snapshot.service.js";
import { getAllMetricCodes } from "../src/modules/dashboards/dashboard-definition.service.js";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

const scopeArg = argv.find((a) => a.startsWith("--scope="))?.split("=")[1];
const kinds = (scopeArg
  ? scopeArg.split(",").map((s) => s.trim().toUpperCase())
  : ["ORG", "BRANCH", "PROCESS"]) as SnapshotScopeKind[];

const invalid = kinds.filter((k) => !["ORG", "BRANCH", "PROCESS"].includes(k));
if (invalid.length) {
  console.error(`unknown scope(s): ${invalid.join(", ")} — expected org, branch or process`);
  process.exit(2);
}

const host = process.env.DB_HOST ?? "(unset)";
console.log(`dashboard snapshot writer`);
console.log(`  database : ${host} / ${process.env.DB_NAME ?? "(unset)"}`);
console.log(`  scopes   : ${kinds.join(", ")}`);
console.log(`  mode     : ${dryRun ? "DRY RUN — nothing will be written" : "WRITE"}`);

const targets = await resolveSnapshotTargets(kinds);
const metricCount = getAllMetricCodes().length;
console.log(`  targets  : ${targets.length} scopes x ${metricCount} metrics = ${targets.length * metricCount} computations\n`);

if (dryRun) {
  // Show exactly which scopes would be written, so the cost and coverage are reviewable
  // before anything touches the table.
  const byKind = new Map<string, number>();
  for (const t of targets) byKind.set(t.scopeType, (byKind.get(t.scopeType) ?? 0) + 1);
  for (const [kind, n] of byKind) console.log(`  ${kind.padEnd(8)} ${n} scope(s)`);
  console.log(`\nDRY RUN — no rows written.`);
  await db.end?.();
  process.exit(0);
}

let lastPct = -1;
const started = Date.now();
const result = await writeDashboardSnapshots({
  kinds,
  onProgress: (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct !== lastPct && pct % 10 === 0) {
      lastPct = pct;
      console.log(`  ${pct}%  (${done}/${total})`);
    }
  },
});

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\nsnapshot_date : ${result.snapshotDate}`);
console.log(`written       : ${result.written}`);
console.log(`skipped       : ${result.skippedNoValue}  (metric had no value for that scope)`);
console.log(`failed        : ${result.failed}`);
console.log(`elapsed       : ${seconds}s`);

if (result.failures.length) {
  console.log(`\nfailures (first 15):`);
  for (const f of result.failures.slice(0, 15)) {
    console.log(`  ${f.metricCode.padEnd(24)} ${f.scope.padEnd(34)} ${f.reason}`);
  }
}

await db.end?.();
// A failure means some metric is unrecordable for some scope; surface it to the scheduler
// rather than letting a silently-degrading job look healthy in cron logs.
process.exit(result.failed > 0 ? 1 : 0);
