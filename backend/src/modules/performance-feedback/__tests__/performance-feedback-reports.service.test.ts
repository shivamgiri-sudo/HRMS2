import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "../../../db/mysql.js";
import { PerformanceFeedbackService } from "../performance-feedback.service.js";

describe("PerformanceFeedbackService report reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps the live report schema and limits employees to their own reports", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);

    await new PerformanceFeedbackService().getReports({ employee_id: "employee-1" });

    const [sql, params] = vi.mocked(db.execute).mock.calls[0];
    expect(sql).toContain("pfr.report_id AS id");
    expect(sql).toContain("pfr.overall_score AS final_rating");
    expect(sql).toContain("pfr.employee_id = ?");
    expect(params).toEqual(["employee-1"]);
  });

  it("limits manager report lists to direct reports", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);

    await new PerformanceFeedbackService().getReports({ manager_id: "manager-1" });

    const [sql, params] = vi.mocked(db.execute).mock.calls[0];
    expect(sql).toContain("e.reporting_manager_id = ?");
    expect(params).toEqual(["manager-1"]);
  });

  it("enforces employee and manager scope when loading a report detail", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);

    const report = await new PerformanceFeedbackService().getReportById("report-1", {
      employee_id: "manager-1",
      manager_id: "manager-1",
    });

    const [sql, params] = vi.mocked(db.execute).mock.calls[0];
    expect(sql).toContain("(pfr.employee_id = ? OR e.reporting_manager_id = ?)");
    expect(params).toEqual(["report-1", "manager-1", "manager-1"]);
    expect(report).toBeNull();
  });
});
