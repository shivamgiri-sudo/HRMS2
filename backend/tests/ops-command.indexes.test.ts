import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  connExecute: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: h.execute,
    getConnection: async () => ({ execute: h.connExecute, release: h.release }),
  },
}));

import { ensureOpsIndexes, OPS_INDEXES, type OpsIndexSpec } from "../src/modules/operations/ops-command.indexes.js";

const spec: OpsIndexSpec = { table: "attendance_daily_record", name: "idx_ops_adr_cover", columns: "record_date, employee_id" };

/** db.execute answers by query text: table exists / index missing / busy count. */
function dbState(opts: { tableExists?: boolean; indexExists?: boolean; busy?: number; busyThrows?: boolean }) {
  h.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.TABLES")) return [[{ n: opts.tableExists === false ? 0 : 1 }]];
    if (sql.includes("information_schema.STATISTICS")) return [[{ n: opts.indexExists ? 1 : 0 }]];
    if (sql.includes("PROCESSLIST")) {
      if (opts.busyThrows) throw new Error("no privilege");
      return [[{ n: opts.busy ?? 0 }]];
    }
    return [[]];
  });
}

describe("ensureOpsIndexes — must never block or fail the server", () => {
  beforeEach(() => {
    h.execute.mockReset();
    h.connExecute.mockReset();
    h.release.mockReset();
    h.connExecute.mockResolvedValue([[]]);
  });

  it("creates a missing index online with a short lock wait, and restores the session settings", async () => {
    dbState({});
    const r = await ensureOpsIndexes([spec]);
    expect(r.created).toEqual(["idx_ops_adr_cover"]);
    const sqls = h.connExecute.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe("SET SESSION lock_wait_timeout = 3");
    expect(sqls.some((s) => s.startsWith("ALTER TABLE `attendance_daily_record` ADD INDEX `idx_ops_adr_cover`") && s.includes("ALGORITHM=INPLACE, LOCK=NONE"))).toBe(true);
    expect(sqls.some((s) => s === "SET SESSION lock_wait_timeout = DEFAULT")).toBe(true);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the index already exists", async () => {
    dbState({ indexExists: true });
    const r = await ensureOpsIndexes([spec]);
    expect(r.present).toEqual(["idx_ops_adr_cover"]);
    expect(h.connExecute).not.toHaveBeenCalled();
  });

  it("skips while a long query is running on the table (never queues behind it)", async () => {
    dbState({ busy: 1 });
    const r = await ensureOpsIndexes([spec]);
    expect(r.skippedBusy).toEqual(["idx_ops_adr_cover"]);
    expect(h.connExecute).not.toHaveBeenCalled();
  });

  it("treats an unreadable processlist as busy", async () => {
    dbState({ busyThrows: true });
    const r = await ensureOpsIndexes([spec]);
    expect(r.skippedBusy).toHaveLength(1);
    expect(h.connExecute).not.toHaveBeenCalled();
  });

  it("a lock timeout is reported, not thrown, and the connection is still released", async () => {
    dbState({});
    h.connExecute.mockImplementation(async (sql: string) => {
      if (String(sql).startsWith("ALTER")) throw new Error("Lock wait timeout exceeded; try restarting transaction");
      return [[]];
    });
    const r = await ensureOpsIndexes([spec]);
    expect(r.created).toEqual([]);
    expect(r.failed[0].reason).toContain("Lock wait timeout");
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("a missing table or a database error is reported, not thrown", async () => {
    dbState({ tableExists: false });
    expect((await ensureOpsIndexes([spec])).failed[0].reason).toBe("table missing");
    h.execute.mockRejectedValue(new Error("connection lost"));
    expect((await ensureOpsIndexes([spec])).failed[0].reason).toContain("connection lost");
  });

  it("rejects unsafe identifiers instead of building SQL from them", async () => {
    dbState({});
    const r = await ensureOpsIndexes([{ table: "x; DROP TABLE employees", name: "i", columns: "a" }]);
    expect(r.failed[0].reason).toBe("invalid identifier");
    expect(h.connExecute).not.toHaveBeenCalled();
  });

  it("only declares indexes the queries use (no employees indexes)", () => {
    expect(OPS_INDEXES.map((i) => i.table)).toEqual(["attendance_daily_record", "kpi_daily_actual"]);
  });
});
