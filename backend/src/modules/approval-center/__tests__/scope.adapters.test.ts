/**
 * Approval Center branch / reporting-manager / role scope, group A (people, attendance, roster, exit, statutory, mobility, recruitment).
 *
 * Every module list endpoint is simulated at its WORST: it returns the rows of BOTH branches to whoever asks (the leaks being
 * fixed: org-wide admin/hr lists, role-queue items, assignment-widened scope, role flags that are not per-row). The adapter must
 * still show each request ONLY to the person responsible: its effective approver, a role holder in the SAME branch as the
 * employee, or an org-wide person (isOrgWideUser) - never to another branch's admin/hr/branch_head, never to the employee.
 */
import { describe, it, expect, vi } from "vitest";

type Role = string;
interface U { emp: string | null; branch: string | null; roles: Role[]; orgWide?: boolean }

const w = vi.hoisted(() => {
  const users: Record<string, U> = {};
  /** employee id -> { code, branch, manager } */
  const emps: Record<string, { code: string; branch: string; manager: string | null }> = {};
  const branches: Record<string, { name: string; code: string }> = {};
  const cand: Record<string, string> = {};
  const workItems: Record<string, { assignee: string | null; branch: string | null }> = {};
  return { users, emps, branches, cand, workItems };
});

// ── world ───────────────────────────────────────────────────────────────────────
Object.assign(w.branches, { b1: { name: "Noida", code: "NOI" }, b2: { name: "Pune", code: "PUN" } });
Object.assign(w.emps, {
  e1: { code: "E1", branch: "b1", manager: "m1" },   // employee in branch 1, reports to m1
  e2: { code: "E2", branch: "b2", manager: "m2" },   // employee in branch 2, reports to m2
  m1: { code: "M1", branch: "b1", manager: null },
  m1b: { code: "M1B", branch: "b1", manager: null },  // another manager of branch 1, NOT e1's reporting manager
  m2: { code: "M2", branch: "b2", manager: null },
  a1: { code: "A1", branch: "b1", manager: null }, a2: { code: "A2", branch: "b2", manager: null },
  h1: { code: "H1", branch: "b1", manager: null }, h2: { code: "H2", branch: "b2", manager: null },
  bh1: { code: "BH1", branch: "b1", manager: null }, bh2: { code: "BH2", branch: "b2", manager: null },
  w1: { code: "W1", branch: "b1", manager: null }, w2: { code: "W2", branch: "b2", manager: null },
  p1: { code: "P1", branch: "b1", manager: null }, p2: { code: "P2", branch: "b2", manager: null },
  pm1: { code: "PM1", branch: "b1", manager: null }, pm2: { code: "PM2", branch: "b2", manager: null },
  ho: { code: "HO", branch: "b1", manager: null },
});
Object.assign(w.users, {
  mgr1: { emp: "m1", branch: "b1", roles: ["manager"] },
  mgr1b: { emp: "m1b", branch: "b1", roles: ["manager"] },
  mgr2: { emp: "m2", branch: "b2", roles: ["manager"] },
  admin1: { emp: "a1", branch: "b1", roles: ["admin"] },
  admin2: { emp: "a2", branch: "b2", roles: ["admin"] },
  hr1: { emp: "h1", branch: "b1", roles: ["hr"] },
  hr2: { emp: "h2", branch: "b2", roles: ["hr"] },
  bh1: { emp: "bh1", branch: "b1", roles: ["branch_head"] },
  bh2: { emp: "bh2", branch: "b2", roles: ["branch_head"] },
  wfm1: { emp: "w1", branch: "b1", roles: ["wfm"] },
  wfm2: { emp: "w2", branch: "b2", roles: ["wfm"] },
  pay1: { emp: "p1", branch: "b1", roles: ["payroll"] },
  pay2: { emp: "p2", branch: "b2", roles: ["payroll"] },
  pm1: { emp: "pm1", branch: "b1", roles: ["process_manager"] },
  pm2: { emp: "pm2", branch: "b2", roles: ["process_manager"] },
  recruiter1: { emp: "p1", branch: "b1", roles: ["recruiter"] },
  payhead: { emp: "ho", branch: "b1", roles: ["payroll_head"], orgWide: true },
  fin: { emp: "ho", branch: "b1", roles: ["finance"], orgWide: true },
  ceo: { emp: "ho", branch: "b1", roles: ["ceo"], orgWide: true },
  root: { emp: "ho", branch: "b1", roles: ["super_admin"], orgWide: true },
  /** an admin who is the employee e1 himself */
  self1: { emp: "e1", branch: "b1", roles: ["admin", "hr", "branch_head", "payroll"] },
  /** admin with no employee record at all */
  ghost: { emp: null, branch: null, roles: ["admin"] },
});

const rolesOf = (uid: string): string[] => (w.users[uid]?.roles ?? []);
const anyRole = (uid: string, ...rs: string[]) => rolesOf(uid).includes("super_admin") || rs.some((r) => rolesOf(uid).includes(r));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, " ");
      if (/SELECT branch_id FROM employees WHERE id = \?/.test(s)) return [[{ branch_id: w.emps[params[0]]?.branch ?? null }], []];
      if (/SELECT id, branch_id FROM employees WHERE id IN/.test(s)) return [params.filter((p) => w.emps[p]).map((p) => ({ id: p, branch_id: w.emps[p].branch })), []];
      if (/SELECT employee_code, branch_id FROM employees WHERE employee_code IN/.test(s)) {
        return [Object.entries(w.emps).filter(([, e]) => params.includes(e.code)).map(([, e]) => ({ employee_code: e.code, branch_id: e.branch })), []];
      }
      if (/SELECT id, employee_code FROM employees WHERE employee_code IN/.test(s)) {
        return [Object.entries(w.emps).filter(([, e]) => params.includes(e.code)).map(([id, e]) => ({ id, employee_code: e.code })), []];
      }
      if (/FROM branch_master WHERE id IN/.test(s)) {
        return [Object.entries(w.branches).filter(([id, b]) => params.includes(id) || params.includes(b.name) || params.includes(b.code)).map(([id, b]) => ({ id, branch_name: b.name, branch_code: b.code })), []];
      }
      if (/FROM ats_candidate WHERE id IN/.test(s)) return [params.filter((p) => w.cand[p]).map((p) => ({ id: p, branch_key: w.cand[p] })), []];
      if (/FROM work_item WHERE id IN/.test(s)) {
        return [params.filter((p) => w.workItems[p]).map((p) => ({ id: p, assigned_to_user_id: w.workItems[p].assignee, branch_id: w.workItems[p].branch })), []];
      }
      throw new Error(`unexpected SQL in scope test: ${s.slice(0, 120)}`);
    },
  },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  isOrgWideUser: async (uid: string) => Boolean(w.users[uid]?.orgWide),
  hasAnyRole: async (uid: string, ...rs: string[]) => anyRole(uid, ...rs),
  hasScopedAccess: async (uid: string, rs: string[]) => anyRole(uid, ...rs),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: async (uid: string) => {
    const e = w.users[uid]?.emp;
    return e ? { id: e, employee_code: w.emps[e].code } : null;
  },
  hasRole: async (uid: string, ...rs: string[]) => anyRole(uid, ...rs),
}));
vi.mock("../../../shared/approvalEscalation.js", () => ({
  resolveEffectiveApprover: async (eid: string) => ({ approverId: w.emps[eid]?.manager ?? null, isEscalated: false, escalationReason: null }),
}));
vi.mock("../adapters/_roles.js", () => ({
  callerHasRole: async (uid: string, ...rs: string[]) => anyRole(uid, ...rs),
  callerRoleKeys: async (uid: string) => rolesOf(uid),
}));
vi.mock("../../wfm/wfm.regularization.secure.routes.js", () => ({
  nextRegularizationStatus: () => "next",
  // Mirrors regularizationReviewRole: payroll stage = role only; manager = effective approver; wfm = scoped (same branch here).
  regularizationReviewRole: async (uid: string, rid: string) => {
    const row = (globalThis as any).__regRows?.find((r: any) => r.id === rid);
    if (!row) return null;
    const me = w.users[uid];
    if (anyRole(uid, "super_admin")) return "super_admin";
    if (me?.emp === row.employee_id) return null;
    if (row.status === "payroll_pending") return anyRole(uid, "payroll", "payroll_head") ? "payroll" : null;
    if (me?.emp && w.emps[row.employee_id].manager === me.emp) return "manager";
    return anyRole(uid, "wfm") && me?.branch === w.emps[row.employee_id].branch ? "wfm" : null;
  },
}));
vi.mock("../../roster-requests/roster-requests.routes.js", () => ({
  rolesForKindAction: (kind: string) =>
    kind === "weekoff_rejection" ? ["admin", "hr", "wfm", "manager", "branch_head"]
    : kind === "dispute" ? ["admin", "hr", "wfm", "manager", "assistant_manager", "team_leader", "branch_head", "process_manager"]
    : ["admin", "hr", "wfm", "manager", "assistant_manager", "team_leader"],
}));
vi.mock("../../exit/exit.routes.js", () => ({
  canClearTask: (area: string, roles: string[]) =>
    roles.some((r) => ["admin", "super_admin"].includes(r)) ||
    (area === "manager" ? ["manager", "assistant_manager", "process_manager", "branch_head"] : area === "hr" ? ["hr", "admin"] : ["payroll", "payroll_head"]).some((r) => roles.includes(r)),
}));
vi.mock("../../employees/statutory-approval.routes.js", () => ({ maskStatutoryValues: (v: unknown) => v ?? {} }));
vi.mock("../../work-inbox/work-inbox.service.js", () => ({ assertWorkItemAccess: async () => undefined }));
vi.mock("../../work-inbox/action-item-registry.js", () => ({ buildActionDeeplink: () => "/work-inbox" }));

import { leaveAdapter } from "../adapters/leave.js";
import { regularizationAdapter } from "../adapters/regularization.js";
import { manualOverrideAdapter } from "../adapters/manual-override.js";
import { holidayWorkAdapter } from "../adapters/holiday-work.js";
import { rosterSwapAdapter, rosterWeekoffAdapter, rosterDisputeAdapter, rosterConflictAdapter } from "../adapters/roster-requests.js";
import { rosterPreferenceAdapter } from "../adapters/roster-preference.js";
import { teamRosterAdapter } from "../adapters/team-roster.js";
import { autoRosterAdapter } from "../adapters/auto-roster.js";
import { rmChangeAdapter } from "../adapters/rm-change.js";
import { exitResignationAdapter } from "../adapters/exit-resignation.js";
import { exitClearanceAdapter } from "../adapters/exit-clearance.js";
import { exitFfAdapter } from "../adapters/exit-ff.js";
import { rejoinAdapter } from "../adapters/rejoin.js";
import { statutoryChangeAdapter } from "../adapters/statutory-change.js";
import { bankChangeAdapter } from "../adapters/bank-change.js";
import { statutoryOptOutAdapter } from "../adapters/statutory-optout.js";
import { mobilityAdapter } from "../adapters/mobility.js";
import { jobRequisitionAdapter } from "../adapters/job-requisition.js";
import { atsOfferAdapter } from "../adapters/ats-offer.js";
import { atsBranchHeadAdapter } from "../adapters/ats-branch-head.js";
import { payrollHeadReviewAdapter } from "../adapters/payroll-head-review.js";
import { bgvReviewAdapter } from "../adapters/bgv-review.js";
import { awolAdapter } from "../adapters/awol.js";
import { workItemAdapter } from "../adapters/work-item.js";
import type { ApprovalAdapter, LoopbackCtx } from "../types.js";

type Routes = Record<string, unknown | ((opts: any) => unknown)>;

/** Run the adapter as `uid`; every module endpoint answers `routes` (the module's leaky, branch-blind answer). */
async function idsFor(adapter: ApprovalAdapter, uid: string, routes: Routes): Promise<string[]> {
  const ctx: LoopbackCtx = {
    userId: uid,
    async call(method, path, opts) {
      const hit = routes[`${method} ${path}`];
      if (hit === undefined) throw Object.assign(new Error(`no route ${method} ${path}`), { status: 403 });
      return (typeof hit === "function" ? (hit as any)(opts) : hit) as never;
    },
  };
  return (await adapter.list(ctx)).map((i) => i.id).sort();
}

async function table(adapter: ApprovalAdapter, routes: Routes, expected: Record<string, string[]>) {
  for (const [uid, want] of Object.entries(expected)) {
    expect({ uid, ids: await idsFor(adapter, uid, routes) }, `${adapter.kind} as ${uid}`).toEqual({ uid, ids: [...want].sort() });
  }
}

describe("leave", () => {
  const row = (id: string, emp: string, status = "pending") => ({ id, employee_id: emp, employee_code: w.emps[emp].code, status, can_review: true, employee_name: "X", leave_type_name: "CL", total_days: 1, from_date: "2026-10-10", to_date: "2026-10-10", applied_at: "2026-10-01" });
  // The leave module\'s own can_review flag, simulated at its widest: manager stage true for everyone, exception tier true for branch roles.
  const routesFor = (uid: string) => ({
    "GET /api/leave/requests": { data: [row("L1", "e1"), row("L2", "e2"), row("L3", "e1", "pending_branch_head"), row("L4", "e2", "pending_branch_head")].map((r) => ({ ...r, can_review: r.status === "pending" || ["branch_head", "hr", "admin", "super_admin", "ceo"].some((x) => rolesOf(uid).includes(x)) })) },
  });
  it("effective approver anywhere, branch reviewers only in their own branch, org-wide everything, never own", async () => {
    const exp: Record<string, string[]> = {
      mgr1: ["L1"],            // reporting manager of e1 (manager stage)
      mgr1b: [],               // manager of the same branch who is NOT e1's reporting manager: module flag true, still not theirs
      mgr2: ["L2"],
      hr1: ["L1", "L3"], hr2: ["L2", "L4"],
      admin1: ["L1", "L3"], admin2: ["L2", "L4"],
      bh1: ["L1", "L3"], bh2: ["L2", "L4"],
      ceo: ["L1", "L2", "L3", "L4"], root: ["L1", "L2", "L3", "L4"],
      self1: [],               // admin who IS e1: own leave excluded; e2's is another branch
      ghost: [],               // no employee record -> no branch -> sees nothing
    };
    for (const [uid, want] of Object.entries(exp)) expect({ uid, ids: await idsFor(leaveAdapter, uid, routesFor(uid)) }).toEqual({ uid, ids: want });
  });
});

describe("regularization", () => {
  const rows = [
    { id: "r1", employee_id: "e1", status: "pending" },
    { id: "r2", employee_id: "e2", status: "pending" },
    { id: "r3", employee_id: "e1", status: "payroll_pending" },
    { id: "r4", employee_id: "e2", status: "payroll_pending" },
  ].map((r) => ({ ...r, employee_code: w.emps[r.employee_id].code, decision_support: { canApproveNow: true }, created_at: "2026-10-01" }));
  (globalThis as any).__regRows = rows;
  const routes = { "GET /api/wfm/regularizations": { data: rows } };
  it("manager = effective approver, wfm same branch, payroll stage branch-clamped except payroll_head/super", async () => {
    await table(regularizationAdapter, routes, {
      mgr1: ["r1"], mgr1b: [], mgr2: ["r2"],
      wfm1: ["r1"], wfm2: ["r2"],
      pay1: ["r3"], pay2: ["r4"],         // payroll role is branch-scoped at the 3rd stage
      payhead: ["r3", "r4"], root: ["r1", "r2", "r3", "r4"],
      admin1: [], hr1: [],
      self1: [],                      // e1 himself: never his own; payroll role but r4 is another branch
    });
  });
});

describe("manual override", () => {
  const rows = [
    { id: "o1", approval_status: "pending", employee_id: "e1", employee_code: "E1" },
    { id: "o2", approval_status: "pending", employee_id: "e2", employee_code: "E2" },
  ];
  it("payroll_head/super org-wide, admin only own branch", async () => {
    await table(manualOverrideAdapter, { "GET /api/attendance/manual-overrides": { data: rows } }, {
      payhead: ["o1", "o2"], root: ["o1", "o2"], admin1: ["o1"], admin2: ["o2"], self1: [], ghost: [],
    });
  });
});

describe("holiday work", () => {
  const rows = [{ id: "h1", status: "submitted", branch_id: "b1" }, { id: "h2", status: "submitted", branch_id: "b2" }];
  const routes = { "GET /api/payroll/holiday-work/requests": { data: rows }, "GET /api/payroll/holiday-work/requests/h1": { data: {} }, "GET /api/payroll/holiday-work/requests/h2": { data: {} } };
  it("admin/payroll branch-scoped; payroll_head org-wide; others none", async () => {
    await table(holidayWorkAdapter, routes, { admin1: ["h1"], admin2: ["h2"], pay1: ["h1"], payhead: ["h1", "h2"], root: ["h1", "h2"], hr1: [], ceo: [] });
  });
});

describe("roster requests hub", () => {
  it("swap: effective approver, or admin/hr/wfm inside the branch; not other managers, not other branches", async () => {
    const routes = { "GET /api/wfm-ext/roster/swaps": { data: [
      { id: "s1", status: "pending", counterpart_status: "accepted", requester_employee_id: "e1" },
      { id: "s2", status: "pending", counterpart_status: "accepted", requester_employee_id: "e2" },
    ] } };
    await table(rosterSwapAdapter, routes, { mgr1: ["s1"], mgr1b: [], mgr2: ["s2"], admin1: ["s1"], admin2: ["s2"], hr1: ["s1"], wfm2: ["s2"], bh1: [], root: ["s1", "s2"], self1: [] });
  });
  it("week-off rejection", async () => {
    const routes = { "GET /api/wfm/manager/weekoff-review": { data: [{ id: "w1", employee_id: "e1", employee_code: "E1" }, { id: "w2", employee_id: "e2", employee_code: "E2" }] } };
    await table(rosterWeekoffAdapter, routes, { mgr1: ["w1"], mgr1b: [], mgr2: ["w2"], admin1: ["w1"], hr2: ["w2"], bh1: ["w1"], bh2: ["w2"], wfm1: ["w1"], root: ["w1", "w2"], self1: [] });
  });
  it("dispute (rows carry employee_id only)", async () => {
    const routes = { "GET /api/roster-gov/manager-review-queue": { data: [{ id: "d1", employee_id: "e1" }, { id: "d2", employee_id: "e2" }] } };
    await table(rosterDisputeAdapter, routes, { mgr1: ["d1"], mgr1b: [], mgr2: ["d2"], pm1: ["d1"], bh1: ["d1"], bh2: ["d2"], wfm1: ["d1"], root: ["d1", "d2"] });
  });
  it("conflict", async () => {
    const routes = { "GET /api/wfm-ext/roster/conflicts": { data: [{ id: "c1", status: "open", employees_involved: ["e1"], employee_names: ["A"] }, { id: "c2", status: "open", employees_involved: ["e2"], employee_names: ["B"] }] } };
    await table(rosterConflictAdapter, routes, { mgr1: ["c1"], mgr2: ["c2"], admin1: ["c1"], admin2: ["c2"], hr1: ["c1"], bh1: [], root: ["c1", "c2"] });
  });
});

describe("roster preference", () => {
  const rows = [{ id: "p1", employee_id: "e1", employee_code: "E1", status: "pending" }, { id: "p2", employee_id: "e2", employee_code: "E2", status: "pending" }];
  it("effective approver, or admin/hr/wfm inside the branch", async () => {
    await table(rosterPreferenceAdapter, { "GET /api/wfm/roster-preferences/pending": { data: rows } }, { mgr1: ["p1"], mgr1b: [], mgr2: ["p2"], wfm1: ["p1"], hr2: ["p2"], admin1: ["p1"], root: ["p1", "p2"], self1: [] });
  });
});

describe("team roster", () => {
  const perms = (wfm: boolean) => ({ canManagerDecide: true, canWfmDecide: wfm });
  const routesFor = (uid: string): Routes => ({
    "GET /api/wfm/team-roster/approvals": (o: any) => ({ data: { items: o.query.step === "manager"
      ? [{ id: 1, submitter: { code: "E1", name: "t" } }, { id: 2, submitter: { code: "E2", name: "t" } }]
      : [{ id: 3, submitter: { code: "E1", name: "t" } }, { id: 4, submitter: { code: "E2", name: "t" } }] } }),
    "GET /api/wfm/team-roster/submissions/1": { data: { permissions: perms(false), submission: { managerApprover: { id: "m1" } }, lines: [] } },
    "GET /api/wfm/team-roster/submissions/2": { data: { permissions: perms(false), submission: { managerApprover: { id: "m2" } }, lines: [] } },
    "GET /api/wfm/team-roster/submissions/3": { data: { permissions: perms(true), submission: {}, lines: [] } },
    "GET /api/wfm/team-roster/submissions/4": { data: { permissions: perms(true), submission: {}, lines: [] } },
  });
  it("manager step: named approver; WFM step: branch; admin (a module-global approver) only own branch", async () => {
    const exp: Record<string, string[]> = {
      mgr1: ["1"], mgr1b: [], mgr2: ["2"],            // module says canManagerDecide for everyone here; only the named approver may see it
      wfm1: ["3"], wfm2: ["4"],
      admin1: ["1", "3"], admin2: ["2", "4"],
      root: ["1", "2", "3", "4"],
    };
    for (const [uid, want] of Object.entries(exp)) {
      // mgr*: module never grants WFM step to managers
      const r = routesFor(uid);
      if (uid.startsWith("mgr")) for (const id of [3, 4]) (r as any)[`GET /api/wfm/team-roster/submissions/${id}`] = { data: { permissions: perms(false), submission: {}, lines: [] } };
      if (uid.startsWith("wfm")) for (const id of [1, 2]) (r as any)[`GET /api/wfm/team-roster/submissions/${id}`] = { data: { permissions: { canManagerDecide: false, canWfmDecide: false }, submission: {}, lines: [] } };
      expect({ uid, ids: await idsFor(teamRosterAdapter, uid, r) }).toEqual({ uid, ids: want });
    }
  });
});

describe("auto roster", () => {
  const plans = [{ id: "a1", approval_status: "submitted", process_id: "pr1", branch_id: "b1" }, { id: "a2", approval_status: "submitted", process_id: "pr2", branch_id: "b2" }];
  const routes = { "GET /api/wfm/auto-roster/plans": { data: plans }, "GET /api/wfm/auto-roster/masters": { data: { processes: [], branches: [] } } };
  it("process_manager only for plans of the branch on their own record", async () => {
    await table(autoRosterAdapter, routes, { pm1: ["a1"], pm2: ["a2"], root: ["a1", "a2"], admin1: [] });
  });
});

describe("rm change", () => {
  const rows = [{ id: "r1", status: "pending", branch_id: "b1", employee_id: "e1" }, { id: "r2", status: "pending", branch_id: "b2", employee_id: "e2" }];
  it("module treats admin/hr as org-wide: adapter clamps them to their branch", async () => {
    await table(rmChangeAdapter, { "GET /api/rm-change/pending": { data: rows } }, { admin1: ["r1"], admin2: ["r2"], hr1: ["r1"], hr2: ["r2"], bh1: ["r1"], bh2: ["r2"], ceo: ["r1", "r2"], root: ["r1", "r2"], self1: [], ghost: [] });
  });
});

describe("exit resignation", () => {
  const x = (id: string, emp: string) => ({ id, status: "submitted", employee_id: emp, employee_code: w.emps[emp].code, initiated_by: "employee", initiated_by_user_id: `u-${emp}` });
  const routes = { "GET /api/exit": (o: any) => ({ data: o.query.status === "submitted" ? [x("x1", "e1"), x("x2", "e2")] : [] }) };
  it("effective approver (not other managers), admin/hr/branch_head own branch only", async () => {
    await table(exitResignationAdapter, routes, { mgr1: ["x1"], mgr1b: [], mgr2: ["x2"], admin1: ["x1"], hr2: ["x2"], bh1: ["x1"], bh2: ["x2"], pm1: [], root: ["x1", "x2"], self1: [] });
  });
});

describe("exit clearance", () => {
  const t = (id: string, area: string, emp: string) => ({ id, clearance_area: area, exit_request_id: `x-${emp}`, employee_id: emp, employee_code: w.emps[emp].code, status: "pending" });
  const routes = { "GET /api/exit/clearance/queue": { data: [t("t1", "manager", "e1"), t("t2", "hr", "e1"), t("t3", "hr", "e2"), t("t4", "manager", "e2")] } };
  it("manager handover to the leaver's manager; departmental tasks to that department in the same branch", async () => {
    await table(exitClearanceAdapter, routes, {
      mgr1: ["t1"], mgr1b: [], mgr2: ["t4"],
      hr1: ["t2"], hr2: ["t3"],
      admin1: ["t1", "t2"], admin2: ["t3", "t4"],
      bh1: ["t1"], bh2: ["t4"], root: ["t1", "t2", "t3", "t4"],
    });
  });
});

describe("exit F&F", () => {
  const req = (id: string, emp: string) => ({ id, ff_status: "draft", clearance_cleared: 1, clearance_total: 1, is_ff_provisional: 0, employee_id: emp, employee_code: w.emps[emp].code });
  const ff = (id: string) => ({ data: { id: `f-${id}`, status: "draft", is_ff_provisional: 0, net_payable: 1 } });
  const routes = { "GET /api/exit/command-center": { data: { requests: [req("x1", "e1"), req("x2", "e2")] } }, "GET /api/exit/ff/x1": ff("x1"), "GET /api/exit/ff/x2": ff("x2") };
  it("admin/payroll own branch; finance org-wide; hr cannot approve", async () => {
    await table(exitFfAdapter, routes, { admin1: ["f-x1"], admin2: ["f-x2"], pay1: ["f-x1"], pay2: ["f-x2"], fin: ["f-x1", "f-x2"], root: ["f-x1", "f-x2"], hr1: [], self1: [] });
  });
});

describe("rejoin", () => {
  const rows = [{ id: "j1", status: "pending", employee_id: "e1" }, { id: "j2", status: "pending", employee_id: "e2" }];
  it("branch_head of the employee's branch only", async () => {
    await table(rejoinAdapter, { "GET /api/employees/reactivation/pending": { data: rows } }, { bh1: ["j1"], bh2: ["j2"], admin1: [], hr1: [], root: ["j1", "j2"], self1: [] });
  });
});

describe("statutory change", () => {
  const rows = [{ id: 1, status: "pending", employee_id: "e1", new_values: "{}", old_values: "{}" }, { id: 2, status: "pending", employee_id: "e2", new_values: "{}", old_values: "{}" }];
  it("hr/admin own branch only; org-wide all; never the person's own", async () => {
    await table(statutoryChangeAdapter, { "GET /api/statutory-change-requests/pending": { data: rows } }, { hr1: ["1"], hr2: ["2"], admin1: ["1"], admin2: ["2"], ceo: ["1", "2"], root: ["1", "2"], self1: [] });
  });
});

describe("bank change", () => {
  const rows = [{ id: 11, status: "pending", employee_id: "e1" }, { id: 12, status: "pending", employee_id: "e2" }];
  it("payroll own branch; payroll_head/super org-wide", async () => {
    await table(bankChangeAdapter, { "GET /api/payroll/bank-change-requests": { data: rows } }, { pay1: ["11"], pay2: ["12"], payhead: ["11", "12"], root: ["11", "12"], self1: [] });
  });
});

describe("statutory opt-out", () => {
  const rows = [{ id: 21, status: "pending", employee_id: "e1", override_type: "pf_opt_out" }, { id: 22, status: "pending", employee_id: "e2", override_type: "pf_opt_out" }];
  it("payroll own branch; super org-wide; finance/hr cannot decide", async () => {
    await table(statutoryOptOutAdapter, { "GET /api/payroll/statutory-overrides/pending": { data: rows } }, { pay1: ["21"], pay2: ["22"], root: ["21", "22"], fin: [], hr1: [] });
  });
});

describe("mobility", () => {
  const routes = {
    "GET /api/mobility/transfers": { data: [{ id: "mt1", status: "pending", employee_id: "e1" }, { id: "mt2", status: "pending", employee_id: "e2" }] },
    "GET /api/mobility/promotions": { data: [{ id: "mp1", status: "pending", employee_id: "e1" }, { id: "mp2", status: "pending", employee_id: "e2" }] },
  };
  it("hr/admin own branch; org-wide with the role; never own", async () => {
    await table(mobilityAdapter, routes, { hr1: ["mt1", "mp1"], hr2: ["mt2", "mp2"], admin1: ["mt1", "mp1"], admin2: ["mt2", "mp2"], bh1: [], root: ["mt1", "mt2", "mp1", "mp2"], self1: [] });
  });
});

describe("job requisition", () => {
  const rows = [{ id: "q1", branch_id: "b1" }, { id: "q2", branch_id: "b2" }];
  it("branch head of the requisition's branch (assignment reach cannot widen)", async () => {
    await table(jobRequisitionAdapter, { "GET /api/job-requisition/pending-approvals": { data: rows } }, { bh1: ["q1"], bh2: ["q2"], root: ["q1", "q2"], ghost: [] });
  });
});

describe("ATS offer + legacy branch-head approval", () => {
  const offers = [{ offer_id: "o1", candidate_id: "c1", payroll_validated: 1, branch_id: "b1" }, { offer_id: "o2", candidate_id: "c2", payroll_validated: 1, branch_id: "b2" }];
  it("ats_offer: branch_head (not admin/hr/payroll_hr who the endpoint also serves), own branch only", async () => {
    await table(atsOfferAdapter, { "GET /api/ats/onboarding/pending-approval": { data: offers } }, { bh1: ["o1"], bh2: ["o2"], admin1: [], hr1: [], pay1: [], root: ["o1", "o2"] });
  });
  it("ats_branch_head: same, branch given as id OR name", async () => {
    const rows = [{ id: "a1", candidate_id: "c1", applied_for_branch: "b1" }, { id: "a2", candidate_id: "c2", applied_for_branch: "Pune" }];
    await table(atsBranchHeadAdapter, { "GET /api/ats/branch-head-approval/pending": { data: rows } }, { bh1: ["a1"], bh2: ["a2"], admin1: [], hr2: [], root: ["a1", "a2"] });
  });
});

describe("payroll head review", () => {
  const rows = [{ employee_id: "e1", package_accepted: 1, pending_hours: 1 }, { employee_id: "e2", package_accepted: 1, pending_hours: 1 }];
  it("payroll_head / super_admin only (org-wide by role); nobody else", async () => {
    await table(payrollHeadReviewAdapter, { "GET /api/payroll-head-review/queue": { data: rows } }, { payhead: ["e1", "e2"], root: ["e1", "e2"], admin1: [], pay1: [], hr1: [], fin: [] });
  });
});

describe("BGV review", () => {
  Object.assign(w.cand, { c1: "b1", c2: "Pune" });
  const routes = {
    "GET /api/inbox/my-pending": { items: [{ source: "derived", entity_type: "candidate_bgv_check", entity_id: "g1" }, { source: "derived", entity_type: "candidate_bgv_check", entity_id: "g2" }] },
    "GET /api/inbox/derived/candidate_bgv_check/g1": { data: { id: "g1", status: "manual_review", candidate_id: "c1" } },
    "GET /api/inbox/derived/candidate_bgv_check/g2": { data: { id: "g2", status: "mismatch", candidate_id: "c2" } },
  };
  it("HR decision in the candidate's own branch; recruiters do not decide", async () => {
    await table(bgvReviewAdapter, routes, { hr1: ["g1"], hr2: ["g2"], admin1: ["g1"], recruiter1: [], root: ["g1", "g2"], bh1: [] });
  });
});

describe("AWOL + work-inbox items (role-queue rows)", () => {
  Object.assign(w.workItems, {
    k1: { assignee: "u-mgr1", branch: "b1" },   // AWOL assigned by user id to the reporting manager
    k2: { assignee: null, branch: "b2" },        // unassigned role-queue item of branch 2
    k3: { assignee: "u-mgr2", branch: "b2" },
  });
  // user ids in the DB are the same strings as our fixture keys with a "u-" prefix in the item; fixture users are keyed without it
  w.users["u-mgr1"] = w.users.mgr1; w.users["u-mgr2"] = w.users.mgr2;
  const my = (type: string, ids: string[]) => ({ data: ids.map((id) => ({ id, source_table: "work_item", item_type: type, status: "pending", title: id })) });
  it("awol: the assignee, not every privileged role; role-queue case only in its own branch", async () => {
    const routes = { "GET /api/work-inbox/my": my("AWOL_SUSPECTED", ["k1", "k2", "k3"]), "GET /api/work-inbox/k1/awol-context": { data: {} }, "GET /api/work-inbox/k2/awol-context": { data: {} }, "GET /api/work-inbox/k3/awol-context": { data: {} } };
    await table(awolAdapter, routes, { "u-mgr1": ["k1"], "u-mgr2": ["k3", "k2"], admin1: [], bh1: [], admin2: ["k2"], root: ["k2"] });
  });
  it("work_item view-only cards: same rule", async () => {
    await table(workItemAdapter, { "GET /api/work-inbox/my": my("NOTICE_PERIOD_OVERRIDE_OPS", ["k1", "k2", "k3"]) }, { "u-mgr1": ["k1"], "u-mgr2": ["k3", "k2"], admin1: [], admin2: ["k2"], root: ["k2"] });
  });
});
