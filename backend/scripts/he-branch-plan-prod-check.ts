/** Prints the Hiring Engine branch plan exactly as GET /api/he/branch-plan returns it, plus the inputs behind each row. READ-ONLY. */
import "dotenv/config";
import { planBranches } from "../src/modules/hiring-engine/he-branch-plan.service.js";

(async () => {
  const plan = await planBranches({});
  console.log("BP_META " + JSON.stringify({ asOf: plan.asOf, historyMonths: plan.historyMonths, paceDays: plan.paceDays, totals: plan.totals }));
  for (const r of plan.rows) console.log("BP_ROW " + JSON.stringify({
    branch: r.branch, requisitions: r.requisitions, requested: r.requested, target: r.joinTarget, joined: r.joined, joinsLeft: r.joinsLeft,
    pendingSelected: r.pendingSelected, rates: r.rates, walkinsNeeded: r.walkinsNeeded, booked: r.bookedShows, toBring: r.walkinsToBring,
    pace: r.walkinsPerDay, days: r.daysToTarget, date: r.targetDate, cost: r.cost, status: r.status, note: r.note,
  }));
  await new Promise((resolve) => process.stdout.write("BP_DONE\n", resolve));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
