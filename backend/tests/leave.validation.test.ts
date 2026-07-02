import { describe, it, expect } from "vitest";
import {
  createLeaveTypeSchema,
  leaveRequestSchema,
  reviewLeaveSchema,
  leaveRequestFiltersSchema,
  createHolidaySchema,
} from "../src/modules/leave/leave.validation.js";

describe("createLeaveTypeSchema", () => {
  const valid = { leaveCode: "CL", leaveName: "Casual Leave", maxDaysPerYear: 12 };

  it("accepts valid input", () => {
    const r = createLeaveTypeSchema.parse(valid);
    expect(r.leaveCode).toBe("CL");
  });

  it("rejects empty leaveCode", () => {
    expect(() => createLeaveTypeSchema.parse({ ...valid, leaveCode: "" })).toThrow();
  });

  it("defaults carryForward and requiresApproval", () => {
    const r = createLeaveTypeSchema.parse(valid);
    expect(r.carryForward).toBe(false);
    expect(r.requiresApproval).toBe(true);
    expect(r.paidLeave).toBe(true);
  });

  it("rejects negative maxDaysPerYear", () => {
    expect(() => createLeaveTypeSchema.parse({ ...valid, maxDaysPerYear: -1 })).toThrow();
  });
});

describe("leaveRequestSchema", () => {
  const valid = {
    employeeId: "550e8400-e29b-41d4-a716-446655440000",
    leaveTypeId: "550e8400-e29b-41d4-a716-446655440001",
    fromDate: "2026-06-01",
    toDate: "2026-06-03",
    totalDays: 3,
  };

  it("accepts valid request", () => {
    expect(() => leaveRequestSchema.parse(valid)).not.toThrow();
  });

  it("accepts non-empty legacy database identifiers", () => {
    const parsed = leaveRequestSchema.parse({ ...valid, employeeId: "legacy-employee-1" });
    expect(parsed.employeeId).toBe("legacy-employee-1");
  });

  it("rejects toDate before fromDate", () => {
    expect(() =>
      leaveRequestSchema.parse({ ...valid, fromDate: "2026-06-05", toDate: "2026-06-01" })
    ).toThrow();
  });

  it("rejects totalDays less than 0.5", () => {
    expect(() => leaveRequestSchema.parse({ ...valid, totalDays: 0 })).toThrow();
  });
});

describe("reviewLeaveSchema", () => {
  it("only allows approved or rejected", () => {
    expect(() => reviewLeaveSchema.parse({ status: "pending" })).toThrow();
    expect(() => reviewLeaveSchema.parse({ status: "approved" })).not.toThrow();
    expect(() => reviewLeaveSchema.parse({ status: "rejected" })).not.toThrow();
  });
});

describe("leaveRequestFiltersSchema", () => {
  it("defaults page 1 limit 20", () => {
    const r = leaveRequestFiltersSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });

  it("accepts employeeId and status filters", () => {
    const r = leaveRequestFiltersSchema.parse({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      status: "pending",
    });
    expect(r.status).toBe("pending");
  });
});

describe("createHolidaySchema", () => {
  it("accepts valid holiday", () => {
    const r = createHolidaySchema.parse({ holidayName: "Diwali", holidayDate: "2026-10-20" });
    expect(r.holidayType).toBe("national");
  });

  it("rejects invalid date", () => {
    expect(() => createHolidaySchema.parse({ holidayName: "X", holidayDate: "20-10-2026" })).toThrow();
  });
});
