import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));
vi.mock("../src/shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(),
}));
vi.mock("../src/modules/engagement/badge.service.js", () => ({
  queueAutoAwards: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { queueAutoAwards } from "../src/modules/engagement/badge.service.js";
import { submitPulseCheck } from "../src/modules/engagement/survey.service.js";
import { kpiService } from "../src/modules/kpi/kpi.service.js";
import { payslipService } from "../src/modules/payroll/payslip.service.js";
import { wfmService } from "../src/modules/wfm/wfm.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockQueueAutoAwards = queueAutoAwards as ReturnType<typeof vi.fn>;

describe("engagement workflow hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues a payslip badge check after acknowledgement", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "payslip-1", employee_id: "employee-1", run_id: "run-1" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: "payslip-1", employee_id: "employee-1", run_id: "run-1" }], []]);

    await payslipService.acknowledgePayslip("payslip-1", "employee-1");
    expect(mockQueueAutoAwards).toHaveBeenCalledWith("employee-1", "payslip_acknowledged");
  });

  it("queues an attendance badge check after clock-out", async () => {
    const session = { id: "session-1", employee_id: "employee-1", login_time: new Date().toISOString() };
    mockExecute
      .mockResolvedValueOnce([[session], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ ...session, current_status: "Logged Out" }], []]);

    await wfmService.clockOut("session-1", "user-1");
    expect(mockQueueAutoAwards).toHaveBeenCalledWith("employee-1", "attendance");
  });

  it("queues KPI badge checks once per employee after bulk scores", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 3 }, []]);

    await kpiService.bulkRecordScores({
      period: "2026-05",
      scores: [
        { employeeId: "employee-1", metricId: "metric-1", actualValue: 110 },
        { employeeId: "employee-1", metricId: "metric-2", actualValue: 105 },
        { employeeId: "employee-2", metricId: "metric-1", actualValue: 115 },
      ],
    }, "user-1");

    expect(mockQueueAutoAwards).toHaveBeenCalledTimes(2);
    expect(mockQueueAutoAwards).toHaveBeenCalledWith("employee-1", "kpi_score_recorded");
    expect(mockQueueAutoAwards).toHaveBeenCalledWith("employee-2", "kpi_score_recorded");
  });

  it("queues a survey badge check after pulse submission", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await submitPulseCheck({
      employee_id: "employee-1",
      mood_rating: 4,
      week_start_date: "2026-06-01",
    });

    expect(mockQueueAutoAwards).toHaveBeenCalledWith("employee-1", "survey_completed");
  });
});
