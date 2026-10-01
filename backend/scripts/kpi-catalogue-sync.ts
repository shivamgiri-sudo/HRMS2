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
} finally {
  await (db as unknown as { end?: () => Promise<void> }).end?.();
  process.exit(0);
}
