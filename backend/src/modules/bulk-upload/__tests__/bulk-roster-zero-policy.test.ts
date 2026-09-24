/**
 * With zero off-day policy rows (and no process_id/lob_id columns) the two bulk roster writers must
 * emit exactly the writes they emitted BEFORE the off-day hook existed. The golden file was recorded
 * on the pre-hook tree (origin/main 5e8a0c00) with this same test:
 *   ROSTER_GOLDEN_WRITE=1 npx vitest run src/modules/bulk-upload/__tests__/bulk-roster-zero-policy.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const { conn, lockConn, getConnection, state } = vi.hoisted(() => ({
  conn: { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
  lockConn: { query: vi.fn(), release: vi.fn() },
  getConnection: vi.fn(),
  state: { calls: [] as Array<{ sql: string; params: unknown[] }>, batchRows: [] as unknown[] },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection, execute: (...a: any[]) => conn.execute(...a) } }));
vi.mock("../../roster/roster-change-log.js", () => ({ logRosterChange: vi.fn(async () => undefined) }));

import { importRosterAssignmentBatch } from "../roster-assignment-bulk.service.js";
import { importShiftRosterBatch } from "../shift-roster-bulk.service.js";
import { __resetSchemaCachesForTests } from "../../wfm/shift-scheduling.util.js";
import { __resetSchemaProbeCachesForTests } from "../../wfm/schema-probe.util.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "bulk-roster-zero-policy.golden.json");
const WRITE = process.env.ROSTER_GOLDEN_WRITE === "1";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const norm = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
    : typeof v === "string" ? v.replace(UUID, "<uuid>") : v;

function keyedExecute() {
  conn.execute.mockImplementation(async (sql: string, params?: any[]) => {
    state.calls.push({ sql, params: params ?? [] });
    const s = sql.replace(/\s+/g, " ").trim().toUpperCase();
    if (s.startsWith("SELECT * FROM UPLOAD_BATCH_ROW")) return [state.batchRows, []];
    if (s.includes("FROM EMPLOYEES WHERE EMPLOYEE_CODE IN")) {
      return [(params ?? []).map((c) => ({ id: `emp-${c}`, employee_code: c, process_id: "proc-1", branch_id: "br-1" })), []];
    }
    if (s.includes("FROM WFM_SHIFT_TEMPLATE")) return [[{ id: "shift-1", shift_code: "GEN", start_time: "10:00:00", end_time: "19:00:00" }], []];
    return [[], []];
  });
}

async function record(run: () => Promise<unknown>) {
  state.calls.length = 0;
  getConnection.mockReset();
  getConnection.mockImplementationOnce(async () => conn);
  getConnection.mockImplementation(async () => lockConn);
  __resetSchemaCachesForTests();
  __resetSchemaProbeCachesForTests();
  keyedExecute();
  await run();
  return JSON.parse(JSON.stringify(norm(
    state.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).map((c) => ({ sql: c.sql, params: c.params })),
  )));
}

const assignRow = (code: string, date: string, weekOff: string) => ({
  id: `r-${code}-${date}`, row_no: 1,
  normalized_data: JSON.stringify({ cycle_id: "cycle-1", employee_code: code, roster_date: date, shift_code: "GEN", is_week_off: weekOff, notes: "n" }),
});
const weekRow = { id: "w-1", row_no: 1, normalized_data: JSON.stringify({
  employee_code: "MAS001", week_start_date: "2026-08-17", mon_shift: "09:00-18:00", tue_shift: "09:00-18:00", sun_shift: "OFF",
}) };

async function recordAll() {
  state.batchRows = [assignRow("MAS001", "2026-08-17", "0"), assignRow("MAS002", "2026-08-23", "1")];
  const roster = await record(() => importRosterAssignmentBatch("batch-1", "user-1"));
  state.batchRows = [weekRow];
  const shift = await record(() => importShiftRosterBatch("batch-2", "user-1"));
  return { rosterAssignment: roster, shiftRoster: shift };
}

beforeEach(() => {
  getConnection.mockReset();
  getConnection.mockImplementationOnce(async () => conn);
  getConnection.mockImplementation(async () => lockConn);
  lockConn.query.mockImplementation(async (sql: string) => (sql.includes("GET_LOCK") ? [[{ acquired: 1 }], []] : [[], []]));
  __resetSchemaCachesForTests();
  __resetSchemaProbeCachesForTests();
});

describe("zero policy rows: bulk roster writers are unchanged", () => {
  it("emits exactly the writes recorded before the off-day hook existed", async () => {
    const actual = await recordAll();
    if (WRITE) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });

  it("scenario is non-vacuous (both services inserted into wfm_roster_assignment)", async () => {
    const actual = await recordAll();
    expect(actual.rosterAssignment.filter((w: any) => w.sql.includes("INSERT INTO wfm_roster_assignment")).length).toBe(2);
    expect(actual.shiftRoster.filter((w: any) => w.sql.includes("INSERT INTO wfm_roster_assignment")).length).toBe(1);
  });
});
