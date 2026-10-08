import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Task 13: every engine send skips people the follow-up method owns (row-based); marking and hygiene still run. D8 in he-send / voice. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  noShowRows: [] as Array<Record<string, unknown>>,
  req: { approval_status: "pending_approval", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0 },
  send: vi.fn(async () => ({ status: "sent" })), email: vi.fn(async () => ({ status: "sent" })), other: vi.fn(async () => null),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.startsWith("SELECT m.id, m.lead_id, m.drive_id") && q.includes("m.slot_at < DATE_SUB(NOW(), INTERVAL 120 MINUTE)")) return [h.noShowRows];
      if (q.includes("COUNT(*) AS n FROM he_match WHERE lead_id = ? AND state = 'no_show'")) return [[{ n: 1 }]];
      return [[]];
    }),
  },
}));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: h.send }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: h.email }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: h.other }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), setLeadStatus: vi.fn(), hasConsent: vi.fn(async () => true) }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));

import { inviteForDrive, runFollowUps } from "../he-engine.service.js";
import { firstContactHoldSql, followupOwnedExpr, followupSkipSql, LEAD_MOBILE_OF_MATCH } from "../qualified-followup.policy.js";

const SKIP_SUB = followupSkipSql({ mobileExpr: LEAD_MOBILE_OF_MATCH, requisitionExpr: "m.requisition_id" });
const sel = (re: RegExp) => h.sqls.filter((s) => re.test(s.sql));
beforeEach(() => { h.sqls = []; h.noShowRows = []; h.send.mockClear(); h.email.mockClear(); h.other.mockClear(); delete process.env.QUAL_FOLLOWUP_MODE; });
afterEach(() => { delete process.env.QUAL_FOLLOWUP_MODE; });

describe("engine senders skip owned people", () => {
  it("reminders, voice calls, replacement slots and the no-show email catch-up carry the row-based skip", async () => {
    await runFollowUps({ dryRun: false });
    expect(sel(/WHERE m.state = 'confirmed' AND m.slot_at BETWEEN/).every((s) => s.sql.includes(SKIP_SUB.trim()))).toBe(true);
    expect(sel(/WHERE m.state = 'invited' AND m.slot_at > NOW\(\) AND \( -- normal cadence|WHERE m.state = 'invited' AND m.slot_at > NOW\(\) AND \(/)[0].sql).toContain(SKIP_SUB.trim());
    expect(sel(/WHERE m.state = 'slot_released'/)[0].sql).toContain(SKIP_SUB.trim());
    expect(sel(/WHERE m.state = 'no_show' AND m.slot_at > DATE_SUB/)[0].sql).toContain(followupSkipSql({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" }).trim());
  });
  it("no-show marking still runs for an owned person, but the engine's T6 + email are not sent", async () => {
    h.noShowRows = [{ id: "M1", lead_id: "L1", drive_id: "D1", followup_owned: 1 }, { id: "M2", lead_id: "L2", drive_id: "D1", followup_owned: 0 }];
    await runFollowUps({ dryRun: false });
    expect(sel(/UPDATE he_match SET state = 'no_show' WHERE id = \?/).map((s) => s.p[0])).toEqual(["M1", "M2"]);
    expect(h.send.mock.calls.map((c) => (c[0] as { matchId: string }).matchId)).toEqual(["M2"]);
    expect(h.email.mock.calls.map((c) => c[1])).toEqual(["M2"]);
    expect(sel(/m.slot_at < DATE_SUB\(NOW\(\), INTERVAL 120 MINUTE\)/)[0].sql).toContain(`${followupOwnedExpr({ mobileExpr: LEAD_MOBILE_OF_MATCH, requisitionExpr: "m.requisition_id" })} AS followup_owned`);
  });
  it("other-role offers exclude owned people", async () => {
    await runFollowUps({ dryRun: false });
    expect(h.other).toHaveBeenCalledWith(expect.objectContaining({ scope: "exclude_enrolled" }));
  });
  it("first contacts wait out the 7-day re-contact hold", async () => {
    await inviteForDrive("D1", { dryRun: true, max: 5 });
    expect(sel(/FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.drive_id = \?/)[0].sql).toContain(firstContactHoldSql({ mobileExpr: "l.mobile10" }).trim());
  });
  it("after rollback to off the skip is the same (row-based)", async () => {
    await runFollowUps({ dryRun: false }); const a = h.sqls.map((s) => s.sql);
    h.sqls = []; process.env.QUAL_FOLLOWUP_MODE = "live";
    await runFollowUps({ dryRun: false });
    expect(h.sqls.map((s) => s.sql)).toEqual(a);
  });
});
