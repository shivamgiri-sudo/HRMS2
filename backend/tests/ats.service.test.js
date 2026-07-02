import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../src/db/mysql.js", () => ({
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
import { db } from "../src/db/mysql.js";
import { atsService } from "../src/modules/ats/ats.service.js";
const mockExecute = db.execute;
const fakeCandidate = {
    id: "cand-1",
    candidate_code: "ATS-20260001",
    full_name: "Rahul Sharma",
    mobile: "9876543210",
    email: "rahul@example.com",
    gender: "Male",
    date_of_birth: "2000-01-15",
    current_stage: "Applied",
    applied_for_process: "Inbound",
    applied_for_branch: "Mumbai",
    sourcing_channel: "WALK_IN",
    referred_by: null,
    walk_in_date: "2026-05-20",
    remarks: null,
    active_status: 1,
    created_at: "2026-05-20T10:00:00Z",
    updated_at: "2026-05-20T10:00:00Z",
};
const fakeStageLog = {
    id: "log-1",
    candidate_id: "cand-1",
    from_stage: "Applied",
    to_stage: "Screened",
    stage_date: "2026-05-20T10:30:00Z",
    remarks: "Passed initial screening",
    updated_by: "user-1",
    created_at: "2026-05-20T10:30:00Z",
};
const fakeOnboardingBridge = {
    id: "ob-1",
    candidate_id: "cand-1",
    employee_id: null,
    bridge_date: "2026-05-21",
    offer_letter_url: null,
    joining_date: "2026-06-01",
    status: "pending",
    notes: null,
    created_at: "2026-05-21T09:00:00Z",
};
// ─── listCandidates ───────────────────────────────────────────────────────────
describe("atsService.listCandidates", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns candidates", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]);
        mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
        const result = await atsService.listCandidates({ page: 1, limit: 20 });
        expect(result.data).toHaveLength(1);
        expect(result.total).toBe(1);
    });
    it("filters by stage", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]);
        mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
        await atsService.listCandidates({ page: 1, limit: 20, stage: "Applied" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/current_stage/i);
    });
    it("filters by branch", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]);
        mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
        await atsService.listCandidates({ page: 1, limit: 20, branch: "Mumbai" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/applied_for_branch/i);
    });
    it("filters by search (name or mobile)", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]);
        mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
        await atsService.listCandidates({ page: 1, limit: 20, search: "Rahul" });
        const [sql] = mockExecute.mock.calls[0];
        expect(sql).toMatch(/full_name|mobile/i);
    });
});
// ─── getCandidate ─────────────────────────────────────────────────────────────
describe("atsService.getCandidate", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns candidate by id", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]);
        const result = await atsService.getCandidate("cand-1");
        expect(result.candidate_code).toBe("ATS-20260001");
    });
    it("throws when not found", async () => {
        mockExecute.mockResolvedValueOnce([[]]);
        await expect(atsService.getCandidate("missing")).rejects.toThrow("Candidate not found");
    });
});
// ─── createCandidate ──────────────────────────────────────────────────────────
describe("atsService.createCandidate", () => {
    beforeEach(() => vi.clearAllMocks());
    it("throws when mobile already exists", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]); // duplicate check by mobile
        await expect(atsService.createCandidate({ fullName: "Test", mobile: "9876543210", walkInDate: "2026-05-20" }, "user-1")).rejects.toThrow("mobile already registered");
    });
    it("inserts candidate and returns it", async () => {
        mockExecute.mockResolvedValueOnce([[]]); // no duplicate
        mockExecute.mockResolvedValueOnce([[{ max_code: "ATS-20260001" }]]); // code generation
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]); // re-fetch
        const result = await atsService.createCandidate({ fullName: "Rahul Sharma", mobile: "9876543210", walkInDate: "2026-05-20" }, "user-1");
        expect(result.full_name).toBe("Rahul Sharma");
    });
});
// ─── moveStage ────────────────────────────────────────────────────────────────
describe("atsService.moveStage", () => {
    beforeEach(() => vi.clearAllMocks());
    it("updates current_stage and inserts stage log", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]); // getCandidate
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE ats_candidate
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT stage log
        mockExecute.mockResolvedValueOnce([[{ ...fakeCandidate, current_stage: "Screened" }]]); // re-fetch
        const result = await atsService.moveStage("cand-1", "Screened", "user-1", "Passed screening");
        expect(result.current_stage).toBe("Screened");
    });
    it("throws when candidate not found", async () => {
        mockExecute.mockResolvedValueOnce([[]]); // getCandidate
        await expect(atsService.moveStage("missing", "Screened", "user-1")).rejects.toThrow("Candidate not found");
    });
});
// ─── listStageLogs ────────────────────────────────────────────────────────────
describe("atsService.listStageLogs", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns logs for a candidate", async () => {
        mockExecute.mockResolvedValueOnce([[fakeStageLog]]);
        const result = await atsService.listStageLogs("cand-1");
        expect(result).toHaveLength(1);
        expect(result[0].to_stage).toBe("Screened");
    });
});
// ─── createOnboardingBridge ───────────────────────────────────────────────────
describe("atsService.createOnboardingBridge", () => {
    beforeEach(() => vi.clearAllMocks());
    it("creates bridge and returns it", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]); // candidate check
        mockExecute.mockResolvedValueOnce([[]]); // no existing bridge
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT
        mockExecute.mockResolvedValueOnce([[fakeOnboardingBridge]]); // re-fetch
        const result = await atsService.createOnboardingBridge({ candidateId: "cand-1", bridgeDate: "2026-05-21", joiningDate: "2026-06-01" }, "user-1");
        expect(result.candidate_id).toBe("cand-1");
        expect(result.status).toBe("pending");
    });
    it("throws when bridge already exists for candidate", async () => {
        mockExecute.mockResolvedValueOnce([[fakeCandidate]]);
        mockExecute.mockResolvedValueOnce([[fakeOnboardingBridge]]); // already exists
        await expect(atsService.createOnboardingBridge({ candidateId: "cand-1", bridgeDate: "2026-05-21" }, "user-1")).rejects.toThrow("Onboarding bridge already exists");
    });
});
// ─── listSourcingChannels ─────────────────────────────────────────────────────
describe("atsService.listSourcingChannels", () => {
    beforeEach(() => vi.clearAllMocks());
    it("returns active sourcing channels", async () => {
        mockExecute.mockResolvedValueOnce([[
                { id: "sc-1", channel_code: "WALK_IN", channel_name: "Walk-in", channel_type: "walk_in", active_status: 1 },
            ]]);
        const result = await atsService.listSourcingChannels();
        expect(result).toHaveLength(1);
        expect(result[0].channel_code).toBe("WALK_IN");
    });
});
