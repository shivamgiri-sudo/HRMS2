import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
vi.mock("../src/modules/engagement/badge.service.js", () => ({
  checkAutoAwards: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { checkAutoAwards } from "../src/modules/engagement/badge.service.js";
import {
  millisecondsUntilNextTenureSweep,
  runTenureBadgeSweep,
} from "../src/modules/engagement/tenure.cron.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockCheckAutoAwards = checkAutoAwards as ReturnType<typeof vi.fn>;

describe("tenure badge sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues after an employee evaluation fails", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "employee-1" }, { id: "employee-2" }], []]);
    mockCheckAutoAwards
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce([]);

    await expect(runTenureBadgeSweep()).resolves.toEqual({ checked: 2, failed: 1 });
    expect(mockCheckAutoAwards).toHaveBeenNthCalledWith(2, "employee-2", "tenure");
  });

  it("schedules the next sweep for 2 AM", () => {
    const now = new Date("2026-06-01T01:30:00");
    expect(millisecondsUntilNextTenureSweep(now)).toBe(30 * 60 * 1000);
  });
});
