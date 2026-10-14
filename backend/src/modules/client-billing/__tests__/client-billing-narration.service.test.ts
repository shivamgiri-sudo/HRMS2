import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const conn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

let svc: typeof import("../client-billing-narration.service.js")["clientBillingNarrationService"];
beforeAll(async () => { ({ clientBillingNarrationService: svc } = await import("../client-billing-narration.service.js")); });
beforeEach(() => { getConnection.mockResolvedValue(conn); for (const f of Object.values(conn)) f.mockReset(); });

const inv = (o = {}) => ({ id: "i", invoice_status: "approved", is_migrated: 0, description: "Oct billing", total_amount: "100000.00", gst_type: "Integrated", ...o });
const lines = [
  { particulars: "Seats", qty: 10, rate: 9000, lineType: "charge" as const },
  { particulars: "Training", qty: 1, rate: 12000, lineType: "charge" as const },
  { particulars: "SLA penalty", qty: 1, rate: 2000, lineType: "deduction" as const },
];

describe("updateNarration", () => {
  it("replaces particulars at any stage when they add up to the same total; numbers lines; audits", async () => {
    conn.execute.mockResolvedValueOnce([[inv()], []])
      .mockResolvedValueOnce([[], []]) // no successful submission
      .mockResolvedValueOnce([[], []]) // not exported to Tally
      .mockResolvedValueOnce([[{ line_type: "charge", particulars: "Seats", qty: 10, rate: 10000 }], []]).mockResolvedValue([{}, []]);
    const r = await svc.updateNarration({ invoiceId: "i", userId: "u", description: "Oct billing — 10 seats + training", lines });
    expect(r.changed.join(" ")).toMatch(/particulars: 1 line\(s\) → 3 line\(s\), total unchanged ₹1,00,000.00/);
    expect(r.changed.join(" ")).toMatch(/narration/);
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO client_invoice_line"));
    expect(inserts.map((c) => c[1][7])).toEqual([1, 2, 3]);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("audit_log") && String(c[1][3]).startsWith("[approved]"))).toBe(true);
    expect(conn.execute.mock.calls.some((c) => /grand_total|total_amount =/.test(String(c[0])))).toBe(false);
    expect(conn.commit).toHaveBeenCalled();
  });
  it("refuses particulars that change the total, saying by how much", async () => {
    conn.execute.mockResolvedValueOnce([[inv()], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]);
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", lines: lines.slice(0, 2) }))
      .rejects.toThrow(/add up to ₹1,02,000.00 but the invoice total is ₹1,00,000.00.*difference ₹2,000.00/);
    expect(conn.rollback).toHaveBeenCalled();
  });
  it("refuses migrated and rejected invoices", async () => {
    conn.execute.mockResolvedValueOnce([[inv({ is_migrated: 1 })], []]);
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", description: "x" })).rejects.toThrow(/migrated/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[inv({ invoice_status: "rejected" })], []]);
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", description: "x" })).rejects.toThrow(/rejected/);
  });
  it("needs at least one particular (charge)", async () => {
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", lines: [lines[2]] })).rejects.toThrow(/At least one particular/);
  });
  it("owner rule: particulars freeze once the approved bill is sent or in Tally; narration still saves", async () => {
    conn.execute.mockResolvedValueOnce([[inv({ last_sent_at: "2026-10-10 10:00:00" })], []]);
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", lines })).rejects.toThrow(/already been sent to the client\. Only the narration/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[inv()], []]).mockResolvedValueOnce([[{ present: 1 }], []]);
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", lines })).rejects.toThrow(/sent to the client/);
    expect(String(conn.execute.mock.calls[1][0])).toMatch(/client_invoice_submission WHERE invoice_id = \? AND send_status = 'sent'/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[inv()], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ present: 1 }], []]);
    await expect(svc.updateNarration({ invoiceId: "i", userId: "u", lines })).rejects.toThrow(/exported to Tally/);
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[inv({ last_sent_at: "2026-10-10 10:00:00" })], []]).mockResolvedValue([{}, []]);
    const r = await svc.updateNarration({ invoiceId: "i", userId: "u", description: "Corrected narration" });
    expect(r.changed.join(" ")).toMatch(/narration/);
    expect(conn.commit).toHaveBeenCalled();
  });
  it("a proforma's particulars stay editable without the sent / Tally lookups", async () => {
    conn.execute.mockResolvedValueOnce([[inv({ invoice_status: "proforma", last_sent_at: "2026-10-10" })], []])
      .mockResolvedValueOnce([[], []]).mockResolvedValue([{}, []]);
    await svc.updateNarration({ invoiceId: "i", userId: "u", lines });
    expect(conn.execute.mock.calls.some((c) => /tally_voucher_export|client_invoice_submission/.test(String(c[0])))).toBe(false);
  });
});
