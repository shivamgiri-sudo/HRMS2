/**
 * READ-ONLY. Calls the existing resolveStatutoryFilingReadinessForPeriod() /
 * summariseFilingReadiness() resolver (statutory-filing-readiness.service.ts) directly and
 * prints the population breakdown for PF/UAN and ESI filing readiness for one payroll month.
 *
 * This resolver has no route/API consumer as of this writing (grep confirms zero references
 * in any *.routes.ts) - this script is the only way to see its output today short of a REPL.
 * Writes nothing; the underlying functions are pure reads.
 *
 * Usage: ./node_modules/.bin/tsx scripts/statutory-filing-readiness-scan.ts [YYYY-MM]
 */
import {
  resolveStatutoryFilingReadinessForPeriod,
  summariseFilingReadiness,
} from "../src/modules/payroll/statutory-filing-readiness.service.js";
import { closeBillPool } from "../src/db/billDb.js";

const month = process.argv[2] || "2026-07";

async function main() {
  console.log(`Resolving statutory filing readiness for ${month}...`);
  const results = await resolveStatutoryFilingReadinessForPeriod(month);
  console.log(`Resolved for ${results.size} active employees.\n`);

  const pf = summariseFilingReadiness(results.values(), "pf");
  const esi = summariseFilingReadiness(results.values(), "esi");

  console.log("=== PF/UAN ===");
  console.log(JSON.stringify(pf, null, 2));
  console.log("\n=== ESI ===");
  console.log(JSON.stringify(esi, null, 2));

  await closeBillPool();
  process.exit(0);
}

main().catch((err) => {
  console.error("Scan failed:", err);
  process.exit(1);
});
