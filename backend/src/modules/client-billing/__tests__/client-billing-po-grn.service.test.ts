import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection, query: vi.fn() } }));

let svc: typeof import("../client-billing-po-grn.service.js")["clientBillingPoGrnService"];
beforeAll(async () => { ({ clientBillingPoGrnService: svc } = await import("../client-billing-po-grn.service.js")); });
beforeEach(() => { getConnection.mockResolvedValue(conn); for (const f of Object.values(conn)) f.mockReset(); });

describe("Approve PO / ADD GRN", () => {
  it("approves the PO on an invoice that has one, logs po_approved", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "i", invoice_status: "approved", is_migrated: 0, po_numbers: "PO-77", po_approved: 0 }], []]).mockResolvedValue([{}, []]);
    await expect(svc.approvePo("i", "u")).resolves.toEqual({ id: "i", poApproved: true });
    expect(String(conn.execute.mock.calls[2][0])).toMatch(/'po_approved'/);
  });
  it("refuses Approve PO without a PO, and on a voided invoice", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "i", invoice_status: "approved", is_migrated: 0, po_numbers: null, po_approved: 0 }], []]);
    await expect(svc.approvePo("i", "u")).rejects.toThrow(/no PO number/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[{ id: "i", invoice_status: "rejected", is_migrated: 0, po_numbers: "P", po_approved: 0 }], []]);
    await expect(svc.approvePo("i", "u")).rejects.toThrow(/rejected/);
  });
  it("adds GRN to an approved invoice and logs grn_added", async () => {
    conn.execute.mockResolvedValueOnce([[{ id: "i", invoice_status: "approved", is_migrated: 0 }], []]).mockResolvedValue([{}, []]);
    await expect(svc.addGrn("i", { grnNo: "GRN-1", grnDate: "2026-10-14", userId: "u" })).resolves.toEqual({ id: "i", grnNo: "GRN-1", grnDate: "2026-10-14", changed: true });
    expect(conn.execute.mock.calls[1][1]).toEqual(["GRN-1", "2026-10-14", "i"]);
    expect(conn.execute.mock.calls[2][1]).toEqual([expect.any(String), "i", "grn_added", "u", "GRN-1 (2026-10-14)"]);
  });
  it("M6: replacing an existing GRN needs a reason and logs before -> after as grn_changed", async () => {
    const withGrn = { id: "i", invoice_status: "approved", is_migrated: 0, grn_no: "GRN-OLD", grn_date: "2026-10-01" };
    conn.execute.mockResolvedValueOnce([[withGrn], []]);
    await expect(svc.addGrn("i", { grnNo: "GRN-NEW", grnDate: "2026-10-14", userId: "u" })).rejects.toThrow(/already has GRN GRN-OLD \(2026-10-01\).*reason/);
    expect(conn.execute).toHaveBeenCalledTimes(1);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[withGrn], []]).mockResolvedValue([{}, []]);
    await svc.addGrn("i", { grnNo: "GRN-NEW", grnDate: "2026-10-14", reason: "client reissued GRN", userId: "u" });
    const log = conn.execute.mock.calls[2];
    expect(log[1]).toEqual([expect.any(String), "i", "grn_changed", "u", "GRN-OLD (2026-10-01) → GRN-NEW (2026-10-14): client reissued GRN"]);
  });
});
