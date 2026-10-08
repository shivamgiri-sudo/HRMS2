import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** The Tally payment import on a real MySQL 8. Skipped unless TALLY_TEST_DB_PORT is set (throwaway server, root/pw, db t). */
const PORT = process.env.TALLY_TEST_DB_PORT;
const h = vi.hoisted(() => ({ pool: null as any }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (s: string, p?: unknown[]) => h.pool.execute(s, p), getConnection: () => h.pool.getConnection() } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

const xml = (vouchers: string) => `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
const payment = (o: { guid: string; no: string; party: string; amount: number; tds?: number; ref?: string; date?: string }) => `
 <TALLYMESSAGE><VOUCHER VCHTYPE="Payment" REMOTEID="${o.guid}"><DATE>${o.date ?? "20260921"}</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>${o.no}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${o.party}</PARTYLEDGERNAME>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>${o.party}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${o.amount}</AMOUNT>${o.ref ? `<BILLALLOCATIONS.LIST><NAME>${o.ref}</NAME><AMOUNT>-${o.amount}</AMOUNT></BILLALLOCATIONS.LIST>` : ""}</ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${o.amount - (o.tds ?? 0)}</AMOUNT></ALLLEDGERENTRIES.LIST>
  ${o.tds ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>TDS Payable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${o.tds}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ""}
 </VOUCHER></TALLYMESSAGE>`;

describe.skipIf(!PORT)("Tally payment import on a real MySQL", () => {
  let svc: typeof import("../tally-payment-import.service.js").tallyPaymentImport;
  let n = 0;
  async function bill(o: { vendor: string; due: number; invoice?: string; grn?: string; paid?: number; status?: string }) {
    n++; const gid = `g${n}`, tid = `t${n}`;
    await h.pool.query(`INSERT INTO grn_request (id, grn_number, invoice_number, status, accounts_payment_status) VALUES (?,?,?,?, 'pending')`, [gid, o.grn ?? `GRN-${n}`, o.invoice ?? null, "pending_accounts_payment"]);
    await h.pool.query(`INSERT INTO vendor_payment_tracking (id, grn_request_id, grn_number, vendor_name, due_amount, paid_amount, tds_deducted_amount, balance_amount, payment_status) VALUES (?,?,?,?,?,?,0,?,?)`,
      [tid, gid, o.grn ?? `GRN-${n}`, o.vendor, o.due, o.paid ?? 0, o.due - (o.paid ?? 0), o.status ?? "Payment Pending"]);
    return tid;
  }
  const trk = async (id: string) => (await h.pool.query(`SELECT * FROM vendor_payment_tracking WHERE id = ?`, [id]))[0][0];
  const count = async (sql: string) => Number((await h.pool.query(sql))[0][0].n);

  beforeAll(async () => {
    h.pool = mysql.createPool({ host: "127.0.0.1", port: Number(PORT), user: "root", password: "pw", database: "t", multipleStatements: true });
    await h.pool.query("DROP TABLE IF EXISTS tally_import_voucher, tally_import_batch, vendor_payment_transaction, vendor_payment_tracking, grn_request");
    await h.pool.query("CREATE TABLE grn_request (id VARCHAR(36) PRIMARY KEY, grn_number VARCHAR(60), invoice_number VARCHAR(100), status VARCHAR(40), accounts_payment_status VARCHAR(40))");
    await h.pool.query(`CREATE TABLE vendor_payment_tracking (id VARCHAR(36) PRIMARY KEY, grn_request_id VARCHAR(36), grn_number VARCHAR(60), vendor_name VARCHAR(200), due_amount DECIMAL(12,2), paid_amount DECIMAL(12,2), tds_deducted_amount DECIMAL(12,2), balance_amount DECIMAL(12,2), payment_status VARCHAR(30), payment_date DATE NULL, transaction_id VARCHAR(255) NULL, updated_by VARCHAR(36) NULL, updated_at DATETIME NULL)`);
    await h.pool.query(`CREATE TABLE vendor_payment_transaction (id VARCHAR(36) PRIMARY KEY, vendor_payment_id VARCHAR(36), grn_request_id VARCHAR(36), sequence_no INT, payment_mode VARCHAR(30), payment_date DATE, transaction_id VARCHAR(255), amount DECIMAL(12,2), tds_amount DECIMAL(12,2), net_amount DECIMAL(12,2), remarks TEXT, created_by VARCHAR(36), UNIQUE KEY uq (vendor_payment_id, sequence_no))`);
    const ddl = readFileSync(new URL("../../../../sql/1972_tally_payment_import.sql", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const stmt of ddl.match(/CREATE TABLE[\s\S]*?ENGINE=InnoDB[^;]*;/gi)!) await h.pool.query(stmt);
    svc = (await import("../tally-payment-import.service.js")).tallyPaymentImport;
  });
  afterAll(async () => { await h.pool?.end(); });

  it("records a payment against the bill named by Tally, and the bill becomes Paid", async () => {
    const t = await bill({ vendor: "OESPL Private Limited", due: 250398, invoice: "OESPL/26-27/0512", grn: "MAS/09/26/0005" });
    await bill({ vendor: "OESPL Private Limited", due: 250398, invoice: "OESPL/26-27/0510", grn: "OTHER" });
    const file = xml(payment({ guid: "g-1", no: "PV-45", party: "OESPL Private Limited", amount: 250398, ref: "OESPL/26-27/0512" }));
    const p = await svc.preview(Buffer.from(file), "tally.xml", "u1");
    expect(p.summary).toMatchObject({ ready: 1 });
    expect(p.payments[0].allocations[0]).toMatchObject({ grnNumber: "MAS/09/26/0005", by: "bill_ref" });
    const r = await svc.apply(p.batchId, {}, "u1", "finance_head");
    expect(r.recorded).toHaveLength(1);
    expect(await trk(t)).toMatchObject({ payment_status: "Paid", transaction_id: "Tally:PV-45" });
    expect(Number((await trk(t)).paid_amount)).toBe(250398);
    expect(await count("SELECT COUNT(*) n FROM vendor_payment_transaction")).toBe(1);
    expect((await h.pool.query("SELECT status, accounts_payment_status FROM grn_request WHERE id = 'g1'"))[0][0]).toMatchObject({ status: "paid", accounts_payment_status: "paid" });
  });

  it("uploading the same file again records nothing", async () => {
    const file = xml(payment({ guid: "g-1", no: "PV-45", party: "OESPL Private Limited", amount: 250398, ref: "OESPL/26-27/0512" }));
    const p = await svc.preview(Buffer.from(file), "tally-again.xml", "u1");
    expect(p.summary).toMatchObject({ already_imported: 1 });
    const r = await svc.apply(p.batchId, {}, "u1", "finance_head");
    expect(r.recorded).toHaveLength(0);
    expect(await count("SELECT COUNT(*) n FROM vendor_payment_transaction")).toBe(1);
  });

  it("applying one batch twice, or at the same moment, records each voucher once", async () => {
    const t = await bill({ vendor: "Acme Traders", due: 5000, invoice: "ACME-1" });
    const p = await svc.preview(Buffer.from(xml(payment({ guid: "g-2", no: "PV-50", party: "Acme Traders", amount: 5000, ref: "ACME-1" }))), "a.xml", "u1");
    const [a, b] = await Promise.all([svc.apply(p.batchId, {}, "u1", "finance_head"), svc.apply(p.batchId, {}, "u2", "finance_head")]);
    expect(a.recorded.length + b.recorded.length).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM vendor_payment_transaction WHERE vendor_payment_id = '" + t + "'")).toBe(1);
    expect(Number((await trk(t)).paid_amount)).toBe(5000);
  });

  it("splits TDS and treats a part-payment as Partially Paid", async () => {
    const t = await bill({ vendor: "Beta Services", due: 10000, invoice: "BETA-1" });
    const p = await svc.preview(Buffer.from(xml(payment({ guid: "g-3", no: "PV-60", party: "Beta Services", amount: 4000, tds: 400, ref: "BETA-1" }))), "b.xml", "u1");
    await svc.apply(p.batchId, {}, "u1", "finance_head");
    const row = await trk(t);
    expect(row).toMatchObject({ payment_status: "Partially Paid" });
    expect(Number(row.paid_amount)).toBe(4000);
    expect(Number(row.tds_deducted_amount)).toBe(400);
    expect(Number(row.balance_amount)).toBe(6000);
    const tx = (await h.pool.query("SELECT amount, tds_amount, net_amount FROM vendor_payment_transaction WHERE vendor_payment_id = ?", [t]))[0][0];
    expect([Number(tx.amount), Number(tx.tds_amount), Number(tx.net_amount)]).toEqual([4000, 400, 3600]);
  });

  it("an ambiguous voucher is recorded only against the bill the user picks", async () => {
    const a = await bill({ vendor: "Gamma Co", due: 777 }); const b = await bill({ vendor: "Gamma Co", due: 777 });
    const p = await svc.preview(Buffer.from(xml(payment({ guid: "g-4", no: "PV-70", party: "Gamma Co", amount: 777 }))), "g.xml", "u1");
    expect(p.summary).toMatchObject({ ambiguous: 1 });
    expect((await svc.apply(p.batchId, {}, "u1", "finance_head")).recorded).toHaveLength(0);
    const r = await svc.apply(p.batchId, { [p.payments[0].key]: b }, "u1", "finance_head");
    expect(r.recorded).toHaveLength(1);
    expect((await trk(b)).payment_status).toBe("Paid");
    expect((await trk(a)).payment_status).toBe("Payment Pending");
  });

  it("a payment bigger than the open balance is refused and records nothing", async () => {
    const t = await bill({ vendor: "Delta Ltd", due: 100, invoice: "D-1" });
    const p = await svc.preview(Buffer.from(xml(payment({ guid: "g-5", no: "PV-80", party: "Delta Ltd", amount: 500, ref: "D-1" }))), "d.xml", "u1");
    expect(p.summary).toMatchObject({ amount_mismatch: 1 });
    expect((await svc.apply(p.batchId, {}, "u1", "finance_head")).recorded).toHaveLength(0);
    expect((await trk(t)).payment_status).toBe("Payment Pending");
  });

  it("reads a CSV Day Book too, and rejects unreadable files", async () => {
    const t = await bill({ vendor: "Epsilon Inc", due: 1234.5 });
    const csv = "MAS Callnet\nDay Book\nDate,Particulars,Vch Type,Vch No.,Debit Amount,Credit Amount\n22-Sep-2026,Epsilon Inc,Payment,PV-90,\"1,234.50\",\n";
    const p = await svc.preview(Buffer.from(csv), "daybook.csv", "u1");
    expect(p.summary).toMatchObject({ ready: 1 });
    await svc.apply(p.batchId, {}, "u1", "finance_head");
    expect((await trk(t)).payment_status).toBe("Paid");
    await expect(svc.preview(Buffer.from("hello"), "x.pdf", "u1")).rejects.toThrow(/\.xml, \.csv or \.xlsx/);
    await expect(svc.preview(Buffer.from("a,b\n1,2"), "x.csv", "u1")).rejects.toThrow(/No vouchers/);
  });
});
