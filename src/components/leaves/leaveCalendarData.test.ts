import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: mocks.get } }));

import { CALENDAR_ROW_CAP, fetchApprovedLeavesForMonth } from "./leaveCalendarData";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, from_date: "2026-10-05", to_date: "2026-10-06", total_days: 2, employee_name: "Asha Rao", leave_type_name: "Casual Leave", ...over,
});

describe("fetchApprovedLeavesForMonth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks only for approved leave overlapping the month, so a leave spanning the month edge is included", async () => {
    mocks.get.mockResolvedValue({ data: [row("a")], total: 1 });
    await fetchApprovedLeavesForMonth("2026-10-01", "2026-10-31");
    const q = new URLSearchParams(String(mocks.get.mock.calls[0][0]).split("?")[1]);
    expect(q.get("status")).toBe("approved");
    expect(q.get("overlapFrom")).toBe("2026-10-01");
    expect(q.get("overlapTo")).toBe("2026-10-31");
    expect(q.get("year")).toBeNull();
  });

  it("pages one request at a time, never as a parallel burst", async () => {
    let inFlight = 0; let maxInFlight = 0;
    mocks.get.mockImplementation(async (url: string) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      return { data: Array.from({ length: page < 3 ? 500 : 200 }, (_, i) => row(`p${page}-${i}`)), total: 1200 };
    });
    const out = await fetchApprovedLeavesForMonth("2026-10-01", "2026-10-31");
    expect(out.rows).toHaveLength(1200);
    expect(out.truncated).toBe(false);
    expect(maxInFlight).toBe(1);
  });

  it("stops at the cap and says the month was truncated", async () => {
    mocks.get.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      return { data: Array.from({ length: 500 }, (_, i) => row(`p${page}-${i}`)), total: 9000 };
    });
    const out = await fetchApprovedLeavesForMonth("2026-10-01", "2026-10-31");
    expect(out.rows.length).toBe(CALENDAR_ROW_CAP);
    expect(out.truncated).toBe(true);
    expect(out.total).toBe(9000);
  });

  it("stops if the server runs out early instead of looping", async () => {
    mocks.get.mockResolvedValueOnce({ data: [row("a")], total: 800 }).mockResolvedValueOnce({ data: [], total: 800 });
    const out = await fetchApprovedLeavesForMonth("2026-10-01", "2026-10-31");
    expect(out.rows).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("drops duplicates and rows without usable dates, and normalises names", async () => {
    mocks.get.mockResolvedValue({
      total: 3, data: [row("a"), row("a"), row("b", { from_date: undefined, to_date: undefined })],
    });
    const out = await fetchApprovedLeavesForMonth("2026-10-01", "2026-10-31");
    expect(out.rows.map((r) => r.id)).toEqual(["a"]);
    expect(out.rows[0]).toMatchObject({ start_date: "2026-10-05", employee: { first_name: "Asha", last_name: "Rao" }, leave_type: { name: "Casual Leave" } });
  });
});
