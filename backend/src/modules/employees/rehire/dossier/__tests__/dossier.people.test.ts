import { describe, it, expect, vi } from "vitest";
import { loadLeaveSection, loadLearningSection } from "../dossier.people.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("loadLeaveSection", () => {
  const typeRows = [
    { leave_type: "Casual Leave", paid: 1, requests: "4", days: "6.0", short_notice: "3", weekend_adjacent: "2" },
    { leave_type: "Loss of Pay", paid: 0, requests: "1", days: "2.0", short_notice: "1", weekend_adjacent: "1" },
  ];

  it("totals leave and splits paid from unpaid", async () => {
    const ex = executor({ "FROM leave_request": typeRows, "FROM leave_balance_ledger": [] });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.byType).toHaveLength(2);
    expect(s.totalDays).toBe(8);
    expect(s.paidDays).toBe(6);
    expect(s.unpaidDays).toBe(2);
    expect(s.totalRequests).toBe(5);
  });

  it("reports short-notice and weekend-adjacent counts and their shares", async () => {
    const ex = executor({ "FROM leave_request": typeRows, "FROM leave_balance_ledger": [] });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.shortNoticeRequests).toBe(4);
    expect(s.weekendAdjacentRequests).toBe(3);
    expect(s.shortNoticePct).toBe(80);
    expect(s.weekendAdjacentPct).toBe(60);
  });

  it("only counts approved leave", async () => {
    const ex = executor({ "FROM leave_request": [], "FROM leave_balance_ledger": [] });
    await loadLeaveSection(ex as never, w);
    const sql = String(ex.execute.mock.calls.find(([s]) => String(s).includes("FROM leave_request"))![0]);
    expect(sql).toMatch(/status IN \('approved',\s*'branch_head_approved'\)/i);
  });

  it("picks the latest balance year per leave type", async () => {
    const ex = executor({
      "FROM leave_request": [],
      "FROM leave_balance_ledger": [
        { leave_type: "Casual Leave", balance_year: 2026, allocated_days: "12", used_days: "5", adjusted_days: "0" },
        { leave_type: "Casual Leave", balance_year: 2025, allocated_days: "12", used_days: "12", adjusted_days: "0" },
      ],
    });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.balances).toEqual([{ leaveType: "Casual Leave", year: 2026, allocated: 12, used: 5, available: 7 }]);
  });

  it("gives null shares when there is no leave", async () => {
    const ex = executor({ "FROM leave_request": [], "FROM leave_balance_ledger": [] });
    const s = await loadLeaveSection(ex as never, w);
    expect(s.totalRequests).toBe(0);
    expect(s.shortNoticePct).toBeNull();
  });
});

describe("loadLearningSection", () => {
  it("summarises courses and lists certifications", async () => {
    const ex = executor({
      "FROM lms_learning_progress_snapshot": [
        { course_name: "Product 101", completion_pct: "100", status: "completed" },
        { course_name: "Compliance", completion_pct: "40", status: "in_progress" },
      ],
      "FROM lms_certification_snapshot": [{ certification_name: "Sales L1", issued_date: "2026-03-01", expiry_date: null, status: "active" }],
    });
    const s = await loadLearningSection(ex as never, w);
    expect(s.coursesTotal).toBe(2);
    expect(s.coursesCompleted).toBe(1);
    expect(s.avgCompletionPct).toBe(70);
    expect(s.certifications).toEqual([{ name: "Sales L1", issued: "2026-03-01", expires: null, status: "active" }]);
  });

  it("returns nulls when the employee has no LMS data", async () => {
    const ex = executor({ "FROM lms_learning_progress_snapshot": [], "FROM lms_certification_snapshot": [] });
    const s = await loadLearningSection(ex as never, w);
    expect(s.coursesTotal).toBe(0);
    expect(s.avgCompletionPct).toBeNull();
    expect(s.certifications).toEqual([]);
  });
});
