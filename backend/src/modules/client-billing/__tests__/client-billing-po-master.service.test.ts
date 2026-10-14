import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const { getConnection, query } = vi.hoisted(() => ({ getConnection: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection, query } }));

let mod: typeof import("../client-billing-po-master.service.js");
beforeAll(async () => { mod = await import("../client-billing-po-master.service.js"); });
beforeEach(() => {
  getConnection.mockReset(); getConnection.mockResolvedValue(conn); query.mockReset();
  for (const f of Object.values(conn)) f.mockReset();
});

const doc = { path: "uploads/client-po-documents/x", name: "PO-77.pdf", mime: "application/pdf" };
const base = { costCentreId: "cc", poNumber: " AB/77-x ", periodFrom: "2026-04-01", periodTo: "2027-03-31", userId: "u", attachment: doc,
  lines: [{ particulars: "Inbound seats", qty: 10, rate: 25000 }, { particulars: "Setup", qty: 1, rate: 15000.5 }] };

describe("PO number", () => {
  it("accepts letters, digits, symbols; trims; refuses comma, blank, > 60", () => {
    expect(mod.normalisePoNumber("  4500123  ")).toBe("4500123");
    expect(mod.normalisePoNumber("ABCDEF")).toBe("ABCDEF");
    expect(mod.normalisePoNumber("PO/MAS 26-27/0007")).toBe("PO/MAS 26-27/0007");
    expect(() => mod.normalisePoNumber("A,B")).toThrow(/comma/);
    expect(() => mod.normalisePoNumber("  ")).toThrow(/required/);
    expect(() => mod.normalisePoNumber("x".repeat(61))).toThrow(/60/);
  });
});

describe("PO particulars", () => {
  it("amount = sum of qty x rate in paise; validates each line", () => {
    const l = mod.normaliseLines(base.lines);
    expect(l.reduce((s, x) => s + x.amountPaise, 0)).toBe(26500050);
    expect(() => mod.normaliseLines([])).toThrow(/at least one/);
    expect(() => mod.normaliseLines([{ particulars: "", qty: 1, rate: 1 }])).toThrow(/description/);
    expect(() => mod.normaliseLines([{ particulars: "a", qty: 0, rate: 1 }])).toThrow(/qty/);
    expect(() => mod.normaliseLines([{ particulars: "a", qty: 1, rate: -1 }])).toThrow(/rate/);
    expect(() => mod.normaliseLines([{ particulars: "a", qty: 1.005, rate: 1 }])).toThrow(/2 decimals/);
  });
});

describe("createPo", () => {
  it("requires the PO document, before touching the database", async () => {
    await expect(mod.clientPoMasterService.createPo({ ...base, attachment: null })).rejects.toThrow(/PDF or Word/);
    expect(getConnection).not.toHaveBeenCalled();
  });
  it("stores amount = balance = line total, the document, the lines and an audit row", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "cc" }], []]).mockResolvedValueOnce([[], []]).mockResolvedValue([{}, []]);
    const r = await mod.clientPoMasterService.createPo(base);
    expect(r).toMatchObject({ poNumber: "AB/77-x", amount: 265000.5, approvalStatus: "pending" });
    const insert = conn.execute.mock.calls[2];
    expect(String(insert[0])).toMatch(/'pending', 0, \?/);
    expect(insert[1]).toEqual([expect.any(String), "cc", "AB/77-x", "2026-04-01", "2027-03-31", 265000.5, 265000.5, doc.path, doc.name, doc.mime, null, "u", "u"]);
    const sql = conn.execute.mock.calls.map((c) => String(c[0]));
    expect(sql.filter((q) => q.includes("INSERT INTO client_po_line"))).toHaveLength(2);
    expect(sql.some((q) => q.includes("INSERT INTO client_po_audit"))).toBe(true);
  });
  it("refuses a duplicate number on the same cost centre (409)", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "cc" }], []]).mockResolvedValueOnce([[{ id: "po" }], []]);
    await expect(mod.clientPoMasterService.createPo(base)).rejects.toMatchObject({ statusCode: 409 });
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe("updatePo", () => {
  const po = { id: "po", cost_centre_id: "cc", po_number: "PO-1", period_from: "2026-04-01", period_to: "2027-03-31",
    total_amount: "100000.00", balance_amount: "40000.00", remarks: null, attachment_name: "a.pdf" };
  function script(draws: unknown[] = [{ bill_no: "09-150/26-27", invoice_date: "2026-08-10" }], quoting = 1) {
    conn.execute.mockResolvedValueOnce([[po], []]).mockResolvedValueOnce([draws, []]).mockResolvedValueOnce([[{ n: quoting }], []]).mockResolvedValue([{}, []]);
  }
  it("cannot go below what bills already drew (60,000 drawn)", async () => {
    script();
    await expect(mod.clientPoMasterService.updatePo({ id: "po", userId: "u", lines: [{ particulars: "x", qty: 1, rate: 50000 }] }))
      .rejects.toThrow(/below ₹60,000.00 already drawn/);
  });
  it("cannot move the period off a bill already drawn on it", async () => {
    script();
    await expect(mod.clientPoMasterService.updatePo({ id: "po", userId: "u", periodFrom: "2026-09-01" })).rejects.toThrow(/09-150\/26-27/);
  });
  it("cannot renumber a PO that invoices use", async () => {
    script([], 1);
    await expect(mod.clientPoMasterService.updatePo({ id: "po", userId: "u", poNumber: "PO-2" })).rejects.toThrow(/cannot change/);
  });
  it("raising the amount moves the balance by the same difference and is audited", async () => {
    script();
    const r = await mod.clientPoMasterService.updatePo({ id: "po", userId: "u", lines: [{ particulars: "x", qty: 2, rate: 75000 }] });
    expect(r.changed.join(" ")).toMatch(/amount: 1,00,000.00 → 1,50,000.00/);
    const upd = conn.execute.mock.calls.find((c) => String(c[0]).startsWith("UPDATE client_po_number"))!;
    expect(upd[1].slice(0, 5)).toEqual(["PO-1", "2026-04-01", "2027-03-31", 150000, 90000]);
    // An increase above the approved amount sends the PO back for approval, the editor as requester.
    expect(upd[1].slice(-3)).toEqual(["pending", "u", "po"]);
    expect(r.approvalStatus).toBe("pending");
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("INSERT INTO client_po_audit"))).toBe(true);
  });
  it("a decrease keeps an approved PO approved; bringing a pending increase back within the approved amount re-approves it", async () => {
    script();
    const r1 = await mod.clientPoMasterService.updatePo({ id: "po", userId: "u", lines: [{ particulars: "x", qty: 1, rate: 90000 }] });
    expect(r1.approvalStatus).toBe("approved");
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[{ ...po, total_amount: "150000.00", balance_amount: "90000.00", approval_status: "pending", approved_amount: "100000.00", approval_requested_by: "u" }], []])
      .mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ n: 0 }], []]).mockResolvedValue([{}, []]);
    const r2 = await mod.clientPoMasterService.updatePo({ id: "po", userId: "v", lines: [{ particulars: "x", qty: 1, rate: 100000 }] });
    expect(r2.approvalStatus).toBe("approved");
  });
  it("no change -> nothing written", async () => {
    script();
    const r = await mod.clientPoMasterService.updatePo({ id: "po", userId: "u", periodFrom: "2026-04-01" });
    expect(r.changed).toEqual([]);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).startsWith("UPDATE"))).toBe(false);
  });
});

describe("report", () => {
  it("status from period and balance; utilisation; branch-scoped callers fail closed", async () => {
    query.mockResolvedValue([[
      { id: "a", po_number: "A", period_from: "2026-04-01", period_to: "2027-03-31", total_amount: "100.00", balance_amount: "25.00", cost_centre_id: "cc", bill_count: 2, line_count: 1 },
      { id: "b", po_number: "B", period_from: "2025-04-01", period_to: "2026-03-31", total_amount: "100.00", balance_amount: "100.00", cost_centre_id: "cc" },
      { id: "c", po_number: "C", period_from: "2027-04-01", period_to: "2028-03-31", total_amount: "100.00", balance_amount: "100.00", cost_centre_id: "cc" },
      { id: "d", po_number: "D", period_from: "2026-04-01", period_to: "2027-03-31", total_amount: "100.00", balance_amount: "0.00", cost_centre_id: "cc" },
    ], []]);
    const r = await mod.clientPoMasterService.report({ today: "2026-10-14" });
    expect(r.map((x) => x.status)).toEqual(["active", "expired", "upcoming", "exhausted"]);
    expect(r[0]).toMatchObject({ drawn: 75, balance: 25, utilisation: 75, bills: 2 });
    await mod.clientPoMasterService.report({ branchIds: [] });
    expect(String(query.mock.calls.at(-1)![0])).toContain("1 = 0");
  });
});

describe("PO approval (maker-checker)", () => {
  const pending = { id: "po", po_number: "PO-9", total_amount: "5000.00", approval_status: "pending", approved_amount: "0.00", approval_requested_by: "maker", created_by: "maker" };
  it("the creator / editor cannot approve or reject (403)", async () => {
    conn.execute.mockResolvedValueOnce([[pending], []]);
    await expect(mod.clientPoMasterService.decidePo("po", "approve", "maker")).rejects.toMatchObject({ statusCode: 403 });
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });
  it("another user approves: status approved, approved_amount = amount, audited", async () => {
    conn.execute.mockResolvedValueOnce([[pending], []]).mockResolvedValue([{}, []]);
    await expect(mod.clientPoMasterService.decidePo("po", "approve", "checker")).resolves.toEqual({ id: "po", approvalStatus: "approved" });
    const upd = conn.execute.mock.calls[1];
    expect(String(upd[0])).toMatch(/approved_amount = IF\(\? = 'approved', total_amount, approved_amount\)/);
    expect(upd[1]).toEqual(["approved", "approved", "checker", null, "po"]);
    expect(conn.execute.mock.calls[2][1]).toEqual(expect.arrayContaining(["po", "approved", "checker"]));
  });
  it("reject needs a reason; only a pending PO can be decided", async () => {
    await expect(mod.clientPoMasterService.decidePo("po", "reject", "checker", "no")).rejects.toThrow(/at least 5/);
    conn.execute.mockResolvedValueOnce([[{ ...pending, approval_status: "approved" }], []]);
    await expect(mod.clientPoMasterService.decidePo("po", "approve", "checker")).rejects.toThrow(/only a pending PO/);
  });
  it("nextApprovalState: legacy rows (approved_amount NULL) count their amount as approved", () => {
    const legacy = { approval_status: "approved", approved_amount: null, total_amount: "1000.00" } as never;
    expect(mod.nextApprovalState(legacy, 100000, "e")).toMatchObject({ status: "approved" });
    expect(mod.nextApprovalState(legacy, 100001, "e")).toEqual({ status: "pending", requestedBy: "e" });
  });
});
