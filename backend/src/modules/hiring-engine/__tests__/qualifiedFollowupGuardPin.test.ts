import { beforeEach, describe, expect, it, vi } from "vitest";

// PIN (selection criteria S14, before the criteria guard): today's stop decisions and every statement runStopChecks issues.
// With no criteria fact (and SELECTION_FOLLOWUP_GUARD unset) this must stay identical. Never edit.
const { calls, rows } = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, rows: [] as Array<Record<string, unknown>> }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { calls.push([sql.replace(/\s+/g, " ").trim(), p]); return /^\s*SELECT qf\.id/.test(sql) ? [rows] : [{ affectedRows: 1 }]; }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { decideStop } from "../qualified-followup.rules.js";
import { runStopChecks } from "../qualified-followup.stops.js";

const row = (id: string, o: Record<string, unknown> = {}) => ({ id, mobile10: "9876543210", email: "a@b.com", lead_status: "new", consent_revoked: 0, he_replied: 0, meta_replied: 0, ats_stage: null,
  jr_id: "r1", approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 10, fulfilled_headcount: 0, ...o });

beforeEach(() => { calls.length = 0; rows.length = 0; });

describe("follow-up stop checks pin", () => {
  it("decideStop for today's facts", () => {
    const base = { optedOut: false, repliedSinceQualified: false, requisitionClosed: null, joined: false, hasMobile: true, hasEmail: true };
    const table = [base, { ...base, optedOut: true }, { ...base, repliedSinceQualified: true }, { ...base, requisitionClosed: "requisition is closed" }, { ...base, joined: true },
      { ...base, hasMobile: false, hasEmail: false }, { ...base, optedOut: true, joined: true }, { ...base, hasMobile: false }];
    expect(table.map((f) => decideStop(f))).toMatchSnapshot();
  });
  it("runStopChecks statements and stops for a page of rows", async () => {
    rows.push(row("a"), row("b", { lead_status: "opted_out" }), row("c", { he_replied: 1 }), row("d", { approval_status: "closed" }), row("e", { ats_stage: "joined" }),
      row("f", { mobile10: "123", email: "" }), row("g", { jr_id: null }), row("h", { fulfilled_headcount: 10 }));
    const out = await runStopChecks("live", 500);
    expect({ out, calls }).toMatchSnapshot();
  });
});
