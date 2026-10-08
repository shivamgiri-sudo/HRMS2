import { describe, expect, it, vi } from "vitest";
import { readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const sql = (name: string) => readFileSync(join(HERE, "../../../../sql", name), "utf8");

describe("migrations 1849-1851 (contract)", () => {
  const m1849 = sql("1849_roster_assignment_process_lob.sql");
  const m1850 = sql("1850_roster_offday_policy.sql");
  const m1851 = sql("1851_roster_offday_policy_page_access.sql");
  const executable = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("1849 is additive: guarded ADD COLUMN/INDEX only, no backfill, no MariaDB-only clauses", () => {
    const body = executable(m1849);
    expect(body).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bMODIFY\b|\bRENAME\b/i);
    expect(body).not.toMatch(/IF NOT EXISTS/i);
    expect(body.match(/ADD COLUMN/g)).toHaveLength(2);
    expect(body.match(/ADD INDEX/g)).toHaveLength(2);
    expect(body.match(/information_schema\.(COLUMNS|STATISTICS)/g)!.length).toBeGreaterThanOrEqual(6);
  });
  it("1849/1850 copy id-column collations from the parent tables at migration time", () => {
    expect(m1849).toMatch(/TABLE_NAME = 'process_master'[^;]*COLUMN_NAME = 'id'/s);
    expect(m1849).toMatch(/TABLE_NAME = 'lob_master'[^;]*COLUMN_NAME = 'id'/s);
    for (const t of ["process_master", "lob_master", "branch_master"]) expect(m1850).toContain(`TABLE_NAME = '${t}'`);
    expect(m1850).toMatch(/process_id CHAR\(36\) CHARACTER SET utf8mb4 COLLATE ', @rop_pc/);
    expect(m1850).toMatch(/lob_id CHAR\(36\) CHARACTER SET utf8mb4 COLLATE ', @rop_lc/);
    expect(m1850).toMatch(/branch_id CHAR\(36\) CHARACTER SET utf8mb4 COLLATE ', @rop_bc/);
    expect(m1850).toMatch(/DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/);
    expect(m1850).toMatch(/CREATE TABLE IF NOT EXISTS roster_offday_policy/);
  });
  it("1851 seeds the page idempotently for the WFM roles", () => {
    expect(executable(m1851).match(/ON DUPLICATE KEY UPDATE/g)).toHaveLength(2);
    expect(m1851).toContain("WFM_ROSTER_OFFDAY_POLICY");
    expect(m1851).toContain("'wfm', 'wfm_spoc', 'branch_wfm', 'ho_wfm'");
  });
  it("are registered in the migration manifest and the schema snapshot", () => {
    const manifest = readFileSync(join(HERE, "../../../db/runPendingMigrations.ts"), "utf8");
    for (const f of ["1849_roster_assignment_process_lob.sql", "1850_roster_offday_policy.sql", "1851_roster_offday_policy_page_access.sql"]) {
      expect(manifest).toContain(`"${f}"`);
    }
    const snap = JSON.parse(sql("schema-snapshot.json"));
    expect(snap.tables.roster_offday_policy).toContain("fixed_weekdays");
    expect(snap.tables.wfm_roster_assignment).toEqual(expect.arrayContaining(["process_id", "lob_id"]));
    expect(snap.tableCount).toBe(Object.keys(snap.tables).length);
    expect(snap.columnCount).toBe(Object.values<string[]>(snap.tables).reduce((n, c) => n + c.length, 0));
  });
});

describe("backfill script", () => {
  it("every step is NULL-only, range-bounded and resolves in plan > template > employee order", async () => {
    const mod = await import("../../../../scripts/backfill-roster-assignment-process-lob.mjs");
    expect(mod.STEPS.map((s: any) => s.name)).toEqual([
      "process_id from plan", "process_id from shift template", "process_id from employee", "lob_id from employee",
    ]);
    for (const s of mod.STEPS) {
      const q = mod.updateSql(s);
      expect(q).toMatch(/wra\.id > \? AND wra\.id <= \?/);
      expect(q).toMatch(/wra\.(process_id|lob_id) IS NULL/);
      expect(q).not.toMatch(/COALESCE|IF\(/i);
    }
  });
  it("parses options, defaults to dry run and rejects unknown flags", async () => {
    const { parseArgs } = await import("../../../../scripts/backfill-roster-assignment-process-lob.mjs");
    expect(parseArgs([]).apply).toBe(false);
    expect(parseArgs(["--apply", "--batch", "500", "--resume"])).toMatchObject({ apply: true, batch: 500, resume: true });
    expect(parseArgs(["--batch", "999999"]).batch).toBe(5000);
    expect(() => parseArgs(["--wat"])).toThrow(/Unknown option/);
  });
  it("dry run counts and writes nothing; apply walks keyset batches until done", async () => {
    const { run, parseArgs } = await import("../../../../scripts/backfill-roster-assignment-process-lob.mjs");
    const make = () => {
      const stmts: string[] = [];
      let boundary = 0;
      const conn = {
        end: vi.fn(),
        query: vi.fn(async (q: string, p?: unknown[]) => {
          stmts.push(q.replace(/\s+/g, " ").trim());
          if (/information_schema\.COLUMNS/.test(q)) return [[{ COLUMN_NAME: "process_id" }, { COLUMN_NAME: "lob_id" }]];
          if (/^SET SESSION/.test(q)) return [{}];
          if (/ORDER BY id LIMIT \?, 1/.test(q)) { boundary++; return [boundary === 1 ? [{ id: "b" }] : []]; }
          if (/SELECT MAX\(id\)/.test(q)) return [[{ id: "z" }]];
          if (/^SELECT COUNT/.test(q)) return [[{ c: 5 }]];
          return [{ affectedRows: 7 }];
        }),
      };
      return { conn, stmts };
    };
    const dry = make();
    const out = await run({ ...parseArgs([]), cursorFile: join(HERE, "nope.cursor") }, async () => dry.conn as any, () => {});
    expect(dry.stmts.some((s) => /^UPDATE/.test(s))).toBe(false);
    expect(out.totals["lob_id from employee"]).toBe(10); // two batches (b, then tail z) x 5
    const real = make();
    const tmp = join(tmpdir(), `roster-backfill-test-${process.pid}.cursor`);
    const out2 = await run({ ...parseArgs(["--apply", "--sleep-ms", "0"]), cursorFile: tmp }, async () => real.conn as any, () => {});
    expect(real.stmts.filter((s) => /^UPDATE/.test(s))).toHaveLength(8);
    expect(out2.totals["process_id from plan"]).toBe(14);
    expect(out2.failedSteps).toBe(0);
    rmSync(tmp, { force: true });
  });
  it("refuses to run before migration 1849", async () => {
    const { run, parseArgs } = await import("../../../../scripts/backfill-roster-assignment-process-lob.mjs");
    const conn = { end: vi.fn(), query: vi.fn(async () => [[]]) };
    await expect(run(parseArgs([]), async () => conn as any, () => {})).rejects.toThrow(/apply migration 1849/);
    expect(conn.end).toHaveBeenCalled();
  });
});
