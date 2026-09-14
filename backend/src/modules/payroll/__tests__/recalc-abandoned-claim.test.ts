import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An abandoned claim used to be invisible forever.
 *
 * The claim is atomic (`WHERE id = ? AND status = 'pending'`) and every path out of the try block
 * writes a terminal status, so a row can only stay 'processing' if the PROCESS DIED between
 * claiming and finishing — a crash, an OOM, a pm2 restart mid-recalculation. Nothing ever looked
 * at those rows again, because the work SELECT reads 'pending' only. The row was stuck, and that
 * employee's salary_prep_line silently stayed stale against attendance with nothing reporting it.
 *
 * Found live 2026-08-17 on production: one row claimed 2026-08-12 with processed_at still NULL
 * five days later. One row — but it is one per crash, accumulating, and invisible by construction.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: vi.fn().mockResolvedValue({ status: "recalculated", message: "ok" }),
}));
vi.mock("../../../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { drainPayrollRecalcQueue } = await import("../payroll-recalc-drainer.service.js");

/**
 * Default: reclaim touches nothing, no pending work found.
 * Routed by statement — a SELECT must hand back an array of rows, an UPDATE a result header.
 */
function stubEmpty() {
  execute.mockReset();
  execute.mockImplementation((sql: string) =>
    /^\s*SELECT/i.test(String(sql))
      ? Promise.resolve([[], []])
      : Promise.resolve([{ affectedRows: 0 }, []]),
  );
}

beforeEach(() => stubEmpty());

describe("abandoned-claim reclamation", () => {
  it("reclaims stale 'processing' rows BEFORE selecting work", async () => {
    await drainPayrollRecalcQueue("2026-08");
    const sqls = execute.mock.calls.map(([s]) => String(s));
    const reclaimIdx = sqls.findIndex((s) => /SET status = 'pending'/.test(s) && /'processing'/.test(s));
    const selectIdx = sqls.findIndex((s) => /SELECT id, employee_id/.test(s));
    expect(reclaimIdx, "no reclaim statement was issued").toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(-1);
    // Reclaiming after the SELECT would leave the abandoned row unseen for another whole tick.
    expect(reclaimIdx).toBeLessThan(selectIdx);
  });

  it("only reclaims a claim that is genuinely abandoned, never a live one", async () => {
    await drainPayrollRecalcQueue("2026-08");
    const reclaim = execute.mock.calls.map(([s]) => String(s)).find((s) => /SET status = 'pending'/.test(s))!;
    // processed_at IS NULL — a finished row must never be dragged back to pending.
    expect(reclaim).toContain("processed_at IS NULL");
    // A time bound, so a claim taken seconds ago is not stolen from a working drainer. Reclaiming
    // a LIVE claim would run the recalculation twice over one employee-month, which is exactly
    // the interleaving the atomic claim exists to prevent.
    expect(reclaim).toMatch(/DATE_SUB\(NOW\(\), INTERVAL \d+ MINUTE\)/);
    expect(reclaim).toContain("status = 'processing'");
    // Scoped to the month being drained, not the whole table.
    expect(reclaim).toContain("payroll_month = ?");
  });

  it("uses a window far longer than a real recalculation", async () => {
    await drainPayrollRecalcQueue("2026-08");
    const reclaim = execute.mock.calls.map(([s]) => String(s)).find((s) => /SET status = 'pending'/.test(s))!;
    const minutes = Number(/INTERVAL (\d+) MINUTE/.exec(reclaim)![1]);
    // A single employee-month recalculation is seconds. Too short a window steals live claims.
    expect(minutes).toBeGreaterThanOrEqual(15);
  });

  it("records WHY the row came back, so it is not mistaken for a fresh request", async () => {
    await drainPayrollRecalcQueue("2026-08");
    const reclaim = execute.mock.calls.map(([s]) => String(s)).find((s) => /SET status = 'pending'/.test(s))!;
    expect(reclaim).toMatch(/error_message/);
    expect(reclaim).toMatch(/abandoned claim/i);
  });
});

describe("a resurrected worker cannot overwrite a newer claim", () => {
  /**
   * If a claim is reclaimed and another drainer picks the row up, the original worker may still be
   * alive and finish later. Without a status guard its terminal UPDATE would land on the row and
   * overwrite the newer claim's result — turning the reclamation into the very double-write it was
   * meant to prevent.
   */
  it("guards every terminal write with status = 'processing'", async () => {
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "src/modules/payroll/payroll-recalc-drainer.service.ts"),
      "utf8",
    );
    for (const terminal of ["'completed'", "'skipped_locked'", "'failed'"]) {
      const idx = src.indexOf(`SET status = ${terminal}`);
      expect(idx, `no terminal write for ${terminal}`).toBeGreaterThan(-1);
      const stmt = src.slice(idx, idx + 400);
      expect(stmt, `${terminal} write is not guarded`).toContain("AND status = 'processing'");
    }
  });
});

describe("a tick never drains more than its starting backlog", () => {
  it("bounds the batch by the pending count read at the start", async () => {
    // Draining is self-feeding: a recalculation re-queues a fresh pending row for the same
    // employee-month, so an unbounded loop would spin on its own output. The bound is the
    // pending count measured before any work, not rows-seen.
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "src/workers/payroll-recalc-drainer.worker.ts"),
      "utf8",
    );
    expect(src).toMatch(/startingBacklog/);
    expect(src).toMatch(/pending_at_start/);
  });
});
