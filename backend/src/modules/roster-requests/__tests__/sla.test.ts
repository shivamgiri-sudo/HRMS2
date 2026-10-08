import { describe, expect, it } from "vitest";
import { computeSla, parseDbTimestamp } from "../roster-requests.sla.js";

const now = new Date("2026-10-02T10:00:00Z");

describe("computeSla", () => {
  it("is urgent when the shift is within 24h", () => {
    expect(computeSla("2026-10-02T08:00:00Z", "2026-10-03", now).state).toBe("urgent");
  });
  it("is overdue when pending more than 48h and shift not within 24h", () => {
    expect(computeSla("2026-09-29T10:00:00Z", "2026-10-20", now).state).toBe("overdue");
  });
  it("is due_soon between 24h and 48h pending", () => {
    expect(computeSla("2026-10-01T00:00:00Z", "2026-10-20", now).state).toBe("due_soon");
  });
  it("is ok when fresh", () => {
    expect(computeSla("2026-10-02T09:00:00Z", "2026-10-20", now).state).toBe("ok");
  });
  it("returns ageHours rounded down", () => {
    expect(computeSla("2026-10-02T07:30:00Z", "2026-10-20", now).ageHours).toBe(2);
  });
  it("treats an unparseable raisedAt as ok with age 0", () => {
    expect(computeSla("nope", "2026-10-20", now)).toEqual({ state: "ok", ageHours: 0 });
  });

  it("parses a naive DB string as IST (same ageHours as the equivalent Z instant)", () => {
    // 2026-10-02 10:00:00 IST == 04:30Z; now 10:00Z -> 5.5h -> 5
    const naive = computeSla("2026-10-02 10:00:00", "2026-10-20", now);
    const z = computeSla("2026-10-02T04:30:00Z", "2026-10-20", now);
    expect(naive).toEqual(z);
    expect(naive.ageHours).toBe(5);
  });
  it("treats date-only values as IST midnight", () => {
    expect(parseDbTimestamp("2026-10-02")).toBe(Date.parse("2026-10-01T18:30:00Z"));
    expect(parseDbTimestamp("2026-10-02T10:00:00")).toBe(Date.parse("2026-10-02T04:30:00Z"));
    expect(parseDbTimestamp("2026-10-02T10:00:00+05:30")).toBe(Date.parse("2026-10-02T04:30:00Z"));
    expect(Number.isNaN(parseDbTimestamp("nope"))).toBe(true);
  });
  it("uses IST midnight for the 24h shift boundary", () => {
    // shift 2026-10-03 00:00 IST == 2026-10-02T18:30Z
    const at24 = new Date("2026-10-01T18:30:00Z");
    const before = new Date("2026-10-01T18:29:00Z");
    expect(computeSla("2026-10-01 18:00:00", "2026-10-03", at24).state).toBe("urgent");
    expect(computeSla("2026-10-01 18:00:00", "2026-10-03", before).state).toBe("ok");
  });
});
