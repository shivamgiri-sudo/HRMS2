import { beforeEach, describe, expect, it, vi } from "vitest";

// Every reader that counts no_show timeline events (the 3-per-requisition cap, show-up learning, the control room) skips the ones a
// later arrival at the same drive corrected.
const calls = vi.hoisted(() => [] as string[]);
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => { calls.push(sql.replace(/\s+/g, " ")); return [[]]; }), getConnection: vi.fn() },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-policy.service.js", () => ({ getCoolingOffDays: vi.fn(async () => 30) }));

import { loadEligibilityFacts } from "../he-eligibility.service.js";
import { learnShowUp } from "../he-showup.service.js";
import { countedNoShow } from "../he-no-show-events.js";

const noShowReads = () => calls.filter((s) => s.includes("event_type = 'no_show'"));

beforeEach(() => { calls.length = 0; });

describe("no-show event readers", () => {
  it("eligibility (no-show cap) counts only uncorrected no-shows", async () => {
    await loadEligibilityFacts([{ id: "L1", mobile10: "9876500001", ats_candidate_id: null, status: "contacted", final_status: "none", is_employee: 0, age: null, last_attempt_date: null, walkin_count: 0, last_outcome: null }], { id: "r1", processName: null });
    expect(noShowReads().length).toBe(1);
    for (const s of noShowReads()) expect(s).toContain(countedNoShow("e"));
  });
  it("show-up learning facts count only uncorrected past no-shows", async () => {
    await learnShowUp();
    expect(noShowReads().length).toBeGreaterThan(0);
    for (const s of noShowReads()) expect(s).toContain(countedNoShow("e"));
  });
});
