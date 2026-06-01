import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
    executeRun: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock("../src/modules/engagement/gamification.service.js", () => ({
  addPoints: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { addPoints } from "../src/modules/engagement/gamification.service.js";
import { checkAutoAwards } from "../src/modules/engagement/badge.service.js";
import {
  getMonthlyKudosLimit,
  listKudos,
  sendKudos,
} from "../src/modules/engagement/kudos.service.js";
import { SubmitPulseCheckSchema } from "../src/modules/engagement/engagement.validation.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockExecuteRun = db.executeRun as ReturnType<typeof vi.fn>;
const mockAddPoints = addPoints as ReturnType<typeof vi.fn>;

function mockBadgeAward(badgeName: string) {
  const badge = {
    badge_id: `badge-${badgeName}`,
    badge_name: badgeName,
    badge_description: null,
    badge_icon: null,
    badge_category: "activity",
    points_value: 30,
    criteria_json: null,
    is_active: 1,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  };
  mockExecute
    .mockResolvedValueOnce([[badge], []])
    .mockResolvedValueOnce([[{ id: "employee-1" }], []])
    .mockResolvedValueOnce([[badge], []])
    .mockResolvedValueOnce([[], []]);
  mockExecuteRun.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
  mockAddPoints.mockResolvedValueOnce({});
}

describe("engagement kudos service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports monthly kudos allowance from the transaction log", async () => {
    mockExecute.mockResolvedValueOnce([[{ given: 3 }], []]);

    await expect(getMonthlyKudosLimit("employee-1")).resolves.toEqual({
      given: 3,
      limit: 10,
      remaining: 7,
    });
  });

  it("creates kudos and awards receiver points", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ given: 0 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockAddPoints.mockResolvedValueOnce({});

    const id = await sendKudos({
      sender_id: "employee-1",
      receiver_id: "employee-2",
      custom_message: "Great save",
    });

    expect(id).toEqual(expect.any(String));
    expect(mockExecute).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO kudos_transaction"),
      expect.arrayContaining([id, "employee-1", "employee-2", 10])
    );
    expect(mockAddPoints).toHaveBeenCalledWith(
      "employee-2",
      10,
      "kudos_received",
      "Kudos received",
      id
    );
  });

  it("blocks self-kudos before touching the database", async () => {
    await expect(sendKudos({
      sender_id: "employee-1",
      receiver_id: "employee-1",
    })).rejects.toThrow("Cannot give kudos to yourself");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("uses the employees.id foreign-key contract in wall queries", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await listKudos();
    expect(mockExecute.mock.calls[0][0]).toContain("sender.id = kt.sender_id");
    expect(mockExecute.mock.calls[0][0]).toContain("receiver.id = kt.receiver_id");
  });
});

describe("engagement pulse validation", () => {
  it("accepts 1-5 ratings", () => {
    expect(SubmitPulseCheckSchema.safeParse({
      employee_id: "00000000-0000-0000-0000-000000000001",
      mood_rating: 5,
      energy_level: 4,
      stress_level: 2,
      week_start_date: "2026-05-25",
    }).success).toBe(true);
  });

  it("rejects ratings above the database scale", () => {
    expect(SubmitPulseCheckSchema.safeParse({
      employee_id: "00000000-0000-0000-0000-000000000001",
      mood_rating: 6,
      week_start_date: "2026-05-25",
    }).success).toBe(false);
  });
});

describe("engagement auto awards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awards Payslip Champion after 10 acknowledgements", async () => {
    mockExecute.mockResolvedValueOnce([[{ acknowledgement_count: 10 }], []]);
    mockBadgeAward("Payslip Champion");

    await expect(checkAutoAwards("employee-1", "payslip_acknowledged")).resolves.toHaveLength(1);
    expect(mockExecuteRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO employee_badge_earned"),
      expect.arrayContaining(["employee-1", "badge-Payslip Champion"])
    );
  });

  it("counts pulse checks toward Survey Champion", async () => {
    mockExecute.mockResolvedValueOnce([[{ participation_count: 10 }], []]);
    mockBadgeAward("Survey Champion");

    await expect(checkAutoAwards("employee-1", "survey_completed")).resolves.toHaveLength(1);
    expect(mockExecute.mock.calls[0][0]).toContain("pulse_check");
  });

  it("awards Top Performer for three KPI periods at or above target", async () => {
    mockExecute.mockResolvedValueOnce([[
      { period: "2026-05", weighted_score_pct: 105 },
      { period: "2026-04", weighted_score_pct: 101 },
      { period: "2026-03", weighted_score_pct: 100 },
    ], []]);
    mockBadgeAward("Top Performer");

    await expect(checkAutoAwards("employee-1", "kpi_score_recorded")).resolves.toHaveLength(1);
    expect(mockExecute.mock.calls[0][0]).toContain("LIMIT 3");
  });

  it("does not award Top Performer when KPI months have a gap", async () => {
    mockExecute.mockResolvedValueOnce([[
      { period: "2026-05", weighted_score_pct: 105 },
      { period: "2026-03", weighted_score_pct: 101 },
      { period: "2026-02", weighted_score_pct: 100 },
    ], []]);

    await expect(checkAutoAwards("employee-1", "kpi_score_recorded")).resolves.toEqual([]);
    expect(mockExecuteRun).not.toHaveBeenCalled();
  });
});
