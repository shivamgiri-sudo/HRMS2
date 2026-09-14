import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Searching the cost-centre master by CLIENT name has to work.
 *
 * The list query already DISPLAYED the client — `COALESCE(cl.client_name, cc.client_name)` —
 * but searched only the JOINED `cl.client_name`. `cost_centre_master.client_id` is NULL on all
 * ~940 rows, so that join yields NULL and the clause can never match. The screen was showing a
 * client name it refused to search on.
 *
 * Reported 2026-09-08 as "Satya Retails is not showing in mas_hrms". The row
 * (BSS/OB/Noida/1045 / SATYA E-COM SERVICES LIMITED) had been imported that morning and was
 * sitting in the table; typing "Satya" filtered it away. A search that answers "no such record"
 * about a record it is displaying is worse than a slow one — the user's next move is to create
 * a duplicate.
 *
 * The same reasoning covers `cc.process_name_bill`: `process_id` is set on 24 of 937 rows, so
 * the joined process name is almost always NULL while the billing campaign name is the one
 * people actually type.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));

const { costCentreService } = await import("../org.service.js");

function listQuery() {
  const call = dbExecute.mock.calls.find(([sql]) => /FROM cost_centre_master cc/i.test(String(sql)));
  return { sql: String(call?.[0] ?? ""), params: (call?.[1] ?? []) as unknown[] };
}

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockResolvedValue([[], []]);
});

describe("cost centre free-text search", () => {
  it("searches the cost centre's OWN client columns, not just the joined client table", async () => {
    await costCentreService.list({ q: "Satya" });
    const { sql, params } = listQuery();

    expect(sql).toMatch(/cc\.cost_centre_name LIKE \?/);
    expect(sql).toMatch(/cc\.cost_centre_code LIKE \?/);
    expect(sql).toMatch(/cl\.client_name LIKE \?/);
    // The three that were missing, and the reason the row could not be found.
    expect(sql).toMatch(/cc\.client_name LIKE \?/);
    expect(sql).toMatch(/cc\.billing_client_name LIKE \?/);
    expect(sql).toMatch(/cc\.process_name_bill LIKE \?/);

    // One bound parameter per searched column, all carrying the same term. A mismatch here
    // shifts every later filter's parameter by one, which MySQL reports as a type error far
    // from the cause.
    expect(params.filter((p) => p === "%Satya%")).toHaveLength(7);
  });

  it("keeps every search term inside one OR group so the active filter still binds", async () => {
    await costCentreService.list({ q: "Satya" });
    const { sql } = listQuery();
    // Without the parentheses `active_status = 1 AND a OR b` binds as
    // `(active_status = 1 AND a) OR b` and quietly returns inactive cost centres.
    expect(sql).toMatch(/\(cc\.cost_centre_name LIKE \?[\s\S]*cc\.process_name_bill LIKE \?\)/);
    expect(sql).toMatch(/cc\.active_status = 1 AND \(/);
  });

  it("passes the branch filter through alongside the search, in the right order", async () => {
    await costCentreService.list({ q: "Satya", branch_id: "branch-noida" });
    const { sql, params } = listQuery();
    expect(sql).toMatch(/cc\.branch_id = \?/);
    // The branch id must land AFTER the seven search terms, not among them.
    expect(params[params.length - 1]).toBe("branch-noida");
    expect(params.filter((p) => p === "%Satya%")).toHaveLength(7);
  });

  it("adds no search clause at all when no term is given", async () => {
    await costCentreService.list({});
    const { sql, params } = listQuery();
    expect(sql).not.toMatch(/LIKE \?/);
    expect(params).toHaveLength(0);
  });
});
