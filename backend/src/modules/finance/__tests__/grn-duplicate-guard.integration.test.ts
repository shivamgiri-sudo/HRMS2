import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertNoPaidTwin, findPaidTwin } from "../grn-duplicate-guard.js";

/** The guard's SQL on a real MySQL 8. Skipped unless GUARD_TEST_DB_PORT is set (throwaway server, root/pw, db t). */
const PORT = process.env.GUARD_TEST_DB_PORT;

describe.skipIf(!PORT)("duplicate-bill guard on a real MySQL", () => {
  let pool: mysql.Pool;
  const n = { i: 0 };
  /** Inserts a GRN + its tracking row; returns the tracking id. */
  async function bill(o: { vendor?: string; name?: string; amount: number; invoice?: string | null; billDate?: string; branch?: string | null; paid?: number; status?: string; trkStatus?: string; no?: string }) {
    const id = `g${++n.i}`; const tid = `t${n.i}`;
    await pool.query(`INSERT INTO grn_request (id, grn_number, invoice_number, bill_date, branch_id, status) VALUES (?,?,?,?,?,?)`,
      [id, o.no ?? `GRN-${n.i}`, o.invoice ?? null, o.billDate ?? "2026-09-01", o.branch === undefined ? "b1" : o.branch, o.status ?? "pending_accounts_payment"]);
    await pool.query(`INSERT INTO vendor_payment_tracking (id, grn_request_id, grn_number, vendor_id, vendor_name, due_amount, paid_amount, payment_status, created_at) VALUES (?,?,?,?,?,?,?,?, '2026-09-24 10:00:00')`,
      [tid, id, o.no ?? `GRN-${n.i}`, o.vendor ?? "v1", o.name ?? "OESPL Private Limited", o.amount, o.paid ?? 0, o.trkStatus ?? (o.paid ? "Paid" : "Payment Pending")]);
    return tid;
  }

  beforeAll(async () => {
    pool = mysql.createPool({ host: "127.0.0.1", port: Number(PORT), user: "root", password: "pw", database: "t" });
    await pool.query("DROP TABLE IF EXISTS payment_voucher_grn_allocation, payment_voucher, vendor_payment_tracking, grn_request");
    await pool.query("CREATE TABLE grn_request (id VARCHAR(36) PRIMARY KEY, grn_number VARCHAR(60), invoice_number VARCHAR(100), bill_date DATE, branch_id VARCHAR(36), status VARCHAR(40))");
    await pool.query("CREATE TABLE vendor_payment_tracking (id VARCHAR(36) PRIMARY KEY, grn_request_id VARCHAR(36), grn_number VARCHAR(60), vendor_id VARCHAR(36), vendor_name VARCHAR(200), due_amount DECIMAL(12,2), paid_amount DECIMAL(12,2), payment_status VARCHAR(30), created_at DATETIME)");
    await pool.query("CREATE TABLE payment_voucher (id VARCHAR(36) PRIMARY KEY, voucher_number VARCHAR(40), status VARCHAR(30))");
    await pool.query("CREATE TABLE payment_voucher_grn_allocation (id INT AUTO_INCREMENT PRIMARY KEY, payment_voucher_id VARCHAR(36), vendor_payment_tracking_id VARCHAR(36))");
  });
  afterAll(async () => { await pool?.end(); });

  it("two unpaid copies of the same bill do not block each other (nothing has gone out yet)", async () => {
    const a = await bill({ amount: 379011, invoice: "OESPL/26-27/0510", no: "MAS/09/26/0009" });
    await bill({ amount: 379011, invoice: null, no: "Mas/9/26/127" });
    expect(await findPaidTwin(pool, a)).toBeNull();
  });

  it("once one copy is paid, the other is refused and the message names the paid one", async () => {
    const pending = await bill({ amount: 250398.01, invoice: "OESPL/26-27/0512", no: "MAS/09/26/0005" });
    await bill({ amount: 250398, invoice: null, no: "Mas/9/26/128", paid: 250398 });
    const twin = await findPaidTwin(pool, pending);
    expect(twin).toMatchObject({ grnNumber: "Mas/9/26/128", paidAmount: 250398 });
    await expect(assertNoPaidTwin(pool, pending, "GRN MAS/09/26/0005")).rejects.toThrow(/duplicate of Mas\/9\/26\/128.*already paid 250398\.00/);
  });

  it("a payment voucher in flight on the twin also blocks", async () => {
    const pending = await bill({ amount: 100000, invoice: "X1", no: "NEW-1" });
    const other = await bill({ amount: 100000, invoice: "X1", no: "OLD-1" });
    await pool.query("INSERT INTO payment_voucher (id, voucher_number, status) VALUES ('pv1','PV-9','ceo_approved')");
    await pool.query("INSERT INTO payment_voucher_grn_allocation (payment_voucher_id, vendor_payment_tracking_id) VALUES ('pv1', ?)", [other]);
    await expect(assertNoPaidTwin(pool, pending, "GRN NEW-1")).rejects.toThrow(/payment voucher PV-9 in progress/);
  });

  it("a finance head can confirm it is not a duplicate; anyone else cannot", async () => {
    const pending = await bill({ amount: 5555, invoice: null, no: "NEW-2" });
    await bill({ amount: 5555, invoice: null, no: "OLD-2", paid: 5555 });
    await expect(assertNoPaidTwin(pool, pending, "GRN NEW-2", { allow: true, actorRole: "accounts_head" })).rejects.toThrow();
    await expect(assertNoPaidTwin(pool, pending, "GRN NEW-2", { allow: true, actorRole: "finance_head" })).resolves.toBeUndefined();
    await expect(assertNoPaidTwin(pool, pending, "GRN NEW-2", { allow: false, actorRole: "finance_head" })).rejects.toThrow();
  });

  it("does NOT block genuine repeat bills", async () => {
    // different real invoice numbers, same vendor/amount/month (e.g. two separate rent invoices)
    const a = await bill({ amount: 88362.33, invoice: "INV-A", no: "R1" });
    await bill({ amount: 88362.33, invoice: "INV-B", no: "R2", paid: 88362.33 });
    expect(await findPaidTwin(pool, a)).toBeNull();
    // same invoice, different bill month (monthly rent)
    const b = await bill({ amount: 50000, invoice: null, billDate: "2026-10-01", no: "M10" });
    await bill({ amount: 50000, invoice: null, billDate: "2026-09-01", no: "M09", paid: 50000 });
    expect(await findPaidTwin(pool, b)).toBeNull();
    // different branch
    const c = await bill({ amount: 7000, invoice: null, branch: "b2", no: "BR2" });
    await bill({ amount: 7000, invoice: null, branch: "b1", no: "BR1", paid: 7000 });
    expect(await findPaidTwin(pool, c)).toBeNull();
    // different vendor
    const d = await bill({ amount: 9000, invoice: null, vendor: "v2", name: "Another Vendor", no: "V2" });
    await bill({ amount: 9000, invoice: null, vendor: "v1", no: "V1", paid: 9000 });
    expect(await findPaidTwin(pool, d)).toBeNull();
  });

  it("ignores a rejected / cancelled twin, and the bill itself", async () => {
    const a = await bill({ amount: 1234, invoice: null, no: "ALIVE" });
    await bill({ amount: 1234, invoice: null, no: "DEAD", paid: 1234, status: "cancelled" });
    await bill({ amount: 1234, invoice: null, no: "DEAD2", paid: 1234, trkStatus: "Rejected" });
    expect(await findPaidTwin(pool, a)).toBeNull();
  });

  it("treats the same vendor name under another vendor id as the same vendor", async () => {
    const a = await bill({ amount: 4321, invoice: null, vendor: "vA", name: "  sri sanchia computronics", no: "S1" });
    await bill({ amount: 4321, invoice: null, vendor: "vB", name: "SRI SANCHIA COMPUTRONICS", no: "S2", paid: 4321 });
    expect(await findPaidTwin(pool, a)).toMatchObject({ grnNumber: "S2" });
  });
});
