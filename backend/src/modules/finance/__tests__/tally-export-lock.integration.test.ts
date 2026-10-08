import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";

/**
 * Runs the lock service's real SQL against a real MySQL 8 using the real migration file. Skipped
 * unless LOCK_TEST_DB_PORT points at a throwaway server, e.g.
 *   docker run -d -e MYSQL_ROOT_PASSWORD=pw -e MYSQL_DATABASE=t -p 127.0.0.1:3411:3306 mysql:8.0
 *   LOCK_TEST_DB_PORT=3411 npx vitest run src/modules/finance/__tests__/tally-export-lock.integration.test.ts
 */
const PORT = process.env.LOCK_TEST_DB_PORT;
const holder = vi.hoisted(() => ({ pool: null as any }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (sql: string, params?: unknown[]) => holder.pool.execute(sql, params) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

describe.skipIf(!PORT)("tally_export_lock on a real MySQL", () => {
  let lock: typeof import("../tally-export-lock.service.js");
  beforeAll(async () => {
    holder.pool = mysql.createPool({ host: "127.0.0.1", port: Number(PORT), user: "root", password: "pw", database: "t" });
    await holder.pool.query("DROP TABLE IF EXISTS tally_export_lock");
    await holder.pool.query("DROP TABLE IF EXISTS employees");
    await holder.pool.query("CREATE TABLE employees (user_id CHAR(36), first_name VARCHAR(50), last_name VARCHAR(50))");
    const file = readFileSync(new URL("../../../../sql/1968_tally_export_lock.sql", import.meta.url), "utf8");
    // The column comments in the file contain semicolons, so take the statement by its start and end.
    const create = file.match(/CREATE TABLE[\s\S]*?ENGINE=InnoDB[^;]*;/i)![0];
    await holder.pool.query(create);
    lock = await import("../tally-export-lock.service.js");
  });
  afterAll(async () => { await holder.pool?.end(); });

  const items = [{ key: "MAS|b1", label: "Branch 1" }, { key: "MAS|b2", label: "Branch 2" }];

  it("a first export claims every key; a second export of the same keys claims none", async () => {
    expect(await lock.tallyExportLock.lock("salary_voucher", "run1", items, "u1", "xlsx")).toEqual(["MAS|b1", "MAS|b2"]);
    expect(await lock.tallyExportLock.lock("salary_voucher", "run1", items, "u2", "csv")).toEqual([]);
  });

  it("two simultaneous exports cannot both claim the same key", async () => {
    const [a, b] = await Promise.all([
      lock.tallyExportLock.lock("salary_voucher", "run2", [{ key: "K1" }, { key: "K2" }], "u1", "xml"),
      lock.tallyExportLock.lock("salary_voucher", "run2", [{ key: "K1" }, { key: "K2" }], "u2", "xml"),
    ]);
    expect([...a, ...b].sort()).toEqual(["K1", "K2"]); // each key handed to exactly one caller
  });

  it("splits fresh from locked and reports who pulled what", async () => {
    const r = await lock.splitByLock("salary_voucher", "run1", [...items, { key: "MAS|b3", label: "Branch 3" }]);
    expect(r.fresh.map((i) => i.key)).toEqual(["MAS|b3"]);
    expect(r.locked.map((i) => i.key)).toEqual(["MAS|b1", "MAS|b2"]);
    expect(r.locked[0].lock.format).toBe("xlsx");
  });

  it("locks are per scope and per type", async () => {
    expect(await lock.tallyExportLock.lock("salary_voucher", "run3", [{ key: "MAS|b1" }], "u1", "csv")).toEqual(["MAS|b1"]);
    expect(await lock.tallyExportLock.lock("bank_voucher", "run1", [{ key: "MAS|b1" }], "u1", "xml")).toEqual(["MAS|b1"]);
  });

  it("marking posted upgrades the lock status", async () => {
    await lock.tallyExportLock.markPosted("salary_voucher", "run1", ["MAS|b1"]);
    const m = await lock.tallyExportLock.locks("salary_voucher", "run1", ["MAS|b1", "MAS|b2"]);
    expect(m.get("MAS|b1")!.status).toBe("posted");
    expect(m.get("MAS|b2")!.status).toBe("exported");
  });

  it("releasing keeps the history and lets the key be claimed again, once", async () => {
    expect(await lock.tallyExportLock.release("salary_voucher", "run1", ["MAS|b2"], "u1", "finance_head", "import into Tally failed")).toBe(1);
    expect(await lock.tallyExportLock.lock("salary_voucher", "run1", [{ key: "MAS|b2" }], "u3", "xlsx")).toEqual(["MAS|b2"]);
    expect(await lock.tallyExportLock.lock("salary_voucher", "run1", [{ key: "MAS|b2" }], "u4", "xlsx")).toEqual([]);
    const [rows] = await holder.pool.query("SELECT COUNT(*) n, SUM(active = 1) a FROM tally_export_lock WHERE scope_key = 'run1' AND item_key = 'MAS|b2'");
    expect(Number(rows[0].n)).toBe(2); // the released row is kept
    expect(Number(rows[0].a)).toBe(1); // exactly one active
  });

  it("a re-export is counted against the existing lock", async () => {
    await lock.tallyExportLock.recordReexport("salary_voucher", "run1", [{ key: "MAS|b1" }], "u1", "finance_head", "owner asked for a copy", "csv");
    const m = await lock.tallyExportLock.locks("salary_voucher", "run1", ["MAS|b1"]);
    expect(m.get("MAS|b1")!.reexport_count).toBe(1);
  });

  it("only a finance head / super admin with a reason may re-export", () => {
    expect(() => lock.tallyExportLock.assertReexport("short", ["finance_head"], "finance_head")).toThrow(/reason/);
    expect(() => lock.tallyExportLock.assertReexport("a proper long reason", ["payroll_hr"], "payroll_hr")).toThrow(/finance head/);
    expect(lock.tallyExportLock.assertReexport("a proper long reason", ["finance_head"], "finance_head")).toBe("a proper long reason");
  });
});
