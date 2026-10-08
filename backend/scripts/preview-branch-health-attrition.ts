// Read-only preview: builds ONE branch's Branch Health Report from live data (nothing is sent, nothing is
// written) and prints whether the Attrition & Retention Risk section came out, with its numbers.
// Names and employee codes are deliberately not printed - this runs in a CI log.
//
//   DOTENV_CONFIG_PATH=/var/www/HRMS2/backend/.env npx tsx scripts/preview-branch-health-attrition.ts "NOIDA-2"
import "dotenv/config";
import { fetchAllBranchHealthData } from "../src/modules/branch-health-report/query.js";
import { buildBranchHealthReport } from "../src/modules/branch-health-report/metrics.js";
import { renderEmail, subjectLine } from "../src/modules/branch-health-report/template.js";

const branch = process.argv[2] || "NOIDA-2";
const date = new Date().toISOString().slice(0, 10);
const t0 = Date.now();
const raw = await fetchAllBranchHealthData(branch, date);
const report = buildBranchHealthReport(branch, date, raw);
const html = renderEmail(report, { generatedAt: new Date().toISOString() });
const at = raw.attrition;
console.log(`branch: ${branch}  built in ${Math.round((Date.now() - t0) / 1000)}s  subject: ${subjectLine(report)}`);
console.log(`email size: ${html.length} bytes; has attrition section: ${html.includes("Attrition &amp; Retention Risk") || html.includes("Attrition & Retention Risk")}`);
console.log("attrition data:", at ? JSON.stringify({
  headcount: at.headcount, critical: at.critical, high: at.high, medium: at.medium, low: at.low, expectedExits30: at.expectedExits30,
  absentStreak: at.absentStreak, newJoinerRisk: at.newJoinerRisk, exits30: at.exits30, exitsPrev30: at.exitsPrev30, exits90: at.exits90,
  earlyExitSharePct: at.earlyExitSharePct, monthlyExits: at.monthlyExits.length, processes: at.byProcess.length, topRisk: at.topRisk.length,
  topRiskScores: at.topRisk.map((p) => `${p.score} ${p.tier}`),
}) : "NULL (section left out)");
console.log("critical points:", report.criticalPoints.map((c) => `[${c.severity}] ${c.label}`).filter((l) => /attrition|absent|exits rising/i.test(l)).join(" | ") || "none from attrition");
console.log("overall status:", report.overallStatus);
process.exit(0);
