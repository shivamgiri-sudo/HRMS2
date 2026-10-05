import { readFileSync } from "node:fs";
import http from "node:http";
import express from "express";
import request from "supertest";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * End to end through the real router and the real lock SQL on a throwaway MySQL: pull a run's
 * vouchers, try to pull them again, re-export, release. Skipped unless LOCK_TEST_DB_PORT is set
 * (see tally-export-lock.integration.test.ts).
 */
const PORT = process.env.LOCK_TEST_DB_PORT;
const h = vi.hoisted(() => ({ pool: null as any, role: "finance_head", gen: null as any }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: (s: string, p?: unknown[]) => h.pool.execute(s, p) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-" + h.role, role: h.role }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (req: any, _res: any, next: any) => { req.userRoles = [h.role]; next(); },
}));
vi.mock("../finance-access-scope.js", () => ({ resolveFinanceBranchScopeSet: async () => ({ mode: "all" }) }));
vi.mock("../salary-voucher-bill.service.js", () => ({ billSalaryVoucherService: {} }));
vi.mock("../salary-voucher.service.js", () => ({ salaryVoucherService: { generate: (...a: any[]) => h.gen(...a) } }));

const BRANCHES = ["A", "B", "C"];
function fakeGenerate(_run: string, opts: { serialFrom?: number; skipBuckets?: Set<string> }) {
  let serial = opts.serialFrom ?? 1;
  const vouchers = BRANCHES.filter((b) => !opts.skipBuckets?.has(`MAS|${b}`)).map((b) => ({
    voucher_no: `${b}/MAS/08/26/${serial++}`, company_code: "MAS", branch_id: b, branch_name: `Branch ${b}`, cost_category: `Branch ${b}`,
    cost_centre: `${b}/2608`, voucher_type: "JRNLSAL", date: "2026-08-31", narration: "Salary Aug Month", cohort_labels: ["Staff"],
    lines: [
      { ledger_name: "Gross Salary", debit_credit: "D", amount: 100, columns: [100] },
      { ledger_name: "Salary Payable A/C", debit_credit: "C", amount: 100, columns: [100] },
    ],
    totals: { debit: 100, credit: 100, balanced: true }, payroll_gross: 100, employees: 1,
  }));
  return Promise.resolve({ period: "2026-08", vouchers, unassigned: [], unpaid: [] });
}

describe.skipIf(!PORT)("salary voucher export lock, end to end", () => {
  let app: express.Express;
  beforeAll(async () => {
    h.gen = fakeGenerate;
    h.pool = mysql.createPool({ host: "127.0.0.1", port: Number(PORT), user: "root", password: "pw", database: "t" });
    await h.pool.query("DROP TABLE IF EXISTS tally_export_lock");
    await h.pool.query("DROP TABLE IF EXISTS employees");
    await h.pool.query("CREATE TABLE employees (user_id CHAR(36), first_name VARCHAR(50), last_name VARCHAR(50))");
    const file = readFileSync(new URL("../../../../sql/1968_tally_export_lock.sql", import.meta.url), "utf8");
    await h.pool.query(file.match(/CREATE TABLE[\s\S]*?ENGINE=InnoDB[^;]*;/i)![0]);
    const { salaryVoucherRouter } = await import("../salary-voucher.routes.js");
    app = express(); app.use(express.json()); app.use("/api/finance/payroll", salaryVoucherRouter);
  });
  afterAll(async () => { await h.pool?.end(); });

  const exp = (q: string) => request(app).get(`/api/finance/payroll/runs/RUN1/vouchers/export?${q}`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });

  it("without a serial it is a preview: named PREVIEW and never locks", async () => {
    const r = await exp("format=csv");
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toContain("-PREVIEW.csv");
    const [rows] = await h.pool.query("SELECT COUNT(*) n FROM tally_export_lock");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("the Tally XML will not be produced without a serial", async () => {
    expect((await exp("format=xml")).status).toBe(400);
  });

  it("with a serial the vouchers are pulled and locked", async () => {
    const r = await exp("format=csv&serialFrom=612");
    expect(r.status).toBe(200);
    expect(r.headers["x-tally-locked"]).toBe("3");
    const csv = r.body.toString();
    expect(csv).toContain("A/MAS/08/26/612");
    expect(csv).toContain("C/MAS/08/26/614");
    const [rows] = await h.pool.query("SELECT COUNT(*) n FROM tally_export_lock WHERE active = 1");
    expect(Number(rows[0].n)).toBe(3);
  });

  it("pulling the same run again — in ANY format and with ANY serial — is refused", async () => {
    for (const q of ["format=csv&serialFrom=612", "format=xlsx&serialFrom=700", "format=xml&serialFrom=612"]) {
      const r = await exp(q);
      expect(r.status, q).toBe(409);
      expect(JSON.parse(r.body.toString()).code).toBe("ALL_LOCKED");
    }
  });

  it("the preview still works, and shows the vouchers are locked", async () => {
    expect((await exp("format=csv")).status).toBe(200);
    const list = await request(app).get("/api/finance/payroll/runs/RUN1/vouchers");
    expect(list.body.data.vouchers.every((v: any) => v.tally_lock?.status === "exported")).toBe(true);
  });

  it("a payroll user cannot re-export; a finance head needs a reason", async () => {
    h.role = "payroll_hr";
    expect((await exp("format=csv&serialFrom=612&reexport=true&reason=because+I+want+to+do+it+again")).status).toBe(403);
    h.role = "finance_head";
    expect((await exp("format=csv&serialFrom=612&reexport=true&reason=short")).status).toBe(400);
    const ok = await exp("format=csv&serialFrom=612&reexport=true&reason=owner+asked+for+a+second+copy");
    expect(ok.status).toBe(200);
    expect(ok.headers["content-disposition"]).toContain("-REEXPORT.csv");
    const [rows] = await h.pool.query("SELECT SUM(reexport_count) r FROM tally_export_lock WHERE active = 1");
    expect(Number(rows[0].r)).toBe(3);
  });

  it("releasing a lock lets exactly that voucher out again, numbered from the new serial", async () => {
    const rel = await request(app).post("/api/finance/payroll/runs/RUN1/vouchers/locks/release").send({ keys: ["MAS|B"], reason: "import into Tally failed for B" });
    expect(rel.body.data.released).toBe(1);
    const r = await exp("format=csv&serialFrom=620");
    expect(r.status).toBe(200);
    expect(r.headers["x-tally-locked"]).toBe("1");
    const csv = r.body.toString();
    expect(csv).toContain("B/MAS/08/26/620");
    expect(csv).not.toContain("A/MAS");
    expect((await exp("format=csv&serialFrom=621")).status).toBe(409);
  });

  it("a new branch appearing later is exported alone and numbered consecutively; old ones are skipped", async () => {
    BRANCHES.push("D");
    const r = await exp("format=xlsx&serialFrom=630");
    expect(r.status).toBe(200);
    expect(r.headers["x-tally-locked"]).toBe("1");
    expect(r.headers["x-tally-skipped-already-exported"]).toBe("3");
  });

  it("two people pressing export at the same moment: only one gets the vouchers", async () => {
    BRANCHES.push("E", "F");
    const [x, y] = await Promise.all([exp("format=csv&serialFrom=700"), exp("format=csv&serialFrom=800")]);
    const statuses = [x.status, y.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  describe("Tally HTTP push, against a stand-in Tally gateway", () => {
    let server: http.Server;
    const received: string[] = [];
    let rejectNext = false;
    beforeAll(async () => {
      const file = readFileSync(new URL("../../../../sql/1967_salary_voucher_tally_push_log.sql", import.meta.url), "utf8");
      await h.pool.query("DROP TABLE IF EXISTS salary_voucher_tally_push_log");
      await h.pool.query(file.match(/CREATE TABLE[\s\S]*?ENGINE=InnoDB[^;]*;/i)![0]);
      // Behaves like Tally's gateway: GET says it is running; POST of an ENVELOPE answers with counters.
      server = http.createServer((req, res) => {
        if (req.method === "GET") { res.end("<RESPONSE>TallyPrime Server is Running</RESPONSE>"); return; }
        let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
          const amounts = [...body.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
          const balanced = Math.abs(amounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0)) < 0.01;
          if (rejectNext || !balanced) { rejectNext = false; res.end("<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><EXCEPTIONS>0</EXCEPTIONS><LINEERROR>Ledger 'Gross Salary' does not exist!</LINEERROR></RESPONSE>"); return; }
          received.push(body.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/)![1]);
          res.end("<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      process.env.TALLY_GATEWAY_URL = `http://127.0.0.1:${(server.address() as any).port}`;
      BRANCHES.splice(0, BRANCHES.length, "A", "B", "C");
    });
    afterAll(() => { server?.close(); delete process.env.TALLY_GATEWAY_URL; });
    const push = (run: string, body: object) => request(app).post(`/api/finance/payroll/runs/${run}/vouchers/push-to-tally`).send(body);

    it("reports the gateway as connected", async () => {
      const r = await request(app).get("/api/finance/payroll/tally/status");
      expect(r.body.data).toMatchObject({ configured: true, reachable: true });
    });

    it("refuses to post without a Tally serial", async () => {
      expect((await push("RUNP", {})).status).toBe(400);
      expect(received).toHaveLength(0);
    });

    it("posts each voucher once, and a second push of the same run sends nothing", async () => {
      const r = await push("RUNP", { serialFrom: 100 });
      expect(r.body.data).toMatchObject({ posted: 3, failed: 0 });
      expect(received).toEqual(["A/MAS/08/26/100", "B/MAS/08/26/101", "C/MAS/08/26/102"]);
      const again = await push("RUNP", { serialFrom: 100 });
      expect(again.status).toBe(409);
      expect(received).toHaveLength(3); // nothing reached Tally the second time
      const [rows] = await h.pool.query("SELECT status FROM tally_export_lock WHERE scope_key = 'RUNP' AND active = 1");
      expect(rows.every((x: any) => x.status === "posted")).toBe(true);
    });

    it("a file export after a push is refused too, so the same vouchers cannot be imported by hand as well", async () => {
      const r = await request(app).get("/api/finance/payroll/runs/RUNP/vouchers/export?format=xml&serialFrom=100");
      expect(r.status).toBe(409);
    });

    it("a voucher Tally rejects is unlocked again so it can be sent after the cause is fixed", async () => {
      rejectNext = true;
      const r = await push("RUNQ", { serialFrom: 200 });
      expect(r.body.data).toMatchObject({ posted: 2, failed: 1 });
      expect(r.body.data.results.find((x: any) => x.outcome === "failed").detail).toContain("does not exist");
      const retry = await push("RUNQ", { serialFrom: 203 });
      expect(retry.body.data).toMatchObject({ posted: 1, failed: 0 }); // only the rejected one goes now
    });

    it("an unreachable gateway posts nothing, locks nothing, and leaves the run exportable", async () => {
      const keep = process.env.TALLY_GATEWAY_URL;
      process.env.TALLY_GATEWAY_URL = "http://127.0.0.1:9";
      const r = await push("RUNR", { serialFrom: 300 });
      expect(r.body.data.failed).toBeGreaterThan(0);
      expect(r.body.data.posted).toBe(0);
      const [rows] = await h.pool.query("SELECT COUNT(*) n FROM tally_export_lock WHERE scope_key = 'RUNR' AND active = 1");
      expect(Number(rows[0].n)).toBe(0);
      process.env.TALLY_GATEWAY_URL = keep;
      expect((await push("RUNR", { serialFrom: 300 })).body.data.posted).toBe(3);
    });
  });
});
