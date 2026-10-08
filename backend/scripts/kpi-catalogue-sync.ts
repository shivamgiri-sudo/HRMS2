/**
 * Loads the KPI catalogue seed, links Studio definitions and records the reconciliation. Idempotent; writes only to the
 * kpi_catalogue* tables and kpi_studio_definition.catalogue_id. Run on the production host (see
 * .github/workflows/ops-kpi-catalogue-sync.yml) or locally with DB env vars.
 */
import "dotenv/config";
import { syncSeed } from "../src/modules/kpi-catalogue/kpi-catalogue.service.js";
import { linkAllUnlinkedDefinitions } from "../src/modules/kpi-catalogue/kpi-catalogue.studio-sync.js";
import { recordDrift } from "../src/modules/kpi-catalogue/kpi-catalogue.drift.js";
import { db } from "../src/db/mysql.js";

try {
  const seed = await syncSeed();
  console.log("seed:", JSON.stringify(seed));
  const studio = await linkAllUnlinkedDefinitions();
  console.log("studio link:", JSON.stringify(studio));
  const drift = await recordDrift();
  console.log("reconciliation:", JSON.stringify(drift));
  // Row-level detail for the conflicts worth acting on (legacy_only_metric is a long informational list).
  const [rows] = await db.execute(
    `SELECT conflict_type, process_key, metric_key, detail FROM kpi_catalogue_conflict
      WHERE resolved = 0 AND conflict_type <> 'legacy_only_metric' ORDER BY conflict_type, process_key, metric_key LIMIT 120`,
  );
  for (const r of rows as Array<Record<string, unknown>>) {
    console.log(`conflict | ${r.conflict_type} | ${r.process_key ?? "-"} | ${r.metric_key ?? "-"} | ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}`);
  }
} finally {
  await (db as unknown as { end?: () => Promise<void> }).end?.();
  process.exit(0);
}
