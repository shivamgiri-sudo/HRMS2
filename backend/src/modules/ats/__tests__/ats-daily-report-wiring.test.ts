import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The daily recruiter productivity report was described as a scheduled job and was not one.
 *
 *   - ats-daily-report.service.ts's header says "Called by the 6 PM cron in
 *     ats-reminders.cron.ts". There is no 6 PM cron: startAtsRemindersScheduler()
 *     schedules 9 PM and 8 AM only, and neither calls runDailyHiringReport().
 *   - Every call site was a manual or test route, three of them unauthenticated.
 *   - Its branch list was hardcoded to three of the six active branches.
 *
 * These are source contracts rather than behaviour tests because what broke was wiring:
 * the function itself always worked when something called it.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Comments are not code. Both files below explain in prose what they removed, and those
 * explanations name the very strings these tests assert are gone — so the assertions run
 * against executable lines only.
 */
const codeOnly = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trimStart();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const cron = read("src/modules/ats/ats-daily-report.cron.ts");
const reminders = read("src/modules/ats/ats-reminders.cron.ts");
const health = read("src/routes/health.routes.ts");
const testRoute = read("src/modules/ats/test-daily-report.routes.ts");
const server = read("src/server.ts");
const workers = read("src/workers/all-workers.ts");

describe("the daily report is actually scheduled", () => {
  it("has its own scheduler that calls runDailyHiringReport", () => {
    expect(cron).toContain("runDailyHiringReport");
    expect(cron).toMatch(/TARGET_HOUR\s*=\s*18/);
  });

  it("is registered in BOTH topologies — one alone is how ats-reminders never ran", () => {
    for (const f of [server, workers]) {
      expect(f).toContain("startAtsDailyReportScheduler");
    }
  });

  it("uses its own flag, NOT the one that releases the onboarding reminder burst", () => {
    for (const f of [server, workers]) {
      expect(f).toContain("ATS_DAILY_REPORT_ENABLED");
    }
    // The reminder burst must stay exactly as locked as it was.
    expect(server).toContain('process.env.ATS_REMINDERS_ENABLED === "true"');
    expect(workers).toContain('process.env.ATS_REMINDERS_ENABLED === "true"');
  });

  it("schedules with no hardcoded date, so it reports the day it runs", () => {
    // The manual routes pass an explicit date; a scheduled run must not, or every
    // day's report describes the same fixed day.
    expect(cron).not.toMatch(/runDailyHiringReport\(\s*['"]\d{4}-\d{2}-\d{2}['"]/);
  });
});

describe("branch coverage", () => {
  it("derives branches from branch_master instead of the hardcoded three", () => {
    // 6 active branches exist; the fixed list named 3, so Delhi Office, HEAD OFFICE and
    // NOIDA-DIALDESK never appeared in a branch-wise report.
    expect(reminders).toContain("FROM branch_master b");
    expect(reminders).toContain("b.active_status = 1");
  });

  it("keeps the original list as a fallback rather than throwing", () => {
    expect(reminders).toContain("['NOIDA', 'NOIDA-2', 'AHMEDABAD-JALDARSHAN']");
    expect(reminders).toContain("branch lookup failed");
  });
});

describe("the unauthenticated triggers are gone", () => {
  it("the health router no longer sends the hiring report", () => {
    // A health endpoint is polled by load balancers and uptime monitors — the worst
    // possible place to hang a mail side effect.
    const code = codeOnly(health);
    expect(code).not.toContain("runDailyHiringReport");
    expect(code).not.toContain("send-test-report-shivam");
    expect(code).not.toContain("sendDailyReport2024");
  });

  it("the manual trigger requires auth and an authorised role", () => {
    expect(testRoute).toContain("requireAuth");
    expect(testRoute).toContain("requireRole(...REPORT_ROLES)");
    expect(testRoute).not.toContain("PUBLIC TEST ENDPOINT");
  });

  it("refuses to mail the report to an arbitrary outside address", () => {
    expect(testRoute).toContain("ALLOWED_RECIPIENT");
    expect(testRoute).toMatch(/teammas\\?\.\(in\|co\\?\.in\)/);
  });

  it("no longer defaults to a hardcoded date or a hardcoded personal recipient", () => {
    const code = codeOnly(testRoute);
    expect(code).not.toContain("2026-08-24");
    expect(code).not.toContain("shivam.giri@teammas.in");
  });
});
