import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../src/db/mysql.js", () => ({
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
import { db } from "../src/db/mysql.js";
import { rosterService } from "../src/modules/wfm/roster.service.js";
const mockExecute = db.execute;
const fakePlan = {
    id: "plan-1",
    plan_name: "May Week 1",
    process_id: "proc-1",
    branch_id: null,
    shift_id: "shift-1",
    from_date: "2026-05-20",
    to_date: "2026-05-26",
    required_headcount: 10,
    assigned_headcount: 0,
    plan_status: "draft",
    created_by: "user-1",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
};
const fakeAssignment = {
    id: "asgn-1",
    employee_id: "emp-1",
    shift_id: "shift-1",
    plan_id: "plan-1",
    roster_date: "2026-05-20",
    roster_status: "Rostered",
    shift_start_time: "09:00",
    shift_end_time: "18:00",
    branch_name: "Mumbai",
    process_name: "Inbound",
    publish_status: "draft",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
};
describe("rosterService.createPlan", () => {
    beforeEach(() => vi.clearAllMocks());
    it("inserts plan and returns it", async () => {
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        mockExecute.mockResolvedValueOnce([[fakePlan]]);
        const result = await rosterService.createPlan({ planName: "May Week 1", fromDate: "2026-05-20", toDate: "2026-05-26", requiredHeadcount: 10, shiftId: "shift-1", processId: "proc-1" }, "user-1");
        expect(result.plan_name).toBe("May Week 1");
        expect(result.plan_status).toBe("draft");
    });
    it("throws when toDate < fromDate", async () => {
        await expect(rosterService.createPlan({ planName: "Bad", fromDate: "2026-05-26", toDate: "2026-05-20", requiredHeadcount: 5 }, "user-1")).rejects.toThrow("toDate must be >= fromDate");
    });
});
describe("rosterService.listPlans", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns plans", async () => {
        mockExecute.mockResolvedValueOnce([[fakePlan]]);
        const result = await rosterService.listPlans({});
        expect(result).toHaveLength(1);
    });
    it("filters by processId", async () => {
        mockExecute.mockResolvedValueOnce([[fakePlan]]);
        await rosterService.listPlans({ processId: "proc-1" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/process_id/i);
    });
});
describe("rosterService.assignEmployee", () => {
    beforeEach(() => vi.clearAllMocks());
    it("upserts assignment and returns it", async () => {
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
        const result = await rosterService.assignEmployee({ employeeId: "emp-1", rosterDate: "2026-05-20", shiftId: "shift-1", planId: "plan-1", shiftStartTime: "09:00", shiftEndTime: "18:00" }, "user-1");
        expect(result.employee_id).toBe("emp-1");
    });
});
describe("rosterService.bulkAssign", () => {
    beforeEach(() => vi.clearAllMocks());
    it("upserts multiple rows and returns count", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
        const rows = [
            { employeeId: "emp-1", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
            { employeeId: "emp-2", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
        ];
        const result = await rosterService.bulkAssign(rows, "plan-1", "user-1");
        expect(result.assigned).toBe(2);
        expect(result.failed).toBe(0);
    });
    it("counts failed rows when DB throws", async () => {
        mockExecute.mockRejectedValueOnce(new Error("DB error"));
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        const rows = [
            { employeeId: "emp-1", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
            { employeeId: "emp-2", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
        ];
        const result = await rosterService.bulkAssign(rows, "plan-1", "user-1");
        expect(result.failed).toBe(1);
        expect(result.assigned).toBe(1);
    });
});
describe("rosterService.publishPlan", () => {
    beforeEach(() => vi.clearAllMocks());
    it("updates plan_status to published and all assignments to published", async () => {
        mockExecute.mockResolvedValueOnce([[fakePlan]]); // getPlan check
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // update plan
        mockExecute.mockResolvedValueOnce([{ affectedRows: 5 }]); // update assignments
        mockExecute.mockResolvedValueOnce([[{ ...fakePlan, plan_status: "published" }]]); // re-fetch
        const result = await rosterService.publishPlan("plan-1", "user-1");
        expect(result.plan_status).toBe("published");
    });
    it("throws when plan not found", async () => {
        mockExecute.mockResolvedValueOnce([[]]); // empty
        await expect(rosterService.publishPlan("missing", "user-1")).rejects.toThrow("Plan not found");
    });
});
describe("rosterService.listAssignments", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns assignments for a plan", async () => {
        mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
        const result = await rosterService.listAssignments({ planId: "plan-1" });
        expect(result).toHaveLength(1);
        expect(result[0].plan_id).toBe("plan-1");
    });
    it("filters by employeeId", async () => {
        mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
        await rosterService.listAssignments({ employeeId: "emp-1" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/employee_id/i);
    });
    it("filters by rosterDate range", async () => {
        mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
        await rosterService.listAssignments({ fromDate: "2026-05-20", toDate: "2026-05-26" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/roster_date/i);
    });
});
