/**
 * Re-send one branch's Recruitment Activity email for a past date, subject prefixed "[REVISED]".
 * Runs on the prod host (SMTP credentials live there). Dry-run unless --send.
 *
 *   npx tsx scripts/branch-activity-resend.ts <YYYY-MM-DD> <canonical branch> [--send]
 */
import "dotenv/config";
import { sendBranchActivityReports } from "../src/modules/ats/branch-activity-report/index.js";

const [date, branch] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SEND = process.argv.includes("--send");
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !branch) {
  console.error("usage: branch-activity-resend.ts <YYYY-MM-DD> <branch> [--send]");
  process.exit(1);
}
(async () => {
  const results = await sendBranchActivityReports({
    reportDate: date,
    branches: [branch],
    dryRun: !SEND,
    subjectPrefix: "[REVISED] ",
    dashboardUrl: process.env.ATS_BRANCH_ACTIVITY_REPORT_DASHBOARD_URL || undefined,
  });
  for (const r of results) console.log(JSON.stringify({ ...r, mode: SEND ? "SENT" : "DRY-RUN" }));
  if (!results.length) console.log(`no report built for branch "${branch}" on ${date}`);
  process.exit(results.some((r) => r.status === "failed") ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
