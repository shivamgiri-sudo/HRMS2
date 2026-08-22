import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * processService.list() ignored branch_id entirely (found during the CEO Overview
 * branch-filter investigation, commit a0460152 — same bug pattern, different page).
 *
 * The route layer (org.routes.ts buildCrud, used for GET /api/org/processes) has forwarded
 * req.query.branch_id into options.branch_id all along, and ListOptions already declared
 * branch_id — costCentreService.list() (same file, immediately above) already applies it as
 * "cc.branch_id = ?". processService.list() never destructured it, so every caller that asked
 * for processes scoped to one branch (GRN Search's Process dropdown, the P&L Master Control
 * Center's Process dropdowns) silently got every branch's processes back instead.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let processService: typeof import("../org.service.js")["processService"];
beforeAll(async () => {
  ({ processService } = await import("../org.service.js"));
}, 120_000);

beforeEach(() => execute.mockReset());

/** Captures the SQL and bound params the list actually issues. */
function captureSql() {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    seen.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    return [[], []];
  });
  return seen;
}

describe("processService.list — branch scoping", () => {
  it("applies no branch filter when branch_id is not supplied", async () => {
    // pm.branch_id legitimately appears in the JOIN (bm.id = pm.branch_id) — the assertion is
    // scoped to the WHERE-clause filter form, not the JOIN, so it doesn't false-fail on that.
    const seen = captureSql();
    await processService.list({});
    const call = seen.find((s) => /FROM process_master/.test(s.sql));
    expect(call?.sql).not.toContain("pm.branch_id = ?");
  });

  it("filters on pm.branch_id when branch_id is supplied", async () => {
    const seen = captureSql();
    await processService.list({ branch_id: "branch-123" });
    const call = seen.find((s) => /FROM process_master/.test(s.sql));
    expect(call?.sql).toContain("pm.branch_id = ?");
    expect(call?.params).toContain("branch-123");
  });

  it("combines the branch filter with the existing search filter rather than replacing it", async () => {
    const seen = captureSql();
    await processService.list({ branch_id: "branch-123", q: "onfido" });
    const call = seen.find((s) => /FROM process_master/.test(s.sql));
    expect(call?.sql).toContain("pm.branch_id = ?");
    expect(call?.sql).toMatch(/pm\.process_name LIKE \?/);
  });
});
