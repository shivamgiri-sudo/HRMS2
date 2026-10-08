import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * My Resignation "before you go" redesign (2026-10-01):
 *   - self-withdraw allowed in every pre-exit status up to and including the last working day;
 *     refused after the LWD and in clearance / F&F / exited; HR on-behalf keeps the FSM rule;
 *   - "talk to my manager / HR first" creates no exit_request, notifies, and is limited to one
 *     request per employee per 24 h;
 *   - GET /me/journey-summary returns the caller's own data only and degrades to empty sections.
 *
 * The real resignation-self / resignation-journey services and the real exit FSM run here; only
 * the database, auth, inbox and recipient lookup are mocked.
 */

const OWN_EMP = "emp-self";
const OTHER_EMP = "emp-other";
const EXIT_ID = "exit-1";

type Row = Record<string, unknown>;
type Handler = { re: RegExp; reply: (params: unknown[]) => unknown };

const { dbExecute, handlers } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  handlers: [] as Handler[],
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));

let authUser = { id: "user-self", role: "employee", roles: ["employee"] };
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = authUser; next(); },
}));
vi.mock("../exit.controller.js", () => ({ exitController: { createExitRequest: vi.fn() } }));
vi.mock("../exit.service.js", () => ({ exitService: { updateExitStatus: vi.fn(), getExitRequest: vi.fn() } }));

const { getEmployeeForUser, hasRole } = vi.hoisted(() => ({
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser, hasRole }));

const { createItem, resolveRoleHolderUserIds } = vi.hoisted(() => ({
  createItem: vi.fn(async () => ({ id: "inbox-1" })),
  resolveRoleHolderUserIds: vi.fn(async () => ["hr-user-1", "hr-user-2"]),
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds }));
vi.mock("../../policy-engine/policy-engine.cache.js", () => ({ getPolicyValue: vi.fn(async () => "30") }));

const { resignationRouter } = await import("../resignation.routes.js");
const { decideSelfWithdraw } = await import("../resignation-self.service.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/exit/resignation", resignationRouter);
  return a;
}

function on(re: RegExp, reply: (params: unknown[]) => unknown) {
  handlers.push({ re, reply });
}

const sqls = () => dbExecute.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  handlers.length = 0;
  dbExecute.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    for (const h of handlers) if (h.re.test(String(sql))) return [h.reply(params), []];
    if (/^\s*(UPDATE|INSERT)/i.test(String(sql))) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
  getEmployeeForUser.mockReset().mockResolvedValue({ id: OWN_EMP, employee_code: "MAS1" });
  hasRole.mockReset().mockResolvedValue(false);
  createItem.mockClear();
  resolveRoleHolderUserIds.mockClear().mockResolvedValue(["hr-user-1", "hr-user-2"]);
  authUser = { id: "user-self", role: "employee", roles: ["employee"] };
  // Recipient lookup: the employee, their manager's user, a branch.
  on(/FROM employees e\s+LEFT JOIN employees mgr/, () => [
    { user_id: "user-self", employee_code: "MAS1", branch_id: "br-1", name: "Asha Rao", manager_user_id: "mgr-user" },
  ]);
});

function exitRow(status: string, opts: { employee?: string; lwd?: string | null; withinLwd?: 0 | 1 } = {}): Row {
  return {
    status,
    employee_id: opts.employee ?? OWN_EMP,
    lwd: opts.lwd === undefined ? "2026-10-31" : opts.lwd,
    within_lwd: opts.withinLwd ?? 1,
  };
}

const withdraw = () => request(app()).post(`/api/exit/resignation/${EXIT_ID}/withdraw`);
const withdrewSql = () => sqls().some((s) => s.includes("SET status = 'withdrawn'"));

describe("decideSelfWithdraw (the rule itself)", () => {
  it.each(["draft", "submitted", "returned", "manager_review", "hr_review", "admin_review", "accepted", "notice_serving", "notice_active"])(
    "allows '%s'",
    (status) => {
      expect(decideSelfWithdraw(status, true, "2026-10-31")).toEqual({ ok: true });
    },
  );

  it("allows a status name it does not know, so the button is never missing for an open resignation", () => {
    expect(decideSelfWithdraw("pending_manager_approval", true, "2026-10-31")).toEqual({ ok: true });
  });

  it.each(["clearance_pending", "fnf_pending", "exited", "exit_confirmed", "closed", "terminated", "withdrawn", "revoked", "rejected"])(
    "refuses '%s' with a contact-HR message",
    (status) => {
      const r = decideSelfWithdraw(status, true, "2026-10-31");
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toMatch(/contact HR/i);
    },
  );

  it("still allows a pre-exit status after the last working day, until the exit is processed", () => {
    // Owner, 2026-10-01: the Withdraw button must be there while the resignation is open.
    expect(decideSelfWithdraw("notice_serving", false, "2026-09-30")).toEqual({ ok: true });
  });
});

describe("POST /:exitId/withdraw — employee self-withdraw", () => {
  it.each(["accepted", "notice_serving", "notice_active", "manager_review", "submitted"])(
    "200 from '%s' before the LWD; writes the audit row and tells manager + HR",
    async (status) => {
      on(/SELECT status, employee_id/, () => [exitRow(status)]);
      on(/SELECT active_status FROM employees/, () => [{ active_status: 1 }]);
      const res = await withdraw();
      expect(res.status).toBe(200);
      expect(res.body.data.onBehalf).toBe(false);
      expect(res.body.data.employeeActive).toBe(true);
      expect(withdrewSql()).toBe(true);
      // expected-status predicate guards a concurrent move
      const upd = dbExecute.mock.calls.find((c) => String(c[0]).includes("SET status = 'withdrawn'"))!;
      expect(upd[1]).toEqual([EXIT_ID, status]);
      expect(sqls().some((s) => s.includes("INSERT INTO exit_approval_log"))).toBe(true);
      expect(sqls().some((s) => s.includes("INSERT INTO sensitive_action_log"))).toBe(true);
      expect(sqls().some((s) => s.includes("UPDATE exit_clearance_task") && s.includes("'waived'"))).toBe(true);
      const recipients = createItem.mock.calls.map((c: any[]) => c[0].user_id).sort();
      expect(recipients).toEqual(["hr-user-1", "hr-user-2", "mgr-user"]);
      expect(createItem.mock.calls.every((c: any[]) => c[0].type === "RESIGNATION_WITHDRAWN")).toBe(true);
    },
  );

  it("200 after the last working day while the exit is not yet processed", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("notice_serving", { lwd: "2026-09-15", withinLwd: 0 })]);
    on(/SELECT active_status FROM employees/, () => [{ active_status: 1 }]);
    const res = await withdraw();
    expect(res.status).toBe(200);
    expect(withdrewSql()).toBe(true);
  });

  it("200 when the resignation sits on another employee record linked to the same login", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("manager_review", { employee: "emp-other-record" })]);
    on(/SELECT 1 FROM employees e\s+WHERE e\.id = \?/, (params) =>
      params[0] === "emp-other-record" && params[1] === "user-self" ? [{ 1: 1 }] : []);
    on(/SELECT active_status FROM employees/, () => [{ active_status: 1 }]);
    const res = await withdraw();
    expect(res.status).toBe(200);
    expect(withdrewSql()).toBe(true);
  });

  it.each(["exited", "clearance_pending", "fnf_pending", "closed"])("409 in '%s' even before the LWD", async (status) => {
    on(/SELECT status, employee_id/, () => [exitRow(status)]);
    const res = await withdraw();
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/contact HR/i);
    expect(withdrewSql()).toBe(false);
  });

  it("403 for someone else's resignation", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("submitted", { employee: OTHER_EMP })]);
    const res = await withdraw();
    expect(res.status).toBe(403);
    expect(withdrewSql()).toBe(false);
  });

  it("409 when the row moved between read and write (expected-status update hit 0 rows)", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("accepted")]);
    on(/SET status = 'withdrawn'/, () => ({ affectedRows: 0 }));
    const res = await withdraw();
    expect(res.status).toBe(409);
    expect(sqls().some((s) => s.includes("INSERT INTO exit_approval_log"))).toBe(false);
  });

  it("a manager withdrawing THEIR OWN resignation gets the self rule, not the on-behalf FSM", async () => {
    hasRole.mockResolvedValue(true);
    on(/SELECT status, employee_id/, () => [exitRow("clearance_pending")]);
    const res = await withdraw();
    expect(res.status).toBe(409); // the FSM alone would have allowed clearance_pending -> withdrawn
  });
});

describe("POST /:exitId/withdraw — HR on behalf keeps the FSM", () => {
  beforeEach(() => {
    hasRole.mockResolvedValue(true);
    getEmployeeForUser.mockResolvedValue({ id: "emp-hr", employee_code: "HR1" });
    authUser = { id: "hr-user", role: "hr", roles: ["hr"] };
  });

  it("200 from clearance_pending (FSM allows), regardless of the LWD", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("clearance_pending", { employee: OTHER_EMP, withinLwd: 0 })]);
    const res = await withdraw();
    expect(res.status).toBe(200);
    expect(res.body.data.onBehalf).toBe(true);
    expect(sqls().some((s) => s.includes("INSERT INTO sensitive_action_log"))).toBe(true);
  });

  it("409 from exited (FSM refuses) — unchanged", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("exited", { employee: OTHER_EMP })]);
    const res = await withdraw();
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("exited → withdrawn");
  });

  it("409 from notice_active — the FSM's existing answer is unchanged for on-behalf", async () => {
    on(/SELECT status, employee_id/, () => [exitRow("notice_active", { employee: OTHER_EMP })]);
    const res = await withdraw();
    expect(res.status).toBe(409);
  });
});

describe("POST /me/talk-first", () => {
  const talk = (body: Row = {}) => request(app()).post("/api/exit/resignation/me/talk-first").send(body);

  it("creates NO exit_request, records the audit row and notifies manager + HR", async () => {
    const res = await talk({ note: "Can we talk about my shift?" });
    expect(res.status).toBe(201);
    expect(sqls().some((s) => /exit_request/.test(s) && /INSERT|UPDATE/i.test(s))).toBe(false);
    const audit = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO sensitive_action_log"))!;
    expect(String(audit[0])).toContain("INTERVAL 24 HOUR");
    expect(audit[1]).toContain("RESIGNATION_TALK_FIRST_REQUESTED");
    expect(audit[1]).toContain(OWN_EMP);
    const byUser = Object.fromEntries(createItem.mock.calls.map((c: any[]) => [c[0].user_id, c[0]]));
    expect(Object.keys(byUser).sort()).toEqual(["hr-user-1", "hr-user-2", "mgr-user"]);
    expect(byUser["mgr-user"].description).toContain("Can we talk about my shift?");
    expect(res.body.data).toMatchObject({ notifiedManager: 1, notifiedHr: 2 });
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("hr", "br-1");
  });

  it("409 when a request was already made in the last 24 h (the guarded insert hit 0 rows)", async () => {
    on(/INSERT INTO sensitive_action_log/, () => ({ affectedRows: 0 }));
    const res = await talk();
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/24 hours/);
    expect(createItem).not.toHaveBeenCalled();
  });

  it("never notifies the employee themselves (an HR employee in their own branch)", async () => {
    resolveRoleHolderUserIds.mockResolvedValue(["user-self", "hr-user-1"]);
    const res = await talk();
    expect(res.status).toBe(201);
    expect(createItem.mock.calls.map((c: any[]) => c[0].user_id)).not.toContain("user-self");
  });

  it("422 with no manager and no HR mapped — and the 24 h allowance is not spent", async () => {
    handlers.length = 0;
    on(/FROM employees e\s+LEFT JOIN employees mgr/, () => [
      { user_id: "user-self", employee_code: "MAS1", branch_id: null, name: "Asha", manager_user_id: null },
    ]);
    resolveRoleHolderUserIds.mockResolvedValue([]);
    const res = await talk();
    expect(res.status).toBe(422);
    expect(sqls().some((s) => s.includes("INSERT INTO sensitive_action_log"))).toBe(false);
  });

  it("400 for an over-long note", async () => {
    const res = await talk({ note: "x".repeat(501) });
    expect(res.status).toBe(400);
  });
});

describe("GET /me/journey-summary", () => {
  const summary = (qs = "") => request(app()).get(`/api/exit/resignation/me/journey-summary${qs}`);

  it("reads only the caller's employee — an employeeId in the query is ignored", async () => {
    on(/FROM employees e\s+LEFT JOIN designation_master/, (p) => [
      { id: p[0], employee_code: "MAS1", first_name: "Asha", last_name: "Rao", full_name: "Asha Rao", photo_url: null,
        date_of_joining: "2023-07-03", total_months: 38, designation_name: "Senior Associate", branch_name: "Noida",
        dept_name: null, process_name: "Voice" },
    ]);
    on(/FROM promotion_record/, () => [{ id: "p1", from_designation: "Associate", to_designation: "Senior Associate", effective_date: "2025-01-01" }]);
    on(/SELECT COUNT\(\*\) AS n FROM kudos_transaction/, () => [{ n: 4 }]);
    on(/SELECT y.n AS years/, () => [{ years: 1, on_date: "2024-07-03" }, { years: 2, on_date: "2025-07-03" }, { years: 3, on_date: "2026-07-03" }]);

    const res = await summary(`?employeeId=${OTHER_EMP}`);
    expect(res.status).toBe(200);
    const params = dbExecute.mock.calls.flatMap((c) => (c[1] as unknown[]) ?? []);
    expect(params).not.toContain(OTHER_EMP);
    expect(params).toContain(OWN_EMP);
    const d = res.body.data;
    expect(d.profile).toMatchObject({ name: "Asha Rao", designation: "Senior Associate", branch: "Noida" });
    expect(d.tenure).toMatchObject({ years: 3, months: 2, label: "3 years 2 months" });
    expect(d.notice_period_days).toBe(30);
    expect(d.timeline[0].type).toBe("joining"); // oldest first
    expect(d.timeline.map((e: Row) => e.type)).toContain("promotion");
    expect(d.achievements.kudos.count).toBe(4);
    expect(d.achievements.milestones.count).toBe(3);
  });

  it("empty or missing source tables give empty sections, not a 500", async () => {
    on(/FROM employees e\s+LEFT JOIN designation_master/, (p) => [
      { id: p[0], employee_code: "MAS1", first_name: "New", last_name: null, full_name: null, photo_url: null,
        date_of_joining: null, total_months: 0, designation_name: null, branch_name: null, dept_name: null, process_name: null },
    ]);
    on(/kudos|badge|spotlight|promotion_record|transfer_record|salary_increment|employee_probation/, () => {
      throw Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
    });
    const res = await summary();
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.timeline).toEqual([]);
    for (const k of ["kudos", "badges", "milestones", "recognitions"]) {
      expect(d.achievements[k].count).toBe(0);
      expect(d.achievements[k].recent).toEqual([]);
    }
    expect(d.tenure.label).toBe("Less than a month");
  });

  it("403 when the account has no employee record", async () => {
    getEmployeeForUser.mockResolvedValue(null);
    const res = await summary();
    expect(res.status).toBe(403);
    expect(dbExecute).not.toHaveBeenCalled();
  });
});

describe("GET /:exitId/audit and /retention-offers — the employee's own page", () => {
  it("the owner can read their own trail, without HR internal notes", async () => {
    on(/SELECT id FROM exit_request WHERE id = \? AND employee_id = \?/, () => [{ id: EXIT_ID }]);
    const res = await request(app()).get(`/api/exit/resignation/${EXIT_ID}/audit`);
    expect(res.status).toBe(200);
    const trail = sqls().find((s) => s.includes("FROM exit_approval_log eal"))!;
    expect(trail).not.toContain("internal_notes");
  });

  it("403 for someone else's exit request", async () => {
    const res = await request(app()).get(`/api/exit/resignation/${EXIT_ID}/retention-offers`);
    expect(res.status).toBe(403);
    expect(sqls().some((s) => s.includes("FROM retention_offer"))).toBe(false);
  });
});
