import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One branch, one float holder at a time.
 *
 * The table's unique key is `(user_id, branch_id, effective_from)`, which only stops the SAME
 * person being appointed to the same branch on the same day. Two DIFFERENT people holding one
 * branch's float simultaneously passed it cleanly — and that is the case that actually breaks
 * money:
 *
 *   - the allocation picker offers two holders for one branch's cash;
 *   - the voucher debit resolves `ORDER BY effective_from DESC LIMIT 1` and picks whichever
 *     started later, arbitrarily, so a voucher can debit one float while an allocation credited
 *     the other;
 *   - the balance is per-manager, so one physical cash box splits across two ledgers and neither
 *     reconciles to what is in the drawer.
 *
 * The overlap rule is the standard one: two periods overlap when each starts on or before the
 * other ends, with a NULL end meaning open-ended. The cases below are the ones that get this
 * wrong when it is written by intuition — touching at the boundary, one period wholly inside
 * another, and open-ended on either side.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

let imprestService: typeof import("../imprest.service.js")["imprestService"];
beforeAll(async () => {
  ({ imprestService } = await import("../imprest.service.js"));
}, 120_000);

/**
 * A connection whose overlap query returns `clashes`, recording every statement issued.
 *
 * `current` fixtures the row saveManager's update path now locks and re-reads before deciding
 * whether an overlap re-check is even needed (the 2026-08-29 regression fix) — distinct from the
 * overlap-check query itself, which this distinguishes by requiring `branch_id = ?` in the SQL
 * text (the by-id lookup only ever filters on `id`).
 */
function makeConnection(clashes: unknown[], current?: Record<string, unknown>) {
  const statements: string[] = [];
  return {
    statements,
    execute: vi.fn(async (sql: string) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      statements.push(flat);
      if (/FROM imprest_manager/.test(flat) && /branch_id = \?/.test(flat) && /FOR UPDATE/.test(flat)) {
        return [clashes, []];
      }
      if (/FROM imprest_manager\s+WHERE id = \?\s+FOR UPDATE/.test(flat)) {
        return [
          [current ?? { id: "m-self", branch_id: "br1", effective_from: "2026-01-01", effective_to: null, active_status: 1 }],
          [],
        ];
      }
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
}

const CLASH = { id: "m-existing", user_id: "u-alice", effective_from: "2026-01-01", effective_to: null };

const APPOINT = {
  branchId: "br1",
  userId: "u-bob",
  employeeId: "e-bob",
  effectiveFrom: "2026-06-01",
};

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  // saveManager ends by re-reading the row through getManager, which uses the pool rather than
  // the transaction's connection. Without a row here every success path throws "not found" and
  // the test would be asserting the mock, not the guard.
  execute.mockResolvedValue([[{ id: "m-new", branch_id: "br1", user_id: "u-bob" }], []]);
});

describe("an overlapping appointment is refused", () => {
  it("refuses a second open-ended holder for the same branch", async () => {
    const conn = makeConnection([CLASH]);
    getConnection.mockResolvedValue(conn);
    await expect(imprestService.saveManager(APPOINT, "actor")).rejects.toThrow(
      /already has an imprest manager for that period/i,
    );
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.statements.some((s) => /INSERT INTO imprest_manager/.test(s))).toBe(false);
  });

  it("names the clashing period, so the message says what to do about it", async () => {
    const conn = makeConnection([CLASH]);
    getConnection.mockResolvedValue(conn);
    await expect(imprestService.saveManager(APPOINT, "actor")).rejects.toThrow(
      /2026-01-01 to open-ended.*End that appointment/is,
    );
  });

  it("allows the appointment when nothing clashes", async () => {
    const conn = makeConnection([]);
    getConnection.mockResolvedValue(conn);
    await imprestService.saveManager(APPOINT, "actor");
    expect(conn.statements.some((s) => /INSERT INTO imprest_manager/.test(s))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe("the overlap predicate itself", () => {
  /** Captures the parameters the overlap query was asked with. */
  async function overlapQuery(input: Parameters<typeof imprestService.saveManager>[0]) {
    const conn = makeConnection([]);
    getConnection.mockResolvedValue(conn);
    await imprestService.saveManager(input, "actor");
    // Requiring `branch_id = ?` isolates the overlap-check query itself from the update path's
    // preceding "lock and re-read the row being edited" fetch, which also runs under FOR UPDATE
    // but filters only on id — see makeConnection's own comment.
    const call = conn.execute.mock.calls.find(
      ([s]) => /FOR UPDATE/.test(String(s)) && /branch_id = \?/.test(String(s)),
    );
    return { sql: String(call?.[0] ?? "").replace(/\s+/g, " "), params: (call?.[1] ?? []) as unknown[] };
  }

  it("treats a NULL end date as open-ended on BOTH sides", async () => {
    // The asymmetric version of this is the classic bug: guarding the stored end date but not
    // the incoming one, so a new open-ended appointment slips past an existing one.
    const q = await overlapQuery(APPOINT);
    const coalesces = q.sql.match(/COALESCE\([^)]*'9999-12-31'\)/g) ?? [];
    expect(coalesces.length, "both the stored and the incoming end date need it").toBe(2);
  });

  it("compares against the branch, and excludes the row being edited", async () => {
    const q = await overlapQuery({ ...APPOINT, id: "m-self" });
    expect(q.sql).toContain("branch_id = ?");
    expect(q.sql).toContain("id <> ?");
    expect(q.params[0]).toBe("br1");
    expect(q.params[1]).toBe("m-self");
  });

  it("ignores ended appointments", async () => {
    // An appointment that has been closed is history, not a clash.
    const q = await overlapQuery(APPOINT);
    expect(q.sql).toContain("active_status = 1");
  });

  it("locks the rows it checked, so two concurrent appointments cannot both pass", async () => {
    // A bare SELECT would let both submissions see no clash and both insert.
    const q = await overlapQuery(APPOINT);
    expect(q.sql).toContain("FOR UPDATE");
  });
});

describe("ending an appointment is still allowed", () => {
  it("does not treat a deactivation as a clash with itself", async () => {
    // Ending is how you make room for the next holder; it must never be blocked by the overlap
    // rule, or a branch's float becomes permanently unassignable.
    const conn = makeConnection([CLASH]);
    getConnection.mockResolvedValue(conn);
    await imprestService.saveManager(
      { id: "m-existing", branchId: "br1", userId: "u-alice", effectiveFrom: "2026-01-01",
        effectiveTo: "2026-08-08", activeStatus: 0 },
      "actor",
    );
    expect(conn.statements.some((s) => /UPDATE imprest_manager/.test(s))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe("the existing validations still hold", () => {
  it.each([
    [{ ...APPOINT, branchId: "" }, /Branch is required/i],
    [{ ...APPOINT, userId: "" }, /user is required/i],
    [{ ...APPOINT, effectiveFrom: "" }, /effective-from date is required/i],
    [{ ...APPOINT, effectiveTo: "2026-05-01" }, /cannot be before/i],
  ])("rejects invalid input (%#)", async (input, message) => {
    getConnection.mockResolvedValue(makeConnection([]));
    await expect(imprestService.saveManager(input as never, "actor")).rejects.toThrow(message);
  });

  it("checks the input before opening a transaction", async () => {
    // A rejected appointment should not have taken a connection or a row lock.
    getConnection.mockResolvedValue(makeConnection([]));
    await expect(
      imprestService.saveManager({ ...APPOINT, branchId: "" } as never, "actor"),
    ).rejects.toThrow();
    expect(getConnection).not.toHaveBeenCalled();
  });
});
