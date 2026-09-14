import "dotenv/config";
import { annualBudgetSummaryService } from "../src/modules/process-pnl/annual-budget-summary.service.js";

async function main() {
  // All branches, FY2026-27
  const all = await annualBudgetSummaryService.getAnnualBudgetSummary("2026-27");
  console.log(`Branches: ${all.branches.length}, periods: ${all.periods.join(",")}`);
  console.log("Grand total:", all.grandTotal);

  const nonZero = all.branches.filter((b) => b.annualBudget > 0 || b.annualActual > 0);
  console.log(`Branches with any budget or actual: ${nonZero.length}`);
  console.log(
    nonZero
      .sort((a, b) => b.annualActual - a.annualActual)
      .slice(0, 10)
      .map((b) => ({ branch: b.branchName, budget: b.annualBudget.toFixed(0), actual: b.annualActual.toFixed(0), variance: b.annualVariance.toFixed(0) }))
  );

  // Single-branch test (NOIDA-2, known from the earlier investigation)
  const noida2Id = "febd8777-6583-11f1-adb1-00155d0ab410";
  const single = await annualBudgetSummaryService.getAnnualBudgetSummary("2026-27", [noida2Id]);
  console.log("\nNOIDA-2 only:", JSON.stringify(single.branches[0], null, 2));
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
