import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../src/db/mysql.js", () => ({
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
import { db } from "../src/db/mysql.js";
import { appendJourneyEvent, listJourneyEvents } from "../src/modules/employees/journeyLog.service.js";
const mockExecute = db.execute;
const fakeEvent = {
    id: "ev-1",
    employee_id: "emp-1",
    event_type: "onboarded",
    event_date: "2026-05-20",
    description: "Employee onboarded",
    old_value: null,
    new_value: null,
    module: "hr",
    triggered_by: "user-1",
    metadata: null,
    created_at: "2026-05-20T10:00:00Z",
};
describe("appendJourneyEvent", () => {
    beforeEach(() => vi.clearAllMocks());
    it("inserts event and returns it", async () => {
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        mockExecute.mockResolvedValueOnce([[fakeEvent]]);
        const result = await appendJourneyEvent({
            employeeId: "emp-1",
            eventType: "onboarded",
            eventDate: "2026-05-20",
            description: "Employee onboarded",
            module: "hr",
            triggeredBy: "user-1",
        });
        expect(result.event_type).toBe("onboarded");
        expect(result.employee_id).toBe("emp-1");
    });
    it("stores metadata as JSON when provided", async () => {
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        mockExecute.mockResolvedValueOnce([[{ ...fakeEvent, metadata: { old_salary: 25000 } }]]);
        await appendJourneyEvent({
            employeeId: "emp-1",
            eventType: "salary_revised",
            eventDate: "2026-05-20",
            module: "payroll",
            triggeredBy: "user-1",
            metadata: { old_salary: 25000, new_salary: 30000 },
        });
        const [, params] = mockExecute.mock.calls[0];
        const metaParam = params.find((p) => typeof p === "string" && p.includes("old_salary"));
        expect(metaParam).toBeDefined();
    });
    it("stores old_value / new_value when provided", async () => {
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        mockExecute.mockResolvedValueOnce([[{ ...fakeEvent, old_value: "Inbound", new_value: "Outbound" }]]);
        await appendJourneyEvent({
            employeeId: "emp-1",
            eventType: "process_transfer",
            eventDate: "2026-05-20",
            module: "hr",
            triggeredBy: "user-1",
            oldValue: "Inbound",
            newValue: "Outbound",
        });
        const [, params] = mockExecute.mock.calls[0];
        expect(params).toContain("Inbound");
        expect(params).toContain("Outbound");
    });
});
describe("listJourneyEvents", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns events for an employee", async () => {
        mockExecute.mockResolvedValueOnce([[fakeEvent]]);
        const result = await listJourneyEvents("emp-1");
        expect(result).toHaveLength(1);
        expect(result[0].employee_id).toBe("emp-1");
    });
    it("filters by module when provided", async () => {
        mockExecute.mockResolvedValueOnce([[fakeEvent]]);
        await listJourneyEvents("emp-1", { module: "payroll" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/module/i);
    });
    it("filters by event_type when provided", async () => {
        mockExecute.mockResolvedValueOnce([[fakeEvent]]);
        await listJourneyEvents("emp-1", { eventType: "onboarded" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/event_type/i);
    });
    it("returns events ordered by event_date desc", async () => {
        mockExecute.mockResolvedValueOnce([[fakeEvent]]);
        await listJourneyEvents("emp-1");
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/ORDER BY.*event_date.*DESC/i);
    });
    it("returns empty array when no events", async () => {
        mockExecute.mockResolvedValueOnce([[]]);
        const result = await listJourneyEvents("emp-1");
        expect(result).toEqual([]);
    });
});
