/**
 * Approval Center branch / role / responsible-person scope, group B (payroll, finance, admin, engagement, privacy).
 *
 * Every module list endpoint is simulated at its WORST: it returns the rows of BOTH branches (b1 Noida, b2 Pune) to whoever
 * its role gate admits - which is what the real endpoints do for the leaking ones (org-wide cost-centre / incentive / client-billing
 * lists, finance scope that treats `admin` as all-branch, assignment-widened branch-head queues, `admin` as DPO / exit-pass
 * override / visitor override). The adapter must still show each request ONLY to the person responsible: a role holder whose OWN
 * branch is the row's branch, an org-wide person (isOrgWideUser), the reporting manager for manager stages - never another
 * branch's admin / hr / branch_head / payroll, never the requester.
 */
import { describe, it, expect, vi } from "vitest";
import { fakeCtx } from "./_ctx.js";
import { useDirectory, person } from "./scope-fixture.js";
import type { ApprovalAdapter } from "../types.js";
import type { CallerScope } from "../adapters/scope-guard.js";

const D = vi.hoisted(() => ({ people: {} as Record<string, any> }));
const rolesOf = (uid: string): string[] => D.people[uid]?.roles ?? [];

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: async (sql: string, params: any[]) => {
      if (/FROM user_roles/i.test(sql)) return [rolesOf(params[0]).map((role_key) => ({ role_key }))];
      throw new Error(`unexpected sql in scope test: ${sql.slice(0, 80)}`);
    },
  },
}));
vi.mock("../../access/access.service.js", () => ({ getUserRoles: async (uid: string) => rolesOf(uid).map((role_key) => ({ role_key })) }));
// The finance scope resolver at its widest: everyone is all-branch (as it is for `admin`, or a branch head holding a global role).
vi.mock("../../finance/finance-access-scope.js", () => ({ resolveFinanceBranchScopeSet: async () => ({ mode: "all" }) }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  isOrgWideUser: async (uid: string) => Boolean(D.people[uid]?.orgWide),
  getUserRoleKeys: async (uid: string) => rolesOf(uid),
  hasAnyRole: async (uid: string, ...r: string[]) => rolesOf(uid).includes("super_admin") || r.some((x) => rolesOf(uid).includes(x)),
  // worst case for a branch role: a null-branch target passes (an 'all' assignment row); a real branch must be the caller's own.
  hasScopedAccess: async (uid: string, allowed: string[], t: { branchId?: string | null }) => {
    const p = D.people[uid];
    if (!p) return false;
    if (p.roles.includes("super_admin")) return true;
    if (!allowed.some((x) => p.roles.includes(x))) return false;
    return !t.branchId || p.orgWide || p.branchId === t.branchId;
  },
}));
vi.mock("../../salary-increment/salaryIncrement.service.js", () => ({
  INCREMENT_ROLE_GATES: { hr_validate: ["admin", "hr", "payroll_head", "super_admin"], approve: ["payroll_head", "super_admin"] },
}));
vi.mock("../../bulk-upload/bulk-approval.service.js", () => ({ APPROVER_ROLES: ["branch_head"], PAYROLL_APPROVER_ROLES: ["payroll_head"] }));
vi.mock("../../assets/exit-pass.service.js", () => ({
  getActorRoles: async (uid: string) => rolesOf(uid),
  resolveRequestingEmployee: async (uid: string) => {
    const p = D.people[uid];
    return p?.employeeId ? { employeeId: p.employeeId, branchId: p.branchId, fullName: uid } : null;
  },
}));
vi.mock("../../visitor/visitor.service.js", () => ({
  visitorService: { getScope: async (uid: string) => ({ employeeId: D.people[uid]?.employeeId ?? null, branchId: D.people[uid]?.branchId ?? null, roles: rolesOf(uid) }) },
}));

import { salaryIncrementAdapter } from "../adapters/salaryIncrement.js";
import { salaryRevisionAdapter } from "../adapters/salaryRevision.js";
import { salaryDisputeAdapter } from "../adapters/salaryDispute.js";
import { payrollSignoffAdapter } from "../adapters/payrollSignoff.js";
import { advancesAdapter } from "../adapters/advances.js";
import { loansAdapter } from "../adapters/loans.js";
import { reimbursementsAdapter } from "../adapters/reimbursements.js";
import { incentivesAdapter } from "../adapters/incentives.js";
import { bulkUploadAdapter } from "../adapters/bulkUpload.js";
import { nocAdapter } from "../adapters/noc.js";
import { grnAdapter } from "../adapters/grn.js";
import { branchBudgetAdapter } from "../adapters/branch-budget.js";
import { budgetTopupAdapter } from "../adapters/budget-topup.js";
import { pnlManualAdjustmentAdapter } from "../adapters/pnl-manual-adjustment.js";
import { revenueForecastAdapter, periodWindow } from "../adapters/revenue-forecast.js";
import { journalVoucherAdapter } from "../adapters/journal-voucher.js";
import { paymentVoucherAdapter } from "../adapters/payment-voucher.js";
import { vendorApprovalAdapter } from "../adapters/vendor-approval.js";
import { vendorBankChangeAdapter } from "../adapters/vendor-bank-change.js";
import { costCentreAdapter } from "../adapters/cost-centre.js";
import { clientInvoiceAdapter, clientCreditNoteAdapter } from "../adapters/client-billing.js";
import { imprestAllocationAdapter } from "../adapters/imprest-allocation.js";
import { workflowAdapter } from "../adapters/workflow.js";
import { companyPostAdapter } from "../adapters/company-post.js";
import { exitPassAdapter } from "../adapters/exit-pass.js";
import { visitorAdapter } from "../adapters/visitor.js";
import { accessRequestAdapter } from "../adapters/access-request.js";
import { benefitsClaimAdapter } from "../adapters/benefits-claim.js";
import { dpdpWithdrawalAdapter } from "../adapters/dpdp-withdrawal.js";

// ── the world ─────────────────────────────────────────────────────────────────────────────────────────────────────
const who = (userId: string, employeeId: string | null, branchId: string | null, roles: string[], orgWide = false): CallerScope =>
  person({ userId, employeeId, employeeCode: employeeId ? `C-${employeeId}` : null, branchId, roles, orgWide });

const people: Record<string, CallerScope> = {
  // branch roles, Noida (b1) and Pune (b2)
  bh1: who("bh1", "emp-bh1", "b1", ["branch_head"]),
  bh2: who("bh2", "emp-bh2", "b2", ["branch_head"]),
  admin1: who("admin1", "emp-ad1", "b1", ["admin"]),
  admin2: who("admin2", "emp-ad2", "b2", ["admin"]),
  hr1: who("hr1", "emp-hr1", "b1", ["hr"]),
  hr2: who("hr2", "emp-hr2", "b2", ["hr"]),
  pay1: who("pay1", "emp-pay1", "b1", ["payroll"]),
  pay2: who("pay2", "emp-pay2", "b2", ["payroll"]),
  wfm1: who("wfm1", "emp-wfm1", "b1", ["wfm"]),
  wfm2: who("wfm2", "emp-wfm2", "b2", ["wfm"]),
  bhAdmin1: who("bhAdmin1", "emp-bha1", "b1", ["branch_head", "admin"]),
  branchAdmin1: who("branchAdmin1", "emp-ba1", "b1", ["branch_admin"]),
  secHead1: who("secHead1", "emp-sec1", "b1", ["security_head"]),
  // reporting managers: m1 is e1's manager; mB is another manager in the same branch; m2 manages e2
  mgr1: who("mgr1", "m1", "b1", ["manager"]),
  mgrB: who("mgrB", "mB", "b1", ["manager"]),
  mgr2: who("mgr2", "m2", "b2", ["manager"]),
  hostA: who("hostA", "emp-hostA", "b1", ["employee"]),
  // org-wide people
  ph: who("ph", "emp-ho", "b1", ["payroll_head"], true),
  fh: who("fh", "emp-ho", "b1", ["finance_head"], true),
  ah: who("ah", "emp-ho", "b1", ["accounts_head"], true),
  fin: who("fin", "emp-ho", "b1", ["finance"], true),
  ceo: who("ceo", "emp-ho", "b1", ["ceo"], true),
  itHead: who("itHead", "emp-ho", "b1", ["it_head"], true),
  hrHead: who("hrHead", "emp-ho", "b1", ["hr_head"], true),
  dpo: who("dpo", "emp-dpo", "b1", ["dpo"]),
  root: who("root", "emp-ho", "b1", ["super_admin"], true),
};
/** Callers who are themselves the subject of a row (employee e1): checked one by one, not in the roster table. */
const subjects: Record<string, CallerScope> = {
  adminE1: who("adminE1", "e1", "b1", ["admin"]),
  hrE1: who("hrE1", "e1", "b1", ["hr"]),
  payE1: who("payE1", "e1", "b1", ["payroll"]),
  bhE1: who("bhE1", "e1", "b1", ["branch_head"]),
  phE1: who("phE1", "e1", "b1", ["payroll_head"], true),
  // a super admin who also holds the manager role: the manager stage is not hidden from a true override
  rootMgr: who("rootMgr", "emp-ho", "b1", ["manager", "super_admin"], true),
};
Object.assign(D.people, people, subjects);
const world = {
  employees: { e1: "b1", e2: "b2" },
  users: { userE1: { employeeId: "e1", branchId: "b1" }, userE2: { employeeId: "e2", branchId: "b2" } },
  costCentres: { c1: "b1", c2: "b2" },
  approvers: { e1: "m1", e2: "m2" } as Record<string, string | null>,
};

type Routes = Record<string, unknown> | ((user: string) => Record<string, unknown>);
async function idsFor(adapter: ApprovalAdapter, user: string, routes: Routes): Promise<string[]> {
  useDirectory({ ...people, ...subjects }, world);
  const { ctx } = fakeCtx(typeof routes === "function" ? routes(user) : routes, user);
  try {
    return (await adapter.list(ctx)).map((i) => i.id).sort();
  } catch (e: any) {
    if (e?.status === 403) return []; // the module's own role gate said no, which is the same as an empty queue
    throw e;
  }
}
/** expected: user -> ids that user may see; every user NOT listed must see nothing. */
async function table(adapter: ApprovalAdapter, routes: Routes, expected: Record<string, string[]>, subject: Record<string, string[]> = {}) {
  for (const user of Object.keys(people)) {
    const want = [...(expected[user] ?? [])].sort();
    expect({ user, ids: await idsFor(adapter, user, routes) }, `${adapter.kind} as ${user}`).toEqual({ user, ids: want });
  }
  // people who are the employee / uploader of some rows: their own rows are never theirs to decide
  for (const [user, ids] of Object.entries(subject)) {
    expect({ user, ids: await idsFor(adapter, user, routes) }, `${adapter.kind} as ${user} (subject of a row)`).toEqual({ user, ids: [...ids].sort() });
  }
}
const has = (user: string, ...r: string[]) => r.some((x) => rolesOf(user).includes(x));
const gate = (user: string, roles: string[], payload: unknown) => (has(user, ...roles) ? payload : undefined);

// ── payroll ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe("payroll adapters: only the responsible branch / org-wide person sees the row", () => {
  it("salary increment: HR/admin validate own branch, payroll head approves any, own increment excluded, admin is no wildcard", async () => {
    const rows = [
      { id: "i1", employee_id: "e1", status: "submitted", proposed_ctc: 1, created_at: "2026-10-01" },
      { id: "i2", employee_id: "e2", status: "submitted", proposed_ctc: 1, created_at: "2026-10-01" },
      { id: "i3", employee_id: "e1", status: "submitted", proposed_ctc: 1, created_at: "2026-10-01", source: "legacy" }, // db_bill history: hidden
    ];
    await table(salaryIncrementAdapter, (u) => ({ "GET /api/salary-increment/": gate(u, ["admin", "hr", "payroll_head", "super_admin"], { data: rows }) }), {
      hr1: ["i1"], hr2: ["i2"], admin1: ["i1"], admin2: ["i2"], bhAdmin1: ["i1"], ph: ["i1", "i2"], root: ["i1", "i2"],
    }, { phE1: ["i2"], hrE1: [], adminE1: [] });
    // admin only ever gets the HR-validate step, never the Payroll Head approve step
    useDirectory({ ...people, ...subjects }, world);
    const { ctx } = fakeCtx({ "GET /api/salary-increment/": { data: rows } }, "admin1");
    expect((await salaryIncrementAdapter.list(ctx))[0].meta?.action).toBe("hr_validate");
  });

  it("salary revision: payroll head / super admin only (module gate); own revision excluded", async () => {
    const rows = [{ id: 1, employee_id: "e1", status: "pending" }, { id: 2, employee_id: "e2", status: "pending" }];
    await table(salaryRevisionAdapter, (u) => ({ "GET /api/salary-revision/": gate(u, ["payroll_head", "super_admin"], { data: rows }) }), {
      ph: ["1", "2"], root: ["1", "2"],
    }, { phE1: ["2"] });
  });

  it("salary dispute: WFM stage by branch, payroll-head stage org-wide, own dispute excluded", async () => {
    const wfm = [{ id: "d1", employee_id: "e1", status: "pending_wfm" }, { id: "d2", employee_id: "e2", status: "pending_wfm" }];
    const phq = [{ id: "d3", employee_id: "e1", status: "pending_payroll_head" }, { id: "d4", employee_id: "e2", status: "pending_payroll_head" }];
    await table(salaryDisputeAdapter, (u) => ({
      "GET /api/salary-disputes/queue/wfm": gate(u, ["wfm", "payroll_hr", "payroll", "super_admin"], { data: wfm }),
      "GET /api/salary-disputes/queue/payroll-head": gate(u, ["payroll_head", "super_admin"], { data: phq }),
    }), {
      wfm1: ["d1"], wfm2: ["d2"], pay1: ["d1"], pay2: ["d2"], ph: ["d3", "d4"], root: ["d1", "d2", "d3", "d4"],
    }, { payE1: [], phE1: ["d4"] });
  });

  it("payroll sign-off: finance / payroll head / super admin (all org-wide) at stage 1, only the CEO (and super admin) at stage 2", async () => {
    const run = [{ id: "r1", run_month: "2026-09", status: "processing", finance_approved_at: null, ceo_acknowledged_at: null }];
    await table(payrollSignoffAdapter, { "GET /api/payroll/signoff/runs": { data: run } }, { fin: ["r1"], ph: ["r1"], root: ["r1"] }, { phE1: ["r1"] });
    const approved = [{ id: "r2", run_month: "2026-09", status: "processing", finance_approved_at: "2026-10-01", ceo_acknowledged_at: null }];
    const r = { "GET /api/payroll/signoff/runs": { data: approved }, "GET /api/payroll/signoff/runs/r2/status": { data: { ceo_required: true } } };
    await table(payrollSignoffAdapter, r, { ceo: ["r2"], root: ["r2"] });
  });

  it("salary advance: admin / payroll see own branch, finance / payroll head org-wide, own advance excluded", async () => {
    const rows = [
      { id: "a1", employee_id: "e1", status: "pending", amount: 1 }, { id: "a2", employee_id: "e2", status: "pending", amount: 1 },
      { id: "a3", employee_id: "e1", status: "pending", amount: 1, legacy_loan_id: "55" }, // imported from the legacy system: hidden
    ];
    await table(advancesAdapter, { "GET /api/payroll/advances": { data: rows } }, {
      admin1: ["a1"], admin2: ["a2"], bhAdmin1: ["a1"], pay1: ["a1"], pay2: ["a2"], fin: ["a1", "a2"], ph: ["a1", "a2"], root: ["a1", "a2"],
    }, { adminE1: [], payE1: [], phE1: ["a2"] });
  });

  it("loans: finance head / payroll head org-wide, admin own branch, own loan excluded", async () => {
    const rows = [
      { id: "l1", employee_id: "e1", status: "pending_approval", amount: 1, created_by: "someone" },
      { id: "l2", employee_id: "e2", status: "pending_approval", amount: 1, created_by: "someone" },
      { id: "l3", employee_id: "e1", status: "pending_approval", amount: 1, created_by: "admin1" },
      { id: "l4", employee_id: "e1", status: "pending_approval", amount: 1, created_by: "someone", legacy_loan_id: "L-9" }, // legacy import: hidden
    ];
    await table(loansAdapter, { "GET /api/payroll/loans/": { data: rows } }, {
      admin1: ["l1"], admin2: ["l2"], bhAdmin1: ["l1", "l3"], fh: ["l1", "l2", "l3"], ph: ["l1", "l2", "l3"], root: ["l1", "l2", "l3"],
    }, { adminE1: [], phE1: ["l2"] });
  });

  it("reimbursements: manager stage only for the reporting manager, branch-head stage only for the claim's own branch", async () => {
    const queue = (u: string) => ({
      // module: manager queue = the caller's own reportees (only mgr1 manages e1)
      "GET /api/payroll/reimbursements/manager-queue": { data: u === "mgr1" ? [{ id: "c1", employee_id: "e1", status: "submitted", branch_id: "b1" }] : [] },
      // worst case: a branch head with an assignment row in the other branch gets BOTH branches' manager-approved claims
      "GET /api/payroll/reimbursements/branch-head-queue": gate(u, ["branch_head", "super_admin"], {
        data: [
          { id: "c2", employee_id: "e1", status: "manager_approved", branch_id: "b1" },
          { id: "c3", employee_id: "e2", status: "manager_approved", branch_id: "b2" },
        ],
      }),
    });
    // root (super_admin without branch_head) is able to open the queue for every branch but is not the designated branch head
    await table(reimbursementsAdapter, queue, { mgr1: ["c1"], bh1: ["c2"], bh2: ["c3"], bhAdmin1: ["c2"], root: [] }, { bhE1: [] });
  });

  it("incentive batch: admin own branch, finance org-wide, the uploader never", async () => {
    const batches = [
      { id: "b1", status: "pending_approval", branch_id: "b1", uploaded_by: "up", incentive_name: "x", pay_month: "2026-09" },
      { id: "b2", status: "pending_approval", branch_id: "b2", uploaded_by: "up", incentive_name: "x", pay_month: "2026-09" },
      { id: "b3", status: "pending_approval", branch_id: "b1", uploaded_by: "admin1", incentive_name: "x", pay_month: "2026-09" },
    ];
    await table(incentivesAdapter, (u) => ({
      "GET /api/incentives/batches": gate(u, ["admin", "finance", "super_admin"], { data: batches }),
      "GET /api/incentives/approvals/pending": { data: [] },
    }), { admin1: ["b1"], admin2: ["b2"], bhAdmin1: ["b1", "b3"], fin: ["b1", "b2", "b3"], root: ["b1", "b2", "b3"] });
  });

  it("incentive approval chain: the step's role, in the batch's own branch only", async () => {
    const chain = [
      { id: "k1", status: "approval_chain_active", branch_id: "b1", uploaded_by: "up", pending_step: 1, required_role: "branch_head" },
      { id: "k2", status: "approval_chain_active", branch_id: "b2", uploaded_by: "up", pending_step: 1, required_role: "branch_head" },
    ];
    // module: the pending list returns the batches whose pending step's role is the caller's FIRST role, both branches (assignment-widened)
    await table(incentivesAdapter, (u) => ({
      "GET /api/incentives/batches": undefined,
      "GET /api/incentives/approvals/pending": { data: rolesOf(u)[0] === "branch_head" ? chain : [] },
    }), { bh1: ["k1"], bh2: ["k2"], bhAdmin1: ["k1"] });
  });

  it("bulk upload: branch stage only for that branch's head (a null-branch batch is org-wide only), payroll stage only for payroll head, uploader never", async () => {
    const mk = (id: string, o: any = {}) => ({ id, upload_batch_no: id, upload_type_code: "INCENTIVE_BULK", approval_status: "pending_branch_head", branch_id: "b1", uploaded_by: "up", ...o });
    const rows = [mk("u1"), mk("u2", { branch_id: "b2" }), mk("u3", { branch_id: null }), mk("u4", { approval_status: "pending_payroll_head" }), mk("u5", { uploaded_by: "bh1" })];
    await table(bulkUploadAdapter, { "GET /api/bulk-upload/approvals/pending": { data: rows } }, {
      bh1: ["u1"], bh2: ["u2"], bhAdmin1: ["u1", "u5"], ph: ["u4"], root: ["u1", "u2", "u3", "u4", "u5"],
    }, { phE1: ["u4"] });
  });

  it("payroll NOC: payroll head / super admin only", async () => {
    const rows = [{ id: "n1", upload_status: "uploaded", employee_id: "e1" }, { id: "n2", upload_status: "uploaded", employee_id: "e2" }];
    await table(nocAdapter, { "GET /api/payroll/noc/": { data: rows } }, { ph: ["n1", "n2"], root: ["n1", "n2"] });
  });
});

// ── finance ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe("finance adapters: branch-bound stages by the row's own branch, HO stages org-wide only", () => {
  it("GRN: branch head stage only in own branch (even if the finance scope says all), accounts head / finance head stages org-wide", async () => {
    const g = (id: string, status: string, branch_id: string) => ({ id, status, branch_id, submitted_by: "maker", amount: 1 });
    const byStatus: Record<string, any[]> = {
      submitted: [g("g1", "submitted", "b1"), g("g2", "submitted", "b2"), { ...g("g9", "submitted", "b1"), legacy_raised_by_name: "Old" }],
      branch_head_approved: [g("g3", "branch_head_approved", "b1")],
      accounts_head_approved: [g("g4", "accounts_head_approved", "b2")],
    };
    await table(grnAdapter, { "GET /api/finance/grns": (o: any) => ({ data: byStatus[o.query.status] ?? [] }) }, {
      bh1: ["g1"], bh2: ["g2"], bhAdmin1: ["g1"], ah: ["g3"], fh: ["g4"], root: [] /* super_admin holds no stage role */,
    });
  });

  it("branch budget: branch head stage in own branch only, finance head stage for finance head only", async () => {
    const inbox = { data: [
      { id: "bud1", status: "submitted", branch_id: "b1", branch_name: "Noida", period_code: "2026-10", updated_at: "2026-10-01" },
      { id: "bud2", status: "submitted", branch_id: "b2", branch_name: "Pune", period_code: "2026-10", updated_at: "2026-10-01" },
      { id: "bud3", status: "branch_head_approved", branch_id: "b1", branch_name: "Noida", period_code: "2026-10", updated_at: "2026-10-01" },
    ] };
    const detail = (id: string, status: string) => ({ data: { id, status, submitted_by: "maker", lines: [] } });
    const routes = {
      "GET /api/finance/pnl/budgets/pending-my-review": inbox,
      "GET /api/finance/pnl/budgets/bud1": detail("bud1", "submitted"),
      "GET /api/finance/pnl/budgets/bud2": detail("bud2", "submitted"),
      "GET /api/finance/pnl/budgets/bud3": detail("bud3", "branch_head_approved"),
    };
    await table(branchBudgetAdapter, routes, { bh1: ["bud1"], bh2: ["bud2"], bhAdmin1: ["bud1"], fh: ["bud3"], root: ["bud1", "bud2", "bud3"] });
  });

  it("budget top-up: branch head own branch, finance head stage 2", async () => {
    const rows = [
      { id: "t1", status: "submitted", branch_id: "b1", requested_by: "x" },
      { id: "t2", status: "submitted", branch_id: "b2", requested_by: "x" },
      { id: "t3", status: "branch_head_approved", branch_id: "b1", requested_by: "x" },
    ];
    await table(budgetTopupAdapter, { "GET /api/finance/pnl/budget-topups": { data: rows } }, {
      bh1: ["t1"], bh2: ["t2"], bhAdmin1: ["t1"], fh: ["t3"], root: [] /* super_admin holds no stage role */,
    });
  });

  it("P&L manual adjustment: finance head / accounts head / super admin only", async () => {
    const rows = [{ id: "p1", status: "pending", created_by: "x", branch_name: "Noida" }, { id: "p2", status: "pending", created_by: "x", branch_name: "Pune" }];
    await table(pnlManualAdjustmentAdapter, { "GET /api/finance/pnl/manual-adjustments": { data: rows } }, {
      fh: ["p1", "p2"], ah: ["p1", "p2"], root: ["p1", "p2"],
    });
  });

  it("revenue forecast: finance head / super admin only", async () => {
    const period = periodWindow()[1];
    const list = { data: { rows: [{ forecastId: "f1", status: "submitted", financeHeadStatus: "pending", costCentreCode: "CC1" }] } };
    const routes = {
      "GET /api/finance/revenue-forecasts": (o: any) => (o.query.period === period ? list : { data: { rows: [] } }),
      "GET /api/finance/revenue-forecasts/f1": { data: { id: "f1", status: "submitted", finance_head_status: "pending", submitted_by: "x", forecast_amount: 1, lines: [] } },
    };
    await table(revenueForecastAdapter, routes, { fh: ["f1"], root: ["f1"] });
  });

  it("journal voucher: only people the module marks canApprove (finance head / ceo / super admin, never the maker)", async () => {
    const approvers = ["finance_head", "ceo", "super_admin"];
    await table(journalVoucherAdapter, (u) => ({
      "GET /api/finance/journal-vouchers": { data: { rows: [{ id: "j1", status: "pending_approval", totalAmount: 1, permissions: { canApprove: has(u, ...approvers) } }] } },
      "GET /api/finance/journal-vouchers/j1": { data: { lines: [] } },
    }), { fh: ["j1"], ceo: ["j1"], root: ["j1"] });
  });

  it("payment voucher (CEO gate): ceo / super admin only", async () => {
    const rows = [{ id: "pv1", status: "raised", raised_by: "x" }];
    await table(paymentVoucherAdapter, { "GET /api/finance/payment-vouchers": { data: rows }, "GET /api/finance/payment-vouchers/pv1": { data: {} } }, { ceo: ["pv1"], root: ["pv1"] });
  });

  it("vendor approval: finance head / super admin only; vendor bank change: finance head / accounts head only (not super admin)", async () => {
    await table(vendorApprovalAdapter, { "GET /api/finance/vendor-approval/requests": { data: [{ id: "r1", status: "pending", raised_by: "x", payload: { vendor_name: "A" } }] } }, { fh: ["r1"], root: ["r1"] });
    await table(vendorBankChangeAdapter, { "GET /api/finance/vendor-bank/requests": { data: [{ id: "v1", requested_by: "x", vendor_name: "A" }] } }, { fh: ["v1"], ah: ["v1"] });
  });

  it("cost centre: admin only in own branch (queue and decide routes have no branch check), finance head / accounts head / super admin org-wide", async () => {
    const rows = [
      { id: "cc1", status: "pending_l1", branch_id: "b1", created_by: "x" },
      { id: "cc2", status: "pending_l1", branch_id: "b2", created_by: "x" },
      { id: "cc3", status: "pending_l2", branch_id: "b1", created_by: "x" },
      { id: "cc4", status: "pending_l2", branch_id: "b2", created_by: "x" },
    ];
    await table(costCentreAdapter, { "GET /api/finance/cost-centres/approval-queue": { data: rows } }, {
      admin1: ["cc1", "cc3"], admin2: ["cc2", "cc4"], bhAdmin1: ["cc1", "cc3"], fh: ["cc1", "cc2"], ah: ["cc1", "cc2"], root: ["cc1", "cc2", "cc3", "cc4"],
    });
  });

  it("client invoice + credit note: admin only for own-branch cost centres, finance roles org-wide, the maker never", async () => {
    const inv = [
      { id: "p1", invoice_status: "proforma", cost_centre_id: "c1", created_by: "x" },
      { id: "p2", invoice_status: "proforma", cost_centre_id: "c2", created_by: "x" },
      { id: "p3", invoice_status: "proforma", cost_centre_id: "c1", created_by: "admin1" },
    ];
    const gates = ["admin", "finance", "finance_head", "accounts_head", "super_admin"];
    await table(clientInvoiceAdapter, (u) => ({ "GET /api/client-billing/proformas": gate(u, gates, { data: inv }) }), {
      admin1: ["p1"], admin2: ["p2"], bhAdmin1: ["p1", "p3"], fin: ["p1", "p2", "p3"], fh: ["p1", "p2", "p3"], ah: ["p1", "p2", "p3"], root: ["p1", "p2", "p3"],
    });
    const cn = [
      { id: "n1", credit_status: "draft", cost_centre_id: "c1", created_by: "x" },
      { id: "n2", credit_status: "draft", cost_centre_id: "c2", created_by: "x" },
    ];
    await table(clientCreditNoteAdapter, (u) => ({ "GET /api/client-billing/credit-notes": gate(u, gates, { data: cn }) }), {
      admin1: ["n1"], admin2: ["n2"], bhAdmin1: ["n1"], fin: ["n1", "n2"], fh: ["n1", "n2"], ah: ["n1", "n2"], root: ["n1", "n2"],
    });
  });

  it("imprest allocation: finance head / super admin only", async () => {
    const rows = [{ id: "ia1", status: "submitted" }];
    await table(imprestAllocationAdapter, {
      "GET /api/finance/imprest/allocations": (o: any) => ({ data: o.query.status === "submitted" ? rows : [] }),
    }, { fh: ["ia1"], root: ["ia1"] });
  });
});

// ── admin / engagement / privacy ─────────────────────────────────────────────────────────────────────────────────
describe("admin adapters: requester / author branch decides who sees the row", () => {
  it("workflow: role steps by the requester's branch, manager steps only for the effective approver", async () => {
    const rows = [
      { id: "w1", status: "pending", requested_by: "userE1", approver_role: "hr", workflow_code: "X" },
      { id: "w2", status: "pending", requested_by: "userE2", approver_role: "hr", workflow_code: "X" },
      { id: "w3", status: "pending", requested_by: "userE1", approver_role: "manager", workflow_code: "X" },
      { id: "w4", status: "pending", requested_by: "userE2", approver_role: "manager", workflow_code: "X" },
      { id: "w5", status: "pending", requested_by: "hr1", approver_role: "hr", workflow_code: "X" },
      { id: "w6", status: "pending", requested_by: "userE1", approver_role: "admin", workflow_code: "X" },
      { id: "w7", status: "pending", requested_by: "userE2", approver_role: "admin", workflow_code: "X" },
    ];
    // module: the inbox is the steps owned by the caller's derived approver role (admin > hr > manager > team_leader), requester scope aside
    const inbox = (u: string) => {
      const mine = rolesOf(u);
      const role = ["admin", "hr", "manager", "team_leader"].find((r) => mine.includes(r));
      return { "GET /api/workflow/requests/pending": role ? { data: rows.filter((r) => r.approver_role === role) } : undefined };
    };
    await table(workflowAdapter, inbox, {
      hr1: ["w1"], hr2: ["w2"], admin1: ["w6"], admin2: ["w7"], bhAdmin1: ["w6"], mgr1: ["w3"], mgr2: ["w4"],
    }, { rootMgr: [] /* super_admin who also holds `manager` but is nobody's reporting manager: not designated */ });
  });

  it("company post: admin moderates own-branch authors only, hr head / super admin all, never the author", async () => {
    const post = (id: string, author: string) => ({ id, status: "pending_approval", active_status: 1, author_user_id: author, author_name: "A" });
    const rows = [post("cp1", "userE1"), post("cp2", "userE2"), post("cp3", "admin1")];
    const routes = (u: string) => ({ "GET /api/engagement/company-posts/approvals": gate(u, ["admin", "hr_head", "super_admin"], { posts: rows }) });
    await table(companyPostAdapter, routes, {
      admin1: ["cp1"], admin2: ["cp2"], bhAdmin1: ["cp1", "cp3"], hrHead: ["cp1", "cp2", "cp3"], root: ["cp1", "cp2", "cp3"],
    });
  });

  it("exit pass: assigned head or own-branch admin / branch admin; only super admin / it head are global; never the requester", async () => {
    const bhRows = [
      { id: "x1", status: "pending_branch_head", branch_id: "b1", branch_head_employee_id: "emp-bh1", requestor_employee_id: "e1" },
      { id: "x2", status: "pending_branch_head", branch_id: "b2", branch_head_employee_id: "emp-bh2", requestor_employee_id: "e2" },
      { id: "x3", status: "pending_branch_head", branch_id: "b1", branch_head_employee_id: null, requestor_employee_id: "e1" }, // no head assigned
    ];
    const adRows = [
      { id: "y1", status: "pending_admin_approval", branch_id: "b1", requestor_employee_id: "e1" },
      { id: "y2", status: "pending_admin_approval", branch_id: "b2", requestor_employee_id: "e2" },
    ];
    await table(exitPassAdapter, {
      "GET /api/exit-passes/pending/branch-head": { data: bhRows },
      "GET /api/exit-passes/pending/admin": { data: adRows },
    }, {
      // stage 1: the assigned head (an own-branch admin only when none is assigned); stage 2: it_head, own-branch admin, branch_admin
      bh1: ["x1"], bh2: ["x2"], admin1: ["x3", "y1"], admin2: ["y2"], bhAdmin1: ["x3", "y1"], branchAdmin1: ["y1"],
      itHead: ["y1", "y2"], root: [],
    }, { adminE1: [] /* adminE1 IS the requester e1; the b2 passes are not their branch */ });
  });

  it("visitor: assigned host, own-branch admin / branch roles; only super admin is global", async () => {
    const v = (id: string, branch_id: string, host: string) => ({ id, status: "pending_approval", branch_id, host_employee_id: host, visitor_name: "V" });
    const rows = [v("v1", "b1", "emp-hostA"), v("v2", "b2", "emp-other"), v("v3", "b1", null as any)];
    // admin / super_admin are able to decide any visit but are designated only for an un-hosted visit of their own branch (admin)
    await table(visitorAdapter, { "GET /api/visitor/visits": { data: rows } }, {
      hostA: ["v1"], admin1: ["v3"], admin2: [], bhAdmin1: ["v1", "v3"], bh1: ["v1", "v3"], bh2: ["v2"], secHead1: ["v1", "v3"], root: [],
    });
  });

  it("page access request: admin only for own-branch requesters (super admin all), never their own", async () => {
    const rows = [
      { id: "ar1", status: "pending", user_id: "userE1", user_email: "a", page_code: "P" },
      { id: "ar2", status: "pending", user_id: "userE2", user_email: "b", page_code: "P" },
      { id: "ar3", status: "pending", user_id: "ghost", user_email: "c", page_code: "P" }, // no employee record -> no branch
      { id: "ar4", status: "pending", user_id: "admin1", user_email: "d", page_code: "P" },
    ];
    await table(accessRequestAdapter, (u) => ({ "GET /api/access/requests": gate(u, ["admin", "super_admin"], { data: rows }) }), {
      admin1: ["ar1"], admin2: ["ar2"], bhAdmin1: ["ar1", "ar4"], root: ["ar1", "ar2", "ar3", "ar4"],
    });
  });

  it("benefit claim: hr / admin own branch, never their own claim, non-reviewers get nothing", async () => {
    const rows = [
      { id: "bc1", status: "submitted", employee_id: "e1", claim_type: "medical" },
      { id: "bc2", status: "submitted", employee_id: "e2", claim_type: "medical" },
    ];
    await table(benefitsClaimAdapter, (u) => ({
      "GET /api/benefits/claims": has(u, "admin", "hr", "super_admin") ? { data: rows, stats: {} } : { data: [] },
    }), { hr1: ["bc1"], hr2: ["bc2"], admin1: ["bc1"], admin2: ["bc2"], bhAdmin1: ["bc1"], root: ["bc1", "bc2"] }, { hrE1: [], adminE1: [] });
  });

  it("DPDP withdrawal: hr / admin see own-branch requesters (admin is NOT the DPO), real dpo and org-wide see all, never the requester", async () => {
    const rows = [
      { id: "dw1", status: "submitted", requester_id: "userE1", requester_name: "A" },
      { id: "dw2", status: "submitted", requester_id: "userE2", requester_name: "B" },
      { id: "dw3", status: "in_review", requester_id: "hr1", requester_name: "H" },
    ];
    await table(dpdpWithdrawalAdapter, (u) => ({
      "GET /api/privacy/dpdp-withdrawal": (o: any) =>
        has(u, "hr", "admin", "dpo", "compliance", "super_admin") ? { data: rows.filter((r) => r.status === o.query.status) } : undefined,
    }), {
      hr1: ["dw1"], hr2: ["dw2"], admin1: ["dw1", "dw3"], admin2: ["dw2"], bhAdmin1: ["dw1", "dw3"],
      dpo: ["dw1", "dw2", "dw3"], root: ["dw1", "dw2", "dw3"],
    });
  });
});
