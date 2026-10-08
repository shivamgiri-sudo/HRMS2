/**
 * Sets up the daily MIS report emails: one schedule per process that has an MIS report on the
 * Process Performance V2 MIS tab ("mis:<company>"), every day at 10:00 server time (IST),
 * month to date, to the recipients below. The attachment is the MIS tab's own download
 * (buildMisExcel), so the file is the same as a manual "Download MIS Report".
 *
 *   npx tsx scripts/mis-report-schedules-setup.ts          # dry-run: lists what it would create
 *   npx tsx scripts/mis-report-schedules-setup.ts --send   # creates missing schedules, then sends each one now (test)
 *   npx tsx scripts/mis-report-schedules-setup.ts --send --only=housing_owner,housing_premium   # just these processes
 *
 * Idempotent: a process that already has an active/paused MIS schedule is not created again
 * (its existing schedule is the one sent).
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { getMisCompanies } from "../src/modules/process-performance/mis-export.service.js";
import { createSchedule, parseScheduleInput, runScheduleNow } from "../src/modules/process-performance/mis-schedule.service.js";

const SEND = process.argv.includes("--send");
const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "")
  .split(/[,\s]+/).map((k) => k.trim()).filter(Boolean);
const TO = "tausif.ansari@teammas.in, harsh.singh@teammas.in";
const CREATED_BY = "ops:mis-report-schedules-setup";

// Same labels the MIS tab passes as the report label (src/components/process-performance/v2Dashboards.tsx COMPANIES).
const LABELS: Record<string, string> = {
  bellavita: "Bellavita", gnc: "GNC", neemans: "Neemans", appreciate_health: "Appreciate Wealth",
  housing_owner: "Housing Owner", housing_premium: "Housing Premium", clovia: "Clovia", birlanu: "Birlanu",
  satya_retail: "Satya Retail", lp_feedback: "LP Feedback", lp_onboarding: "LP Onboarding", puresta: "Puresta",
  dalmia: "Dalmia", dubangladesh: "DU Bangladesh", viega: "Viega", exicom: "Exicom",
  sbi_card: "SBI Card Collections", du_thailand: "DU Digital Thailand", du_korea: "DU Digital Korea",
};

const mb = (n?: number) => (n === undefined ? "-" : `${(n / 1024 / 1024).toFixed(2)} MB`);

(async () => {
  const companies = await getMisCompanies();
  const keys = Object.keys(companies).filter((k) => companies[k].length > 0 && (ONLY.length === 0 || ONLY.includes(k)));
  const unknown = ONLY.filter((k) => !companies[k]?.length);
  if (unknown.length) { console.log(`--only names processes with no MIS report: ${unknown.join(", ")}`); process.exit(1); }
  const empty = Object.keys(companies).filter((k) => companies[k].length === 0);
  console.log(`MIS processes with sections (${keys.length}): ${keys.join(", ")}`);
  if (empty.length) console.log(`No MIS sections, skipped: ${empty.join(", ")}`);

  const results: Array<Record<string, unknown>> = [];
  for (const company of keys) {
    const label = LABELS[company] ?? company;
    const [existing] = await db.execute(
      `SELECT id, status FROM mis_email_schedule WHERE dashboard_key = ? AND status IN ('active','paused') ORDER BY created_at LIMIT 1`,
      [`mis:${company}`],
    ) as unknown as [Array<{ id: string; status: string }>, unknown];
    let id = existing[0]?.id;
    const action = id ? `exists (${existing[0].status})` : "create";
    if (!SEND) { console.log(`DRY-RUN ${company} (${label}): ${action}; sections: ${companies[company].map((s) => s.title).join(" | ")}`); continue; }

    if (!id) {
      const parsed = parseScheduleInput({
        dashboardKey: `mis:${company}`, reportTitle: label, to: TO, cc: "",
        subject: `${label} MIS Report - MTD`,
        bodyText: `Hello,\n\nPlease find attached the ${label} MIS report (month to date).\n\nRegards,\nMAS Callnet HRMS`,
        frequency: "daily", sendTime: "10:00", rangeMode: "mtd",
      });
      if (!parsed.ok) { console.log(`${company}: invalid input: ${parsed.error}`); results.push({ company, status: "invalid", error: parsed.error }); continue; }
      const created = await createSchedule(parsed.value, CREATED_BY);
      id = created.id;
      console.log(`${company}: created ${id}, next run ${created.nextRunAt}`);
    }
    const started = Date.now();
    const r = await runScheduleNow(id);
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`${company}: test send ${r?.status ?? "not found"} in ${secs}s, attachment ${mb(r?.attachmentBytes)}${r?.error ? `, error: ${r.error}` : ""}`);
    results.push({ company, label, id, status: r?.status, secs, size: mb(r?.attachmentBytes), error: r?.error ?? null });
  }
  if (SEND) {
    console.log("\nSUMMARY");
    console.table(results);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
