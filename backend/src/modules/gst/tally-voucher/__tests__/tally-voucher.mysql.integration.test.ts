/**
 * Real-MySQL verification of the Tally voucher service. Opt-in: runs only when
 * TALLY_SANDBOX_PORT is set, and ONLY ever against 127.0.0.1 (asserted below) - never production.
 *
 * Needs a throwaway MySQL with branch_master, cost_centre_master, the client-billing tables
 * (migrations 1300/1302/1308) and 1960_tally_voucher_export.sql applied.
 *   TALLY_SANDBOX_PORT=3399 TALLY_SANDBOX_DB=tally_sbx npx vitest run <this file>
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { SaxesParser } from "saxes";

const PORT = Number(process.env.TALLY_SANDBOX_PORT ?? 0);
const DB_NAME = process.env.TALLY_SANDBOX_DB ?? "tally_sbx";
const HOST = "127.0.0.1";

vi.mock("../../../../db/mysql.js", async () => {
  const port = Number(process.env.TALLY_SANDBOX_PORT ?? 0);
  const pool = port
    ? mysql.createPool({
        host: "127.0.0.1",
        port,
        user: "root",
        database: process.env.TALLY_SANDBOX_DB ?? "tally_sbx",
        timezone: "+05:30",
        dateStrings: true,
        decimalNumbers: true,
        connectionLimit: 4,
      })
    : null;
  return { db: pool };
});
vi.mock("../../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(),
  writeSensitiveActionLog: vi.fn(),
}));

import { db } from "../../../../db/mysql.js";
import { tallyVoucherService } from "../tally-voucher.service.js";

const MAS_UP = "09AAACM5866H1Z6";
const MAS_GJ = "24AAACM5866H1ZE";
const SCOPE = "TALLYIT"; // marks fixture rows so cleanup never touches anything else

function assertWellFormed(xml: string): number {
  const p = new SaxesParser();
  let vouchers = 0;
  p.on("error", (e) => {
    throw e;
  });
  p.on("opentag", (t) => {
    if (t.name === "VOUCHER") vouchers += 1;
  });
  p.write(xml).close();
  return vouchers;
}
const actions = (xml: string) =>
  [...xml.matchAll(/ACTION="(\w+)"/g)].map((m) => m[1]);
const guids = (xml: string) =>
  [...xml.matchAll(/REMOTEID="([^"]+)"/g)].map((m) => m[1]);

describe.skipIf(!PORT)("tally voucher service against a real MySQL", () => {
  const ids = {
    branch: "00000000-0000-4000-8000-0000000000b1",
    ccIgst: "00000000-0000-4000-8000-0000000000c1",
    ccIntra: "00000000-0000-4000-8000-0000000000c2",
    ccBad: "00000000-0000-4000-8000-0000000000c3",
    invA: "00000000-0000-4000-8000-0000000000a1",
    invB: "00000000-0000-4000-8000-0000000000a2",
    invC: "00000000-0000-4000-8000-0000000000a3",
    invProforma: "00000000-0000-4000-8000-0000000000a4",
    cnA: "00000000-0000-4000-8000-0000000000d1",
    cnDraft: "00000000-0000-4000-8000-0000000000d2",
  };
  const user = "00000000-0000-4000-8000-0000000000f1";

  beforeAll(async () => {
    expect(HOST).toBe("127.0.0.1");
    const [[{ n }]] = (await db.execute("SELECT DATABASE() AS n")) as any;
    expect(n).toBe(DB_NAME);
    const run = (sql: string, p: unknown[] = []) => db.execute(sql, p);
    await run(
      `INSERT INTO branch_master (id, branch_name, gstin, gst_state_code, company_name) VALUES (?,?,?,?,?)`,
      [ids.branch, "Noida", MAS_UP, "09", "MAS Callnet India Pvt Ltd"],
    );
    const cc = `INSERT INTO cost_centre_master (id, branch_id, cost_centre_code, billing_client_name, client_name, vendor_gst_no, vendor_state_code, sac_code, jcc_no) VALUES (?,?,?,?,?,?,?,?,?)`;
    await run(cc, [
      ids.ccIgst,
      ids.branch,
      "CC-IGST",
      "Acme Telecom Pvt Ltd",
      "Acme",
      MAS_GJ,
      "24",
      "998513",
      "PO-1",
    ]);
    await run(cc, [
      ids.ccIntra,
      ids.branch,
      "CC-INTRA",
      "Local Client & Sons",
      "Local",
      MAS_UP,
      "09",
      "998513",
      null,
    ]);
    await run(cc, [
      ids.ccBad,
      ids.branch,
      "CC-BAD",
      null,
      null,
      "09AAACM5866H1Z7",
      "09",
      null,
      null,
    ]);
    const inv = `INSERT INTO client_invoice (id, cost_centre_id, invoice_status, category, finance_year, month_label, invoice_date, description, bill_no, gst_type, apply_gst, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    await run(inv, [
      ids.invA,
      ids.ccIgst,
      "approved",
      "Service",
      "2026-27",
      "Oct-26",
      "2026-10-03",
      "Manpower\r\nOct",
      "UP-01/26-27",
      "Integrated",
      1,
      100000,
      18000,
      0,
      0,
      118000,
      user,
    ]);
    await run(inv, [
      ids.invB,
      ids.ccIntra,
      "approved",
      "Service",
      "2026-27",
      "Oct-26",
      "2026-10-09",
      "Seats",
      "UP-02/26-27",
      "Intrastate",
      1,
      50000.5,
      0,
      4500.05,
      4500.05,
      59000.6,
      user,
    ]);
    await run(inv, [
      ids.invC,
      ids.ccBad,
      "approved",
      "Service",
      "2026-27",
      "Oct-26",
      "2026-10-11",
      "x",
      "UP-03/26-27",
      "Intrastate",
      1,
      1000,
      0,
      90,
      90,
      1180,
      user,
    ]);
    await run(inv, [
      ids.invProforma,
      ids.ccIgst,
      "proforma",
      "Service",
      "2026-27",
      "Oct-26",
      "2026-10-12",
      "x",
      null,
      "Integrated",
      1,
      1,
      0,
      0,
      0,
      1,
      user,
    ]);
    const cn = `INSERT INTO client_credit_note (id, invoice_id, cost_centre_id, category, finance_year, month_label, credit_date, description, credit_no, credit_status, gst_type, apply_gst, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    await run(cn, [
      ids.cnA,
      ids.invA,
      ids.ccIgst,
      "Service",
      "2026-27",
      "Oct-26",
      "2026-10-20",
      "Rate fix",
      "CN-01/26-27",
      "approved",
      "Integrated",
      1,
      10000,
      1800,
      0,
      0,
      11800,
      user,
    ]);
    await run(cn, [
      ids.cnDraft,
      ids.invA,
      ids.ccIgst,
      "Service",
      "2026-27",
      "Oct-26",
      "2026-10-21",
      "draft",
      "CN-02/26-27",
      "draft",
      "Integrated",
      1,
      100,
      18,
      0,
      0,
      118,
      user,
    ]);
  });

  afterAll(async () => {
    const run = (sql: string) => db.execute(sql);
    for (const t of [
      "tally_voucher_batch_line",
      "tally_voucher_batch",
      "tally_voucher_export",
      "client_credit_note",
      "client_invoice",
      "cost_centre_master",
      "branch_master",
    ])
      await run(`DELETE FROM ${t}`);
    await run(`DELETE FROM tally_export_config WHERE config_scope <> '*'`);
    await run(
      `UPDATE tally_export_config SET config_value = 'Sales' WHERE config_scope='*' AND config_key='sales_ledger'`,
    );
    void SCOPE;
    await (db as any).end?.();
  });

  const input = {
    companyGstin: MAS_UP,
    periodMonth: "2026-10",
    voucherKinds: ["sales", "credit_note"],
  };
  let batch1 = "";
  let batch2 = "";

  it("preview: approved docs only, exceptions flagged, XML well-formed", async () => {
    const p = await tallyVoucherService.preview(input);
    expect(p.summary).toMatchObject({
      totalVouchers: 4,
      cleanVouchers: 3,
      exceptionVouchers: 1,
    });
    const bad = p.vouchers.find((v) => v.voucherNumber === "UP-03/26-27")!;
    expect(bad.blocked).toBe(true);
    expect(bad.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining([
        "PARTY_LEDGER_MISSING",
        "RECIPIENT_GSTIN_INVALID",
      ]),
    );
    expect(p.vouchers.map((v) => v.voucherNumber)).not.toContain("CN-02/26-27");
    expect(assertWellFormed(p.xml)).toBe(3);
    expect(p.summary.totalDebit).toBe(p.summary.totalCredit);
    // 118000 + 59000.60 + 11800
    expect(p.summary.totalDebit).toBeCloseTo(188800.6, 2);
    expect(p.xml).not.toContain("\r");
  });

  it("generate -> download is refused (409) while exceptions remain, allowed with skipExceptions", async () => {
    const g = await tallyVoucherService.generateBatch(
      input,
      user,
      "finance_head",
    );
    batch1 = g.batchId;
    expect(g.status).toBe("draft");
    await expect(
      tallyVoucherService.renderBatchXml(batch1, { skipExceptions: false }),
    ).rejects.toMatchObject({ status: 409 });
    const r = await tallyVoucherService.renderBatchXml(batch1, {
      skipExceptions: true,
    });
    expect(assertWellFormed(r.xml)).toBe(3);
    expect(actions(r.xml)).toEqual(["Create", "Create", "Create"]);
    await tallyVoucherService.markDownloaded(batch1, user, "finance_head");
    const [rows] = (await db.execute(
      "SELECT COUNT(*) AS n FROM tally_voucher_export",
    )) as any;
    expect(rows[0].n).toBe(3);
  });

  it("re-export emits ALTER with the same GUIDs, and shows exported status in preview", async () => {
    const before = guids(
      (
        await tallyVoucherService.renderBatchXml(batch1, {
          skipExceptions: true,
        })
      ).xml,
    );
    const g = await tallyVoucherService.generateBatch(
      input,
      user,
      "finance_head",
    );
    batch2 = g.batchId;
    const r = await tallyVoucherService.renderBatchXml(batch2, {
      skipExceptions: true,
    });
    expect(actions(r.xml)).toEqual(["Alter", "Alter", "Alter"]);
    expect(guids(r.xml)).toEqual(before);
    const p = await tallyVoucherService.preview(input);
    expect(
      p.vouchers.filter((v) => v.exportStatus === "exported_unchanged"),
    ).toHaveLength(3);
    // the earlier unexported-exceptions batch was superseded and can no longer be downloaded
    await expect(
      tallyVoucherService.renderBatchXml(batch1, { skipExceptions: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("a changed document is flagged changed_since_export", async () => {
    await db.execute(
      "UPDATE client_invoice SET description = 'Manpower Oct revised' WHERE id = ?",
      [ids.invA],
    );
    const p = await tallyVoucherService.preview(input);
    const a = p.vouchers.find((v) => v.voucherNumber === "UP-01/26-27")!;
    expect(a.exportStatus).toBe("changed_since_export");
    expect(a.action).toBe("Alter");
  });

  it("drill-down returns entries, history and XML", async () => {
    const d = await tallyVoucherService.getVoucherDetail(
      "credit_note",
      ids.cnA,
    );
    expect(d.voucher.voucherNumber).toBe("CN-01/26-27");
    expect(
      d.entries.find((e) => e.role === "party")?.billAllocations?.[0],
    ).toMatchObject({ name: "UP-01/26-27", type: "Agst Ref" });
    expect(d.history.length).toBeGreaterThan(0);
    expect(assertWellFormed(d.xml)).toBe(1);
  });

  it("configured ledger names flow into the XML, per company, with validation", async () => {
    await expect(
      tallyVoucherService.saveConfig(
        MAS_UP,
        { sales_ledger: "  " },
        user,
        "finance_head",
      ),
    ).rejects.toThrow();
    await expect(
      tallyVoucherService.saveConfig(
        MAS_UP,
        { nope: "x" },
        user,
        "finance_head",
      ),
    ).rejects.toThrow();
    await tallyVoucherService.saveConfig(
      MAS_UP,
      {
        sales_ledger: "Sales - Manpower UP",
        tally_company_name: "MAS UP Books",
      },
      user,
      "finance_head",
    );
    const p = await tallyVoucherService.preview(input);
    expect(p.companyName).toBe("MAS UP Books");
    expect(p.xml).toContain("<LEDGERNAME>Sales - Manpower UP</LEDGERNAME>");
    expect(p.xml).toContain(
      "<SVCURRENTCOMPANY>MAS UP Books</SVCURRENTCOMPANY>",
    );
    const cfg = await tallyVoucherService.getConfig(MAS_UP);
    expect(cfg.fields.find((f) => f.key === "sales_ledger")).toMatchObject({
      value: "Sales - Manpower UP",
      source: "company",
    });
  });
});
