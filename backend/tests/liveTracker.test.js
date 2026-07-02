import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../src/db/mysql.js", () => ({
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
import { db } from "../src/db/mysql.js";
import { getLiveTracker } from "../src/modules/wfm/liveTracker.service.js";
const mockExecute = db.execute;
const fakeSession = {
    employee_id: "emp-1",
    employee_code: "EMP001",
    employee_name: "John Doe",
    process_name: "Inbound",
    branch_name: "Mumbai",
    shift_start_time: "09:00",
    shift_end_time: "18:00",
    required_minutes: 540,
    login_time: "2026-05-20T09:05:00Z",
    logout_time: null,
    total_login_minutes: 0,
    current_status: "Logged In",
    punch_source: "MANUAL",
    session_date: "2026-05-20",
};
const fakeAbsent = {
    employee_id: "emp-2",
    employee_code: "EMP002",
    employee_name: "Jane Smith",
    process_name: "Inbound",
    branch_name: "Mumbai",
    shift_start_time: "09:00",
    shift_end_time: "18:00",
    required_minutes: 540,
    login_time: null,
    logout_time: null,
    total_login_minutes: 0,
    current_status: "Absent",
    punch_source: null,
    session_date: "2026-05-20",
};
describe("getLiveTracker", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns session rows for given date", async () => {
        mockExecute.mockResolvedValueOnce([[fakeSession, fakeAbsent]]);
        const result = await getLiveTracker({ date: "2026-05-20" });
        expect(result.sessions).toHaveLength(2);
    });
    it("calculates adherence_pct for logged-in employee", async () => {
        mockExecute.mockResolvedValueOnce([[{ ...fakeSession, total_login_minutes: 270, required_minutes: 540 }]]);
        const result = await getLiveTracker({ date: "2026-05-20" });
        expect(result.sessions[0].adherence_pct).toBe(50);
    });
    it("sets adherence_pct to 0 for absent employee", async () => {
        mockExecute.mockResolvedValueOnce([[fakeAbsent]]);
        const result = await getLiveTracker({ date: "2026-05-20" });
        expect(result.sessions[0].adherence_pct).toBe(0);
    });
    it("returns summary counts", async () => {
        mockExecute.mockResolvedValueOnce([[fakeSession, fakeAbsent]]);
        const result = await getLiveTracker({ date: "2026-05-20" });
        expect(result.summary.total).toBe(2);
        expect(result.summary.logged_in).toBe(1);
        expect(result.summary.absent).toBe(1);
        expect(result.summary.logged_out).toBe(0);
    });
    it("filters by process_name when provided", async () => {
        mockExecute.mockResolvedValueOnce([[fakeSession]]);
        await getLiveTracker({ date: "2026-05-20", processName: "Inbound" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/process_name/i);
    });
    it("filters by branch_name when provided", async () => {
        mockExecute.mockResolvedValueOnce([[fakeSession]]);
        await getLiveTracker({ date: "2026-05-20", branchName: "Mumbai" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/branch_name/i);
    });
    it("calculates overall_adherence_pct as average across rostered employees", async () => {
        mockExecute.mockResolvedValueOnce([[
                { ...fakeSession, total_login_minutes: 540, required_minutes: 540 }, // 100%
                { ...fakeAbsent, total_login_minutes: 0, required_minutes: 540 }, // 0%
            ]]);
        const result = await getLiveTracker({ date: "2026-05-20" });
        expect(result.summary.overall_adherence_pct).toBe(50);
    });
    it("defaults date to today when not provided", async () => {
        mockExecute.mockResolvedValueOnce([[]]);
        await getLiveTracker({});
        const [sql, params] = mockExecute.mock.calls[0];
        const today = new Date().toISOString().slice(0, 10);
        expect(params).toContain(today);
    });
});
