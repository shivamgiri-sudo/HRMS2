/**
 * Package B: Roster and Shift Governance — access and workflow contract tests.
 *
 * These tests intentionally mock service data so they assert the API permission
 * boundary: Process Manager + WFM own draft-to-publish in mapped scope; TL/AM
 * may manage coverage actions only; employees remain self-only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn(),
  hasProcessScope: vi.fn(),
  // Other application routers are mounted while this suite imports app.ts.
  // Return a valid pass-through middleware so lifecycle route registration
  // remains intact; roster endpoints under test do not rely on this guard.
  selfOrAdminHr: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("../src/modules/roster/roster.governance.service.js", () => ({
  rosterGovernanceService: {
    listShiftTemplates: vi.fn(),
    createShiftTemplate: vi.fn(),
    listCycles: vi.fn(),
    createCycle: vi.fn(),
    getCycle: vi.fn(),
    advanceCycleStatus: vi.fn(),
    getAssignments: vi.fn(),
    bulkUpsertAssignments: vi.fn(),
    acknowledgeRoster: vi.fn(),
    listChangeLogs: vi.fn(),
    logRosterChange: vi.fn(),
    getCoverageAction: vi.fn(),
    createCoverageAction: vi.fn(),
    resolveCoverageAction: vi.fn(),
    getPortalAggregate: vi.fn(),
  },
}));

import { app } from "../src/app.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { getEmployeeForUser, hasProcessScope, hasRole } from "../src/shared/accessGuard.js";
import { rosterGovernanceService as service } from "../src/modules/roster/roster.governance.service.js";

const authUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const isRole = hasRole as ReturnType<typeof vi.fn>;
const inScope = hasProcessScope as ReturnType<typeof vi.fn>;
const employeeForUser = getEmployeeForUser as ReturnType<typeof vi.fn>;
const svc = service as { [K in keyof typeof service]: ReturnType<typeof vi.fn> };
const AUTH = { Authorization: "Bearer valid.token" };
const cycle = { id: "cycle-1", process_id: "process-1", branch_id: "branch-1", week_start_date: "2026-06-01", week_end_date: "2026-06-07", status: "draft" };

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  isRole.mockResolvedValue(false);
  inScope.mockResolvedValue(false);
  employeeForUser.mockResolvedValue(null);
  svc.getCycle.mockResolvedValue(cycle);
});

describe("weekly roster ownership", () => {
  it("allows a mapped Process Manager to create a weekly cycle", async () => {
    inScope.mockResolvedValue(true);
    svc.createCycle.mockResolvedValue(cycle);
    const result = await request(app).post("/api/roster-gov/cycles").set(AUTH).send({
      process_id: "process-1", branch_id: "branch-1", week_start_date: "2026-06-01", week_end_date: "2026-06-07",
    });
    expect(result.status).toBe(201);
    expect(inScope).toHaveBeenCalledWith("user-1", "process-1", "branch-1", "manager", "wfm");
    expect(svc.createCycle).toHaveBeenCalled();
  });

  it("allows mapped WFM/Process Manager ownership to advance draft-to-publish state", async () => {
    inScope.mockResolvedValue(true);
    svc.advanceCycleStatus.mockResolvedValue({ ...cycle, status: "published" });
    const result = await request(app).post("/api/roster-gov/cycles/cycle-1/status").set(AUTH).send({ status: "published" });
    expect(result.status).toBe(200);
    expect(svc.advanceCycleStatus).toHaveBeenCalledWith("cycle-1", "published", "user-1", expect.anything());
  });

  it("denies a user without mapped roster ownership from creating or publishing", async () => {
    expect((await request(app).post("/api/roster-gov/cycles").set(AUTH).send({ process_id: "process-2", week_start_date: "2026-06-01", week_end_date: "2026-06-07" })).status).toBe(403);
    expect((await request(app).post("/api/roster-gov/cycles/cycle-1/status").set(AUTH).send({ status: "published" })).status).toBe(403);
    expect(svc.createCycle).not.toHaveBeenCalled();
    expect(svc.advanceCycleStatus).not.toHaveBeenCalled();
  });

  it("allows admin override without a process-scope record", async () => {
    isRole.mockResolvedValue(true);
    svc.createCycle.mockResolvedValue(cycle);
    const result = await request(app).post("/api/roster-gov/cycles").set(AUTH).send({ process_id: "process-1", week_start_date: "2026-06-01", week_end_date: "2026-06-07" });
    expect(result.status).toBe(201);
    expect(svc.createCycle).toHaveBeenCalled();
  });
});

describe("shift master ownership", () => {
  it("allows mapped WFM to create a process shift template", async () => {
    inScope.mockResolvedValue(true);
    svc.createShiftTemplate.mockResolvedValue({ id: "shift-1", process_id: "process-1", shift_code: "DAY" });
    const result = await request(app).post("/api/roster-gov/shifts/templates").set(AUTH).send({
      process_id: "process-1", shift_code: "DAY", shift_name: "Day", start_time: "09:00", end_time: "18:00", effective_from: "2026-06-01",
    });
    expect(result.status).toBe(201);
    expect(inScope).toHaveBeenCalledWith("user-1", "process-1", null, "wfm");
  });

  it("does not let an ordinary employee create a shift template", async () => {
    const result = await request(app).post("/api/roster-gov/shifts/templates").set(AUTH).send({
      process_id: "process-1", shift_code: "DAY", shift_name: "Day", start_time: "09:00", end_time: "18:00", effective_from: "2026-06-01",
    });
    expect(result.status).toBe(403);
    expect(svc.createShiftTemplate).not.toHaveBeenCalled();
  });
});

describe("supervisor accountability without roster truth editing", () => {
  it("allows a mapped TL/Assistant Manager monitor to raise a coverage action", async () => {
    inScope.mockResolvedValue(true);
    svc.createCoverageAction.mockResolvedValue({ id: "action-1", cycle_id: "cycle-1", status: "open" });
    const result = await request(app).post("/api/roster-gov/coverage-actions").set(AUTH).send({ cycle_id: "cycle-1", action_date: "2026-06-02", coverage_gap: 2 });
    expect(result.status).toBe(201);
    expect(svc.createCoverageAction).toHaveBeenCalledWith(expect.objectContaining({ process_id: "process-1" }), "user-1", expect.anything());
  });

  it("does not allow a supervisor without owner scope to change published roster truth", async () => {
    const result = await request(app).post("/api/roster-gov/cycles/cycle-1/changes").set(AUTH).send({ employee_id: "emp-1", change_type: "shift_change", reason: "request", change_date: "2026-06-02" });
    expect(result.status).toBe(403);
    expect(svc.logRosterChange).not.toHaveBeenCalled();
  });
});

describe("employee self-service and safe client publishing data", () => {
  it("returns only the mapped employee roster when user has no monitor scope", async () => {
    employeeForUser.mockResolvedValue({ id: "emp-1", employee_code: "E001" });
    svc.getAssignments.mockResolvedValue([{ id: "a-1", employee_id: "emp-1" }]);
    const result = await request(app).get("/api/roster-gov/cycles/cycle-1/assignments").set(AUTH);
    expect(result.status).toBe(200);
    expect(svc.getAssignments).toHaveBeenCalledWith("cycle-1", "emp-1");
  });

  it("allows employees to acknowledge their own published roster", async () => {
    employeeForUser.mockResolvedValue({ id: "emp-1", employee_code: "E001" });
    svc.acknowledgeRoster.mockResolvedValue({ acknowledged: 7 });
    const result = await request(app).post("/api/roster-gov/cycles/cycle-1/acknowledge").set(AUTH);
    expect(result.status).toBe(200);
    expect(svc.acknowledgeRoster).toHaveBeenCalledWith("cycle-1", "emp-1", "user-1", expect.anything());
  });

  it("exposes only aggregate published roster data to authorised internal publisher views", async () => {
    isRole.mockResolvedValue(true);
    svc.getPortalAggregate.mockResolvedValue([{ cycle_id: "cycle-1", process_id: "process-1", required_hc: 10, rostered_hc: 9, coverage_pct: 90 }]);
    const result = await request(app).get("/api/roster-gov/portal-aggregate?process_id=process-1&week_start_date=2026-06-01").set(AUTH);
    expect(result.status).toBe(200);
    expect(result.body.data[0]).not.toHaveProperty("employee_id");
  });
});
