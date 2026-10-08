import { beforeEach, describe, expect, it, vi } from "vitest";

/** Forecast due by the 26th: Branch Heads reminded 20th-26th, Finance Heads told on the 27th. */
const { list, createItem, holders } = vi.hoisted(() => ({ list: vi.fn(), createItem: vi.fn(), holders: vi.fn() }));
vi.mock("../../modules/process-pnl/revenue-forecast.service.js", () => ({ revenueForecastService: { list } }));
vi.mock("../../modules/inbox/inbox.service.js", () => ({ inboxService: { createItem } }));
vi.mock("../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: holders }));

import { forecastPeriodIST, runRevenueForecastReminders } from "../revenue-forecast-reminder.worker.js";

const row = (cc: string, branchId: string, status: string) => ({ costCentreId: cc, costCentreCode: cc, branchId, branchName: branchId === "B1" ? "NOIDA" : "DELHI", status });
const ist = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 9));

beforeEach(() => {
  list.mockReset().mockResolvedValue({ rows: [
    row("CC1", "B1", "missing"), row("CC2", "B1", "draft"), row("CC3", "B1", "approved"),
    row("CC4", "B2", "submitted"), row("CC5", "B2", "closed"),
  ] });
  createItem.mockReset().mockResolvedValue(undefined);
  holders.mockReset().mockImplementation(async (role: string, branch: string | null) => [`${role}:${branch ?? "all"}`]);
});

describe("revenue forecast reminders", () => {
  it("forecasts next month (December -> January)", () => {
    expect(forecastPeriodIST(ist(2026, 10, 21))).toBe("2026-11");
    expect(forecastPeriodIST(ist(2026, 12, 21))).toBe("2027-01");
  });

  it("before the 20th: nothing", async () => {
    expect(await runRevenueForecastReminders(ist(2026, 10, 15))).toBe(0);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("20th-26th: only branches with unsubmitted cost centres, to their Branch Head", async () => {
    await runRevenueForecastReminders(ist(2026, 10, 21));
    expect(list).toHaveBeenCalledWith("2026-11", null);
    expect(createItem).toHaveBeenCalledTimes(1);
    const item = createItem.mock.calls[0][0];
    expect(item.user_id).toBe("branch_head:B1");
    expect(item.type).toBe("REVENUE_FORECAST_DUE");
    expect(item.description).toContain("2 cost centre(s)");
    expect(item.entity_id).toBe("B1:2026-11");
  });

  it("27th: overdue to the Finance Head", async () => {
    await runRevenueForecastReminders(ist(2026, 10, 27));
    expect(createItem.mock.calls.map((c) => [c[0].user_id, c[0].type])).toEqual([["finance_head:all", "REVENUE_FORECAST_OVERDUE"]]);
  });
});
