import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * listJoiningControlRoomQueue's two performance contracts, both of which are invisible in the
 * response body and so can regress silently while every functional test still passes.
 *
 * 1. ONE snapshot query per page, not one per row. The queue used to Promise.all()
 *    candidateSnapshot() across its 50 ids. That snapshot carries three uncorrelated derived
 *    tables (doc_stats, bgv_checks, dpdp) which MySQL materialises in full on every execution, so
 *    the page paid 150 aggregate scans to render 50 rows. Measured live on 2026-09-03 at 234 ms
 *    x 50 = ~11.7 s of database time, against a 30 s client timeout.
 *
 * 2. The queue's ORDER BY must not span tables. Ordering on
 *    COALESCE(p.updated_at, phr.updated_at, jclr.updated_at, c.updated_at, c.created_at) is
 *    indexable by nothing, so MySQL joined all ~35k candidates into a temp table and filesorted it
 *    to return 50 rows — 26.7 s live, while the same query without the ORDER BY ran in 18 ms.
 *
 * Both are asserted against the SQL actually issued, because both are properties of the plan the
 * database gets, not of the rows that come back.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));

const { listJoiningControlRoomQueue } = await import("../joining-control-room.service.js");

/** 50 ids, the queue's page size — the count is the whole point of the first contract. */
const IDS = Array.from({ length: 50 }, (_, i) => `cand-${String(i).padStart(3, "0")}`);

function sqlOf(call: unknown[]) {
  return String(call[0]).replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("SELECT candidate_id FROM (")) {
      return [IDS.map((id) => ({ candidate_id: id })), []];
    }
    // The batched snapshot read.
    return [IDS.map((id) => ({ candidate_id: id, employee_code: null })), []];
  });
});

describe("the queue reads its page in a fixed number of queries", () => {
  it("issues exactly two queries for a 50-row page: the id list, then one batched snapshot", async () => {
    await listJoiningControlRoomQueue();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("selects every candidate of the page in a single IN, with one bind per id", async () => {
    await listJoiningControlRoomQueue();
    const snapshot = execute.mock.calls.find(([sql]) => String(sql).includes("c.id IN ("))!;
    expect(snapshot).toBeDefined();
    expect(snapshot[1]).toHaveLength(IDS.length);
    // One placeholder per id — never a re-interpolated literal.
    expect(sqlOf(snapshot)).toContain(`c.id IN (${IDS.map(() => "?").join(",")})`);
  });

  it("never issues the single-candidate form while building the page", async () => {
    await listJoiningControlRoomQueue();
    const singles = execute.mock.calls.filter(([sql]) => String(sql).includes("WHERE c.id = ?"));
    expect(singles).toHaveLength(0);
  });

  it("scales the query count with pages, not with rows", async () => {
    await listJoiningControlRoomQueue();
    const first = execute.mock.calls.length;
    execute.mockClear();
    await listJoiningControlRoomQueue();
    expect(execute.mock.calls.length).toBe(first);
    expect(first).toBeLessThan(IDS.length);
  });
});

describe("the queue's ordering stays inside one table per arm", () => {
  it("no longer orders on a COALESCE spanning the joined tables", async () => {
    await listJoiningControlRoomQueue();
    const queue = sqlOf(execute.mock.calls.find(([sql]) => String(sql).includes("SELECT candidate_id FROM ("))!);
    expect(queue).not.toContain("ORDER BY COALESCE(p.updated_at");
  });

  it("orders each arm by its own table's own column", async () => {
    await listJoiningControlRoomQueue();
    const queue = sqlOf(execute.mock.calls.find(([sql]) => String(sql).includes("SELECT candidate_id FROM ("))!);
    expect(queue).toContain("ORDER BY p.updated_at DESC, c.id DESC");
    expect(queue).toContain("ORDER BY phr.updated_at DESC, c.id DESC");
    expect(queue).toContain("ORDER BY jclr.updated_at DESC, c.id DESC");
    expect(queue).toContain("ORDER BY c.updated_at DESC, c.id DESC");
  });

  it("carries a deterministic tie-breaker on the outer sort", async () => {
    // updated_at is second-resolution and these rows arrive by bulk import, so the 50-row cut
    // lands inside a tie group — measured live inside a group of three sharing one timestamp.
    // Without this the page could return a different 50 on each call for unchanged data.
    await listJoiningControlRoomQueue();
    const queue = sqlOf(execute.mock.calls.find(([sql]) => String(sql).includes("SELECT candidate_id FROM ("))!);
    expect(queue).toContain("ORDER BY sort_key DESC, candidate_id DESC");
  });

  it("keeps every arm capped, so no arm can sort the whole table", async () => {
    await listJoiningControlRoomQueue();
    const queue = sqlOf(execute.mock.calls.find(([sql]) => String(sql).includes("SELECT candidate_id FROM ("))!);
    // Four arms plus the outer sort.
    expect(queue.match(/LIMIT 50/g)).toHaveLength(5);
  });
});

describe("the search filter binds once per arm", () => {
  it("passes no bindings when no search term is given", async () => {
    await listJoiningControlRoomQueue();
    const queue = execute.mock.calls.find(([sql]) => String(sql).includes("SELECT candidate_id FROM ("))!;
    expect(queue[1]).toEqual([]);
  });

  it("repeats the four LIKE bindings once for each of the four arms", async () => {
    await listJoiningControlRoomQueue("kumar");
    const queue = execute.mock.calls.find(([sql]) => String(sql).includes("SELECT candidate_id FROM ("))!;
    // 4 columns searched x 4 arms. A mismatch here surfaces as a bind-count error at runtime,
    // which is exactly the failure this locks down.
    expect(queue[1]).toHaveLength(16);
    expect(queue[1]).toEqual(Array(16).fill("%kumar%"));
    expect(sqlOf(queue).match(/c\.full_name LIKE \?/g)).toHaveLength(4);
  });
});
