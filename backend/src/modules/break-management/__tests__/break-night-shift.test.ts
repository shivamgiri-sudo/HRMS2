import { describe, it, expect, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

const { __shiftInternals: s } = await import("../break-management.service.js");

const master = (id: string, name: string, start: string, end: string) => {
  const m = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  return { id, name, start, end, startMin: m(start), endMin: m(end), processName: null };
};
const masters = [
  master("day", "Day", "09:00", "18:00"),
  master("eve", "Evening", "14:00", "23:00"),
  master("night", "Night", "22:00", "07:00"),
];

describe("break desk night shift + actual shift", () => {
  it("night shift end is next day", () => {
    expect(s.isNightShiftWindow("22:00", "07:00")).toBe(true);
    expect(s.isNightShiftWindow("09:00", "18:00")).toBe(false);
    expect(s.shiftEndInstantMs("2026-10-03", "22:00", "07:00"))
      .toBe(new Date("2026-10-04T07:00:00+05:30").getTime());
  });

  it("night worker mid-shift punch-out is not 'shift end reached'", () => {
    expect(s.isShiftEndReached("2026-10-03 23:30:00", "22:00", "07:00", "2026-10-03")).toBe(false);
    expect(s.isShiftEndReached("2026-10-04 07:05:00", "22:00", "07:00", "2026-10-03")).toBe(true);
  });

  it("actual shift follows punch, not roster", () => {
    expect(s.inferActualShift("2026-10-03 21:50:00", "day", null, masters)?.id).toBe("night");
    expect(s.inferActualShift("2026-10-03 09:20:00", "day", null, masters)?.id).toBe("day");
    expect(s.inferActualShift(null, "day", null, masters)).toBeNull();
    expect(s.inferActualShift("2026-10-03 03:00:00", "day", null, masters)).toBeNull();
  });
});
