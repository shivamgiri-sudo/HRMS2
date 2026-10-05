import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Bank-voucher XML and GST sales CSV: the same lock, on a throwaway MySQL (see the other lock tests). */
const PORT = process.env.LOCK_TEST_DB_PORT;
const h = vi.hoisted(() => ({ pool: null as any, role: "finance_head", batch: null as any }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: (s: string, p?: unknown[]) => h.pool.execute(s, p) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-" + h.role, role: h.role }; next(); },
  requireWriteAccess: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (req: any, _res: any, next: any) => { req.userRoles = [h.role]; next(); },
}));
vi.mock("../finance-branch-guard.js", () => ({ callerBranchScope: async () => ({ mode: "all" }) }));
vi.mock("../../gst/gst-export.service.js", () => ({
  gstExportService: { getBatch: async () => h.batch, markDownloaded: async () => ({ success: true }) },
}));

describe.skipIf(!PORT)("bank voucher and GST sales locks", () => {
  beforeAll(async () => {
    h.pool = mysql.createPool({ host: "127.0.0.1", port: Number(PORT), user: "root", password: "pw", database: "t" });
    await h.pool.query("DROP TABLE IF EXISTS tally_export_lock");
    await h.pool.query("DROP TABLE IF EXISTS employees");
    await h.pool.query("CREATE TABLE employees (user_id CHAR(36), first_name VARCHAR(50), last_name VARCHAR(50))");
    const file = readFileSync(new URL("../../../../sql/1968_tally_export_lock.sql", import.meta.url), "utf8");
    await h.pool.query(file.match(/CREATE TABLE[\s\S]*?ENGINE=InnoDB[^;]*;/i)![0]);
  });
  afterAll(async () => { await h.pool?.end(); });

  describe("bank vouchers", () => {
    let svc: typeof import("../tally-export.service.js").tallyExportService;
    const envelope = (nums: string[], isFinal: boolean, exclude?: Set<string>) => {
      const kept = nums.filter((n) => !exclude?.has(n));
      return { xml: `<ENVELOPE>${kept.join(",")}</ENVELOPE>`, isFinal, entryCount: kept.length, totalDebit: kept.length * 10, totalCredit: kept.length * 10, voucherNumbers: kept };
    };
    let all = ["PV-1", "PV-2"]; let final = true;
    beforeAll(async () => {
      svc = (await import("../tally-export.service.js")).tallyExportService;
      vi.spyOn(svc, "buildEnvelopeVerified").mockImplementation(async (_a: string, _f?: string, _t?: string, exclude?: Set<string>) => envelope(all, final, exclude));
    });

    it("a provisional (not yet final) export is a preview and locks nothing", async () => {
      final = false;
      const r = await svc.exportAndLog("BANK1", undefined, undefined, "u1", "finance_head");
      expect(r.isFinal).toBe(false);
      const [rows] = await h.pool.query("SELECT COUNT(*) n FROM tally_export_lock WHERE export_type = 'bank_voucher'");
      expect(Number(rows[0].n)).toBe(0);
      final = true;
    });

    it("a final export locks its vouchers; the next one hands over only new vouchers", async () => {
      const first = await svc.exportAndLog("BANK1", undefined, undefined, "u1", "finance_head");
      expect(first.voucherNumbers).toEqual(["PV-1", "PV-2"]);
      all = ["PV-1", "PV-2", "PV-3"];
      const second = await svc.exportAndLog("BANK1", undefined, undefined, "u1", "finance_head");
      expect(second.voucherNumbers).toEqual(["PV-3"]);
      expect(second.skipped).toBe(2);
    });

    it("when everything was already pulled it refuses (409) instead of handing it over again", async () => {
      await expect(svc.exportAndLog("BANK1", undefined, undefined, "u1", "finance_head")).rejects.toMatchObject({ statusCode: 409, code: "TALLY_EXPORT_LOCKED" });
    });

    it("re-export needs finance head + reason, and returns everything", async () => {
      await expect(svc.exportAndLog("BANK1", undefined, undefined, "u2", "payroll_hr", { reexport: true, reason: "a long enough reason", roles: ["payroll_hr"] })).rejects.toMatchObject({ statusCode: 403 });
      const r = await svc.exportAndLog("BANK1", undefined, undefined, "u1", "finance_head", { reexport: true, reason: "a long enough reason", roles: ["finance_head"] });
      expect(r.voucherNumbers).toEqual(["PV-1", "PV-2", "PV-3"]);
      expect(r.reexported).toBe(3);
    });

    it("a different bank account has its own locks", async () => {
      const r = await svc.exportAndLog("BANK2", undefined, undefined, "u1", "finance_head");
      expect(r.voucherNumbers).toEqual(["PV-1", "PV-2", "PV-3"]);
    });
  });

  describe("GST sales CSV", () => {
    let app: express.Express;
    const rows = (nos: string[]) => nos.map((n, i) => ({ sequence_no: i + 1, source_type: "invoice", source_id: `id-${n}`, bill_no: n, invoice_date: "2026-08-10", validation_status: "valid" }));
    beforeAll(async () => {
      const { gstExportRouter } = await import("../../gst/gst-export.routes.js");
      app = express(); app.use(express.json()); app.use("/api/gst", gstExportRouter);
    });
    const batch = (nos: string[]) => ({ batch: { id: "B1", export_type: "TALLY_SALES", company_gstin: "27AAAAA0000A1Z5", period_month: "2026-08", exception_rows: 0 }, rows: rows(nos) });
    const csv = () => request(app).get("/api/gst/exports/B1/csv");

    it("the first download pulls and locks every invoice", async () => {
      h.batch = batch(["INV1", "INV2"]);
      const r = await csv();
      expect(r.status).toBe(200);
      expect(r.text).toContain("INV1");
      expect(r.text).toContain("INV2");
    });

    it("a regenerated batch with the same invoices cannot hand them over again", async () => {
      h.batch = batch(["INV1", "INV2"]);
      const r = await csv();
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("ALL_LOCKED");
    });

    it("a regenerated batch that gained one invoice exports only that one", async () => {
      h.batch = batch(["INV1", "INV2", "INV3"]);
      const r = await csv();
      expect(r.status).toBe(200);
      expect(r.text).toContain("INV3");
      expect(r.text).not.toContain("INV1");
      expect(r.headers["x-tally-skipped-already-exported"]).toBe("2");
    });

    it("re-export needs a finance head and a reason", async () => {
      h.role = "payroll_hr";
      expect((await csv().query({ reexport: "true", reason: "long enough reason here" })).status).toBe(403);
      h.role = "finance_head";
      const ok = await csv().query({ reexport: "true", reason: "long enough reason here" });
      expect(ok.status).toBe(200);
      expect(ok.text).toContain("INV1");
    });
  });
});
