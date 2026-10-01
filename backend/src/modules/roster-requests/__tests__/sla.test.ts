import { describe, expect, it } from "vitest";
import { computeSla } from "../roster-requests.sla.js";

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
});
