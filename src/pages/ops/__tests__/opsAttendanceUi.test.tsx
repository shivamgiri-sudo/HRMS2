import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  ATTENDANCE_ISSUE_GUIDE, BACKFILL_ROLES, CLOSE_ROLES, countClosable, guideFor, suggestBackfillRange, summariseTypes, timeAgo,
} from "@/pages/ops/attendanceGuide";
import { OpsSyncHealthView, type SyncHealthData } from "@/pages/ops/OpsSyncHealth";
import { OpsAttendanceActions } from "@/pages/ops/OpsAttendanceActions";

const rows = [
  { issueDate: "2026-07-26", issueType: "missing_adr", daysOpen: 69 },
  { issueDate: "2026-07-26", issueType: "missing_adr", daysOpen: 69 },
  { issueDate: "2026-07-27", issueType: "missing_adr", daysOpen: 68 },
  { issueDate: "2026-09-30", issueType: "zero_minute_attendance", daysOpen: 3 },
  { issueDate: "2026-08-01", issueType: "unmapped_cosec_user", daysOpen: 63 },
];

describe("guide", () => {
  it("every known type has a plain explanation and an action, in words a non-technical reader can follow", () => {
    for (const [type, g] of Object.entries(ATTENDANCE_ISSUE_GUIDE)) {
      expect(g.label.length, type).toBeGreaterThan(8);
      expect(g.plain.length, type).toBeGreaterThan(30);
      expect(g.action.length, type).toBeGreaterThan(20);
      expect(`${g.label}${g.plain}${g.action}`, type).not.toMatch(/_|adr|cosec|ibd/i); // no internal jargon
    }
  });
  it("an unknown type still gets a readable fallback", () => {
    expect(guideFor("some_new_type").label).toBe("some new type");
  });
  it("summarises by cause, biggest first, and counts items old enough to close", () => {
    expect(summariseTypes(rows).map((t) => [t.type, t.count])).toEqual([["missing_adr", 3], ["zero_minute_attendance", 1], ["unmapped_cosec_user", 1]]);
    expect(countClosable(rows)).toBe(4);
  });
  it("suggests a back-fill range from the missing-record days, never including today and never over 31 days", () => {
    expect(suggestBackfillRange(rows, "2026-10-03")).toEqual({ from: "2026-07-26", to: "2026-07-27" });
    expect(suggestBackfillRange([{ issueDate: "2026-06-01", issueType: "missing_adr" }, { issueDate: "2026-09-01", issueType: "missing_adr" }], "2026-10-03")).toEqual({ from: "2026-06-01", to: "2026-07-01" });
    expect(suggestBackfillRange([{ issueDate: "2026-10-03", issueType: "missing_adr" }], "2026-10-03")).toBeNull();
    expect(suggestBackfillRange([{ issueDate: "2026-07-26", issueType: "zero_minute_attendance" }], "2026-10-03")).toBeNull();
  });
  it("close roles include HR, backfill roles do not", () => {
    expect(CLOSE_ROLES).toContain("hr");
    expect(BACKFILL_ROLES).not.toContain("hr");
    expect(BACKFILL_ROLES).toEqual(expect.arrayContaining(["admin", "payroll_head"]));
  });
  it("timeAgo reads naturally", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo("2026-10-03T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-03T11:15:00Z", now)).toBe("45 min ago");
    expect(timeAgo("2026-10-03T06:00:00Z", now)).toBe("6 h ago");
    expect(timeAgo("2026-09-28T12:00:00Z", now)).toBe("5 days ago");
  });
});

describe("OpsSyncHealthView", () => {
  const data: SyncHealthData = {
    generatedAt: "x", lowDays: 1, days: ["2026-10-01", "2026-10-02"],
    jobs: [
      { key: "biometric", label: "Biometric sync (COSEC)", lastRunAt: "2026-10-03T11:30:00Z", status: "completed", tone: "ok", note: "120 day(s) written" },
      { key: "engine", label: "Nightly attendance engine", lastRunAt: null, status: null, tone: "unknown", note: null },
    ],
    coverage: [{ branchId: "b", branchName: "NOIDA", activeStaff: 420, days: [{ date: "2026-10-01", records: 235, pct: 56, low: true }, { date: "2026-10-02", records: 430, pct: 100, low: false }] }],
  };
  const html = renderToStaticMarkup(<OpsSyncHealthView data={data} nowMs={Date.parse("2026-10-03T12:00:00Z")} />);
  it("states plainly whether the pipeline missed a day, and which one is worst", () => {
    expect(html).toContain("1 branch-day below 90% recorded");
    expect(html).toContain("lowest: NOIDA 01/10 at 56%");
  });
  it("shows each job's health and age, and 'No record yet' when a job has never run", () => {
    expect(html).toContain("Biometric sync (COSEC)");
    expect(html).toContain("Healthy · last run 30 min ago");
    expect(html).toContain("No record yet · last run never");
  });
  it("highlights the low day and opens the table by default when there is a dip", () => {
    expect(html).toContain("bg-red-50 font-semibold text-red-700");
    expect(html).toMatch(/<details[^>]* open/);
  });
  it("says everything is fine, and keeps the table closed, when nothing dipped", () => {
    const ok = renderToStaticMarkup(<OpsSyncHealthView data={{ ...data, lowDays: 0, coverage: [{ ...data.coverage[0]!, days: data.coverage[0]!.days.map((d) => ({ ...d, low: false, pct: 100 })) }] }} />);
    expect(ok).toContain("Every branch had its staff recorded on each of the last 7 days.");
    expect(ok).not.toMatch(/<details[^>]* open/);
  });
});

describe("OpsAttendanceActions", () => {
  const render = (canClose: boolean, canBackfill: boolean, r = rows) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <OpsAttendanceActions branchId="b" branchName="NOIDA" rows={r} canClose={canClose} canBackfill={canBackfill} onChanged={() => undefined} />
      </QueryClientProvider>,
    );
  it("explains each cause in plain words with what to do, for everyone", () => {
    const html = render(false, false);
    expect(html).toContain("No attendance record");
    expect(html).toContain("never created an attendance record");
    expect(html).toContain("What to do:");
    expect(html).toContain("repaired automatically every night");
  });
  it("a plain viewer gets no action buttons", () => {
    const html = render(false, false);
    expect(html).not.toContain("Close old items as reviewed");
    expect(html).not.toContain("Back-fill missing records");
  });
  it("HR gets Close but not Back-fill", () => {
    const html = render(true, false);
    expect(html).toContain("Close old items as reviewed");
    expect(html).not.toContain("Back-fill missing records");
  });
  it("admin / payroll head get both", () => {
    const html = render(true, true);
    expect(html).toContain("Close old items as reviewed");
    expect(html).toContain("Back-fill missing records");
  });
  it("offers nothing when there is nothing old to close and no missing-record days to fill", () => {
    const html = render(true, true, [{ issueDate: "2026-09-30", issueType: "zero_minute_attendance", daysOpen: 3 }]);
    expect(html).not.toContain("Close old items as reviewed");
    expect(html).not.toContain("Back-fill missing records");
  });
});
