import { describe, it, expect } from "vitest";
import { createShiftSchema, updateShiftSchema, rosterPlanSchema, rosterAssignSchema, attendanceSessionFiltersSchema, clockInSchema, clockOutSchema, breakSchema, regularizationSchema, reviewRegularizationSchema, } from "../src/modules/wfm/wfm.validation.js";
describe("createShiftSchema", () => {
    const valid = { shiftCode: "GEN", shiftName: "General", startTime: "09:00", endTime: "18:00" };
    it("accepts valid shift", () => {
        const r = createShiftSchema.parse(valid);
        expect(r.shiftCode).toBe("GEN");
    });
    it("rejects shiftCode shorter than 2 chars", () => {
        expect(() => createShiftSchema.parse({ ...valid, shiftCode: "X" })).toThrow();
    });
    it("rejects invalid time format", () => {
        expect(() => createShiftSchema.parse({ ...valid, startTime: "9am" })).toThrow();
    });
    it("defaults requiredMinutes to 540", () => {
        const r = createShiftSchema.parse(valid);
        expect(r.requiredMinutes).toBe(540);
    });
    it("accepts custom requiredMinutes", () => {
        const r = createShiftSchema.parse({ ...valid, requiredMinutes: 480 });
        expect(r.requiredMinutes).toBe(480);
    });
});
describe("updateShiftSchema", () => {
    it("accepts empty object", () => {
        expect(() => updateShiftSchema.parse({})).not.toThrow();
    });
    it("validates time format when provided", () => {
        expect(() => updateShiftSchema.parse({ startTime: "bad" })).toThrow();
    });
});
describe("rosterPlanSchema", () => {
    const valid = { planName: "May Roster", fromDate: "2026-05-01", toDate: "2026-05-31" };
    it("accepts valid plan", () => {
        expect(() => rosterPlanSchema.parse(valid)).not.toThrow();
    });
    it("rejects missing planName", () => {
        expect(() => rosterPlanSchema.parse({ ...valid, planName: "" })).toThrow();
    });
    it("rejects invalid date format", () => {
        expect(() => rosterPlanSchema.parse({ ...valid, fromDate: "01-05-2026" })).toThrow();
    });
    it("rejects toDate before fromDate", () => {
        expect(() => rosterPlanSchema.parse({ ...valid, fromDate: "2026-05-31", toDate: "2026-05-01" })).toThrow();
    });
});
describe("rosterAssignSchema", () => {
    it("requires employeeId and rosterDate", () => {
        expect(() => rosterAssignSchema.parse({})).toThrow();
    });
    it("accepts valid assignment", () => {
        const r = rosterAssignSchema.parse({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            rosterDate: "2026-05-15",
        });
        expect(r.employeeId).toBeDefined();
    });
});
describe("attendanceSessionFiltersSchema", () => {
    it("defaults page to 1, limit to 20", () => {
        const r = attendanceSessionFiltersSchema.parse({});
        expect(r.page).toBe(1);
        expect(r.limit).toBe(20);
    });
    it("accepts date filters", () => {
        const r = attendanceSessionFiltersSchema.parse({ fromDate: "2026-05-01", toDate: "2026-05-31" });
        expect(r.fromDate).toBe("2026-05-01");
    });
});
describe("clockInSchema", () => {
    it("requires employeeId and sessionDate", () => {
        expect(() => clockInSchema.parse({})).toThrow();
    });
    it("accepts valid clock-in", () => {
        const r = clockInSchema.parse({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            sessionDate: "2026-05-21",
            punchSource: "MANUAL",
        });
        expect(r.punchSource).toBe("MANUAL");
    });
    it("rejects invalid punchSource", () => {
        expect(() => clockInSchema.parse({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            sessionDate: "2026-05-21",
            punchSource: "UNKNOWN",
        })).toThrow();
    });
});
describe("clockOutSchema", () => {
    it("requires sessionId", () => {
        expect(() => clockOutSchema.parse({})).toThrow();
    });
});
describe("breakSchema", () => {
    it("requires sessionId and breakType", () => {
        expect(() => breakSchema.parse({})).toThrow();
    });
    it("accepts valid break types", () => {
        for (const t of ["Break", "Lunch", "Bio", "Training"]) {
            expect(() => breakSchema.parse({ sessionId: "550e8400-e29b-41d4-a716-446655440000", breakType: t })).not.toThrow();
        }
    });
});
describe("regularizationSchema", () => {
    it("requires employeeId, sessionDate, reason", () => {
        expect(() => regularizationSchema.parse({})).toThrow();
    });
    it("rejects empty reason", () => {
        expect(() => regularizationSchema.parse({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            sessionDate: "2026-05-21",
            reason: "",
        })).toThrow();
    });
});
describe("reviewRegularizationSchema", () => {
    it("requires status", () => {
        expect(() => reviewRegularizationSchema.parse({})).toThrow();
    });
    it("only accepts approved or rejected", () => {
        expect(() => reviewRegularizationSchema.parse({ status: "pending" })).toThrow();
        expect(() => reviewRegularizationSchema.parse({ status: "approved" })).not.toThrow();
        expect(() => reviewRegularizationSchema.parse({ status: "rejected" })).not.toThrow();
    });
});
