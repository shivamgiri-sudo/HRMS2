/**
 * READ-ONLY. There are two separately-implemented UAN/PF filing-readiness resolvers in this
 * codebase:
 *   1. pf-applicability.service.ts: resolveUanFilingReadinessForPeriod / summariseUanFilingReadiness
 *      (the original, referenced by project memory hrms2-uan-filing-readiness-added, added aeee37b0)
 *   2. statutory-filing-readiness.service.ts: resolveStatutoryFilingReadinessForPeriod / summariseFilingReadiness
 *      (a newer, broader one also covering ESI)
 *
 * Both claim to answer "is this employee's UAN/PF filing-ready". This script runs both against
 * the same period and reports whether they agree, so a genuine duplicate-resolver disagreement
 * (matching the already-documented pattern of 5 disagreeing PF-eligibility sources) can be
 * confirmed or ruled out with real numbers instead of assumed from the function names alone.
 *
 * Writes nothing.
 * Usage: ./node_modules/.bin/tsx scripts/uan-readiness-cross-check.ts [YYYY-MM]
 */
import {
  resolveUanFilingReadinessForPeriod,
  summariseUanFilingReadiness,
} from "../src/modules/payroll/pf-applicability.service.js";
import {
  resolveStatutoryFilingReadinessForPeriod,
  summariseFilingReadiness,
} from "../src/modules/payroll/statutory-filing-readiness.service.js";
import { closeBillPool } from "../src/db/billDb.js";

const month = process.argv[2] || "2026-07";

async function main() {
  console.log(`Cross-checking UAN/PF filing readiness resolvers for ${month}...\n`);

  const a = await resolveUanFilingReadinessForPeriod(month);
  const summaryA = summariseUanFilingReadiness(a.values());
  console.log("=== Resolver 1: pf-applicability.service.ts (resolveUanFilingReadinessForPeriod) ===");
  console.log(`Population: ${a.size}`);
  console.log(JSON.stringify(summaryA, null, 2));

  const b = await resolveStatutoryFilingReadinessForPeriod(month);
  const summaryB = summariseFilingReadiness(b.values(), "pf");
  console.log("\n=== Resolver 2: statutory-filing-readiness.service.ts (resolveStatutoryFilingReadinessForPeriod, pf scheme) ===");
  console.log(`Population: ${b.size}`);
  console.log(JSON.stringify(summaryB, null, 2));

  // Per-employee disagreement
  let disagreements = 0;
  const sample: string[] = [];
  for (const [code, resultA] of a) {
    const resultB = b.get(code);
    if (!resultB) continue;
    if (resultA.status !== resultB.pf.status) {
      disagreements++;
      if (sample.length < 15) {
        sample.push(`  ${code}: resolver1=${resultA.status} resolver2=${resultB.pf.status}`);
      }
    }
  }
  console.log(`\n=== Per-employee status disagreement: ${disagreements} of ${a.size} ===`);
  if (sample.length) {
    console.log(sample.join("\n"));
  } else if (disagreements === 0) {
    console.log("Zero disagreement - the two resolvers agree on every employee's status label.");
  }

  await closeBillPool();
  process.exit(0);
}

main().catch((err) => {
  console.error("Cross-check failed:", err);
  process.exit(1);
});
