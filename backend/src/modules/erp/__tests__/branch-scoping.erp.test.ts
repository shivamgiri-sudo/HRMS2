import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** ERP expense claims + procurement: hr is limited to employees inside its branch; admin/finance stay org-wide. */
const { canViewEmployee, listExpenses, listProcurement, getExpense, getRequest, review, approve, hasRole, buildCond, resolveScope } = vi.hoisted(() => ({
  canViewEmployee: vi.fn(), listExpenses: vi.fn(async () => []), listProcurement: vi.fn(async () => []),
  getExpense: vi.fn(), getRequest: vi.fn(), review: vi.fn(async () => ({ id: "x" })), approve: vi.fn(async () => ({ id: "x" })),
  hasRole: vi.fn(async () => true),
  buildCond: vi.fn(),
  resolveScope: vi.fn(async () => ({ __scope: true })),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee, buildEmployeeScopeCondition: buildCond, resolveUserBusinessScope: resolveScope,
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole, getEmployeeForUser: vi.fn(async () => ({ id: "emp-me" })) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr", role: "hr", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../erp.service.js", () => ({
  vendorService: {}, contractService: {}, billingUnitService: {}, billingInvoiceService: {}, expensePolicyService: {},
  expenseService: { list: listExpenses, getById: getExpense, review, create: vi.fn() },
  procurementService: { list: listProcurement, getById: getRequest, approve, create: vi.fn() },
}));
vi.mock("../vendor-sync.service.js", () => ({ syncVendorsFromDbBill: vi.fn() }));
vi.mock("../../finance/vendor-approval.service.js", () => ({ vendorApprovalService: {} }));
vi.mock("../../finance/finance-access-scope.js", () => ({ getUserBranchId: vi.fn() }));

import { erpRouter } from "../erp.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/erp", erpRouter); return a; };

beforeEach(() => {
  [canViewEmployee, listExpenses, listProcurement, getExpense, getRequest, review, approve, buildCond].forEach((m) => m.mockClear());
  buildCond.mockReturnValue({ sql: "emp.branch_id = ?", params: ["b1"] });
  getExpense.mockResolvedValue({ id: "c1", employee_id: "emp-b" });
  getRequest.mockResolvedValue({ id: "r1", requested_by: "emp-b" });
});

describe("erp branch scoping", () => {
  it("hr expense + procurement lists receive the branch predicate", async () => {
    await request(app()).get("/erp/expenses");
    await request(app()).get("/erp/procurement");
    expect(listExpenses.mock.calls[0][1]).toEqual({ sql: "emp.branch_id = ?", params: ["b1"] });
    expect(listProcurement.mock.calls[0][1]).toEqual({ sql: "emp.branch_id = ?", params: ["b1"] });
  });
  it("org-wide callers (1=1) get no predicate at all", async () => {
    buildCond.mockReturnValue({ sql: "1=1", params: [] });
    await request(app()).get("/erp/expenses");
    await request(app()).get("/erp/procurement");
    expect(listExpenses.mock.calls[0][1]).toBeUndefined();
    expect(listProcurement.mock.calls[0][1]).toBeUndefined();
  });
  it("review / approve of an out-of-branch claim is refused and not executed", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).patch("/erp/expenses/c1/review").send({ action: "approved" })).status).toBe(403);
    expect((await request(app()).patch("/erp/procurement/r1/approve").send({ action: "approved" })).status).toBe(403);
    expect(review).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });
  it("in-branch review / approve still works", async () => {
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).patch("/erp/expenses/c1/review").send({ action: "approved" })).status).toBe(200);
    expect((await request(app()).patch("/erp/procurement/r1/approve").send({ action: "rejected" })).status).toBe(200);
  });
  it("submitting on behalf of an out-of-branch employee is refused", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post("/erp/expenses").send({ expense_date: "2026-10-01", amount: 5, employee_id: "emp-b" });
    expect(res.status).toBe(403);
  });
});
