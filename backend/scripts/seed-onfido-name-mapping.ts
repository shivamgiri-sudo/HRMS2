/**
 * seed-onfido-name-mapping.ts
 * Reads every distinct raw TL/AM name from onfido_db, matches each against
 * the active employee roster (mas_hrms), and writes the result into
 * onfido_name_employee_map (see migration backend/sql/1869_onfido_name_employee_map.sql).
 *
 * Idempotent -- safe to re-run any number of times:
 *   - unchanged names resolve to the same match, so the write is a no-op in effect;
 *   - a row an HR reviewer already verified (verified_by_hr = 1) is never
 *     overwritten by this script -- see upsertMapping()'s own guard.
 *
 * All matching logic lives in onfido-name-mapping.service.ts (runNameMappingSeed),
 * unit-tested with mocked pools -- this script is a thin CLI wrapper only,
 * following the same shape as scripts/seed-question-bank.ts.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/seed-onfido-name-mapping.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { closeOnfidoPool } from "../src/db/onfidoDb.js";
import { runNameMappingSeed } from "../src/modules/onfido-process/onfido-name-mapping.service.js";

async function main() {
  try {
    console.log("Seeding onfido_name_employee_map from onfido_db + employees...");
    const result = await runNameMappingSeed();
    console.log("\nSeed complete.");
    console.log(`  Matched (exact_name) : ${result.matched}`);
    console.log(`  Ambiguous            : ${result.ambiguous}`);
    console.log(`  Unmatched            : ${result.unmatched}`);
    if (result.errors.length) {
      console.error("\nErrors:");
      result.errors.forEach((e) => console.error(" ", e));
      process.exitCode = 1;
    }
  } finally {
    await Promise.all([db.end(), closeOnfidoPool()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
