import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = {
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const { getConnection, poolExecute } = vi.hoisted(() => ({ getConnection: vi.fn(), poolExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection, execute: poolExecute, query: vi.fn() } }));

let svc: typeof import("../client-billing-provision.service.js")["clientBillingProvisionService"];
beforeAll(async () => {
  ({ clientBillingProvisionService: svc } = await import("../client-billing-provision.service.js"));
});

beforeEach(() => {
  delete process.env.CLIENT_BILLING_PROVISION_REQUIRED;
  getConnection.mockResolvedValue(conn);
  for (const fn of Object.values(conn)) fn.mockReset();
  poolExecute.mockReset();
});

const scope = { invoiceId: "inv-1", costCentreId: "cc-1", financeYear: "2026-27", monthLabel: "Sep-26" };

describe("drawDownForInvoice", () => {
  it("refunds the invoice's previous draw, then draws the new total", async () => {
    conn.execute
      .mockResolvedValueOnce([[{ id: "d-old", provision_id: "p-1", amount_used: 500 }], []]) // old deductions
      .mockResolvedValueOnce([{}, []]) // refund balance
      .mockResolvedValueOnce([{}, []]) // delete old deduction
      .mockResolvedValueOnce([[{ id: "p-1", provision_balance: 1000000 }], []]) // approved provision
      .mockResolvedValue([{}, []]);
    const r = await svc.drawDownForInvoice(conn as never, { ...scope, amount: 778901 });
    expect(r).toEqual({ provisionId: "p-1", used: 778901 });
    const sqls = conn.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls[1]).toMatch(/provision_balance = provision_balance \+ \?/);
    expect(conn.execute.mock.calls[1][1]).toEqual([500, "p-1"]);
    expect(sqls[3]).toMatch(/provision_status = 'approved'/);
    expect(conn.execute.mock.calls[4][1]).toEqual([778901, "p-1"]);
    expect(sqls[5]).toMatch(/INSERT INTO client_provision_deduction/);
  });

  it("blocks when there is no approved provision for the month", async () => {
    conn.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]);
    await expect(svc.drawDownForInvoice(conn as never, { ...scope, amount: 10 }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/No approved provision/) });
  });

  it("blocks when the balance is short", async () => {
    conn.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: "p-1", provision_balance: 100 }], []]);
    await expect(svc.drawDownForInvoice(conn as never, { ...scope, amount: 101 }))
      .rejects.toThrow(/less than the invoice total/);
  });

  it("with CLIENT_BILLING_PROVISION_REQUIRED=false, draws what is there and does not block", async () => {
    process.env.CLIENT_BILLING_PROVISION_REQUIRED = "false";
    conn.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]);
    await expect(svc.drawDownForInvoice(conn as never, { ...scope, amount: 10 }))
      .resolves.toEqual({ provisionId: null, used: 0 });
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: "p-1", provision_balance: 100 }], []]).mockResolvedValue([{}, []]);
    await expect(svc.drawDownForInvoice(conn as never, { ...scope, amount: 150 }))
      .resolves.toEqual({ provisionId: "p-1", used: 100 });
  });
});

describe("provision maker-checker", () => {
  it("creates as pending and refuses a duplicate for the same cost centre + month", async () => {
    conn.execute
      .mockResolvedValueOnce([[{ id: "cc-1" }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValue([{}, []]);
    const r = await svc.createProvision({ ...scope, amount: 778901, remarks: "Sep", userId: "u-1" });
    expect(r.id).toEqual(expect.any(String));
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO client_provision"));
    expect(String(insert?.[0])).toMatch(/'pending'/);

    for (const fn of Object.values(conn)) fn.mockReset();
    conn.execute
      .mockResolvedValueOnce([[{ id: "cc-1" }], []])
      .mockResolvedValueOnce([[{ id: "p-1", provision_status: "approved" }], []]);
    await expect(svc.createProvision({ ...scope, amount: 1, userId: "u-1" }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("approves only a pending provision", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "p-1", provision_status: "approved" }], []]);
    await expect(svc.approveProvision("p-1", "u-2")).rejects.toThrow(/only a pending provision/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[{ id: "p-1", provision_status: "pending" }], []]).mockResolvedValue([{}, []]);
    await expect(svc.approveProvision("p-1", "u-2")).resolves.toEqual({ id: "p-1", provisionStatus: "approved" });
  });

  it("pending provision: edited in place, never below used; balance moves by the delta", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "p-1", provision_status: "pending", provision_amount: 1000, provision_balance: 400, remarks: null }], []]);
    await expect(svc.updateProvision({ id: "p-1", amount: 500, userId: "u" })).rejects.toThrow(/already used \(600\)/);
    conn.execute.mockReset();
    conn.execute
      .mockResolvedValueOnce([[{ id: "p-1", provision_status: "pending", provision_amount: 1000, provision_balance: 400, remarks: null }], []])
      .mockResolvedValue([{}, []]);
    const r = await svc.updateProvision({ id: "p-1", amount: 1200, userId: "u" });
    expect(r).toEqual({ id: "p-1", editPending: false, provisionAmount: 1200, provisionBalance: 600 });
    // balance assignment must come before amount (MySQL applies SET left to right)
    expect(String(conn.execute.mock.calls[1][0])).toMatch(/SET provision_balance = provision_balance \+ \(\? - provision_amount\), provision_amount = \?/);
  });

  it("approved provision: edit is parked as a request, amount unchanged until a second person approves", async () => {
    conn.execute
      .mockResolvedValueOnce([[{ id: "p-1", provision_status: "approved", provision_amount: 1000, provision_balance: 400, remarks: null, edit_requested_at: null }], []])
      .mockResolvedValue([{}, []]);
    const r = await svc.updateProvision({ id: "p-1", amount: 1500, remarks: "more seats", userId: "maker" });
    expect(r.editPending).toBe(true);
    expect(r.provisionAmount).toBe(1000);
    expect(String(conn.execute.mock.calls[1][0])).toMatch(/SET edit_amount = \?/);
    expect(conn.execute.mock.calls[1][1]).toEqual([1500, "more seats", "maker", "p-1"]);
  });

  it("edit request: requester cannot approve; another person's approval applies the amount", async () => {
    const pendingEdit = { id: "p-1", provision_status: "approved", provision_amount: 1000, provision_balance: 400, edit_amount: 1500, edit_remarks: "more seats", edit_requested_by: "maker", edit_requested_at: "2026-10-14" };
    conn.execute.mockResolvedValueOnce([[pendingEdit], []]);
    await expect(svc.decideProvisionEdit("p-1", "approve", "maker")).rejects.toMatchObject({ statusCode: 403 });
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[pendingEdit], []]).mockResolvedValue([{}, []]);
    await expect(svc.decideProvisionEdit("p-1", "approve", "checker")).resolves.toEqual({ id: "p-1", decision: "approve" });
    expect(conn.execute.mock.calls[1][1]).toEqual([1500, 1500, "more seats", "p-1"]);
    expect(String(conn.execute.mock.calls[2][0])).toMatch(/edit_amount = NULL/);
  });

  it("H5 maker-checker: the creator neither approves nor rejects (403); approve / reject are audited", async () => {
    const pending = { id: "p-1", provision_status: "pending", created_by: "maker" };
    conn.execute.mockResolvedValueOnce([[pending], []]);
    await expect(svc.approveProvision("p-1", "maker")).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/another approver must approve/) });
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[pending], []]);
    await expect(svc.rejectProvision("p-1", "wrong month", "maker")).rejects.toMatchObject({ statusCode: 403 });
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[pending], []]).mockResolvedValue([{}, []]);
    await svc.approveProvision("p-1", "checker");
    expect(conn.execute.mock.calls[2][1]).toEqual([expect.any(String), "p-1", "approved", "checker", null]);
  });

  it("H5: reject writes rejected_by / rejected_at and leaves approved_by alone", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "p-1", provision_status: "pending", created_by: "maker" }], []]).mockResolvedValue([{}, []]);
    await svc.rejectProvision("p-1", "wrong month", "checker");
    const upd = conn.execute.mock.calls[1];
    expect(String(upd[0])).toMatch(/rejected_by = \?, rejected_at = NOW\(\)/);
    expect(String(upd[0])).not.toMatch(/approved_by/);
    expect(upd[1]).toEqual(["wrong month", "checker", "p-1"]);
    expect(conn.execute.mock.calls[2][1]).toEqual([expect.any(String), "p-1", "rejected", "checker", "wrong month"]);
  });

  it("audits edits, edit requests and edit decisions", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "p-1", provision_status: "approved", provision_amount: 1000, provision_balance: 400, edit_requested_at: null }], []]).mockResolvedValue([{}, []]);
    await svc.updateProvision({ id: "p-1", amount: 1500, userId: "maker" });
    expect(conn.execute.mock.calls.find((c) => String(c[0]).includes("client_provision_audit"))?.[1]).toEqual([expect.any(String), "p-1", "edit_requested", "maker", "1000 → 1500"]);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[{ id: "p-1", provision_status: "approved", provision_amount: 1000, provision_balance: 400, edit_amount: 1500, edit_requested_by: "maker", edit_requested_at: "x" }], []]).mockResolvedValue([{}, []]);
    await svc.decideProvisionEdit("p-1", "decline", "checker");
    expect(conn.execute.mock.calls.find((c) => String(c[0]).includes("client_provision_audit"))?.[1]).toEqual([expect.any(String), "p-1", "edit_declined", "checker", "1000 → 1500"]);
  });

  it("upload: a branch-scoped uploader cannot create provisions for another branch's cost centre", async () => {
    getConnection.mockClear();
    poolExecute.mockResolvedValueOnce([[{ id: "cc-9", branch_id: "b-other" }], []]);
    const r = await svc.uploadProvisions([{ costCentreCode: "CC9", financeYear: "2026-27", monthLabel: "Sep-26", amount: 10 }], "u", ["b-mine"]);
    expect(r).toEqual([{ row: 1, costCentreCode: "CC9", ok: false, error: "cost centre CC9 is outside your branch" }]);
    expect(getConnection).not.toHaveBeenCalled();
  });
});
