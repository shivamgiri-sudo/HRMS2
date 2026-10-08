import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit item 19: the page's Client / Search filters, resolved to process ids so CEO Overview,
 * Live P&L, the YTD strip and the trend charts can narrow to the same population as the header.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { NO_MATCHING_PROCESS, narrowProcessScope, resolveClientSearchProcessIds } from "../pnl-client-search-scope.js";

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

describe("resolveClientSearchProcessIds", () => {
  it("returns null — no narrowing, no query — when neither filter is set", async () => {
    expect(await resolveClientSearchProcessIds({})).toBeNull();
    expect(await resolveClientSearchProcessIds({ clientId: " ", search: "" })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses the header's own predicates (client id, LIKE over process/code/client/branch, active processes)", async () => {
    execute.mockResolvedValueOnce([[{ id: "p1" }, { id: "p2" }], []]);
    const ids = await resolveClientSearchProcessIds({ clientId: "c1", search: "onfido" });
    expect(ids).toEqual(["p1", "p2"]);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("COALESCE(p.active_status, 1) = 1");
    expect(String(sql)).toContain("p.client_id = ?");
    expect(String(sql)).toContain("(p.process_name LIKE ? OR p.process_code LIKE ? OR cm.client_name LIKE ? OR bm.branch_name LIKE ?)");
    expect(params).toEqual(["c1", "%onfido%", "%onfido%", "%onfido%", "%onfido%"]);
  });

  it("returns a no-match sentinel, never an empty list, when nothing matches", async () => {
    // An empty process list means "no filter" to every CeoScope consumer — it would show everything.
    expect(await resolveClientSearchProcessIds({ search: "zzz" })).toEqual([NO_MATCHING_PROCESS]);
  });
});

describe("narrowProcessScope", () => {
  it("never widens: intersects with an existing process scope", () => {
    expect(narrowProcessScope(["p1", "p9"], ["p1", "p2"])).toEqual(["p1"]);
    expect(narrowProcessScope(["p9"], ["p1", "p2"])).toEqual([NO_MATCHING_PROCESS]);
  });

  it("passes the base through when no client/search filter is set, and uses the match when there is no base", () => {
    expect(narrowProcessScope(["p1"], null)).toEqual(["p1"]);
    expect(narrowProcessScope([], null)).toEqual([]);
    expect(narrowProcessScope([], ["p1", "p2"])).toEqual(["p1", "p2"]);
  });
});
