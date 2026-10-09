import { beforeEach, describe, expect, it, vi } from "vitest";

/** Deploy window: the code can serve before migration 2138 (journey_state, followup_person). The engine must keep inviting with the old
 *  (legacy) skip, log one clear error, and never stop. Simulates ER_BAD_FIELD_ERROR / ER_NO_SUCH_TABLE from MySQL. */
const h = vi.hoisted(() => ({
  sqls: [] as string[], missing: "none" as "none" | "column" | "table",
  noShowRows: [] as Array<Record<string, unknown>>, suggested: [] as Array<Record<string, unknown>>,
  send: vi.fn(async () => ({ status: "sent" })), email: vi.fn(async () => ({ status: "sent" })), error: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push(q);
      if (h.missing === "column" && q.includes("journey_state")) throw Object.assign(new Error("Unknown column 'qf.journey_state' in 'where clause'"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
      if (h.missing === "table" && q.includes("followup_person")) throw Object.assign(new Error("Table 'mas_hrms.followup_person' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
      if (q.includes("m.slot_at < DATE_SUB(NOW(), INTERVAL 120 MINUTE)")) return [h.noShowRows];
      if (q.includes("COUNT(*) AS n FROM he_match WHERE lead_id = ? AND state = 'no_show'")) return [[{ n: 1 }]];
      if (q.includes("WHERE m.drive_id = ? AND m.state = 'suggested'")) return [h.suggested];
      return [[]];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { error: h.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: h.send }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: h.email }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: vi.fn(async () => null) }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), setLeadStatus: vi.fn(), hasConsent: vi.fn(async () => true) }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));

import { inviteForDrive, runFollowUps } from "../he-engine.service.js";
import { _resetFollowupSchemaLog } from "../followup-schema-guard.js";
import { followupOwnedExpr } from "../qualified-followup.policy.js";

beforeEach(() => { h.sqls = []; h.missing = "none"; h.noShowRows = []; h.suggested = []; h.send.mockClear(); h.email.mockClear(); h.error.mockClear(); _resetFollowupSchemaLog(); });

describe("engine skip statements fail SAFE and loud before migration 2138", () => {
  it("journey_state missing: every follow-up statement re-runs with the legacy skip, the tick completes, one clear error is logged", async () => {
    h.missing = "column";
    h.noShowRows = [{ id: "M2", lead_id: "L2", drive_id: "D1", followup_owned: 0 }];
    await expect(runFollowUps({ dryRun: false })).resolves.toBeDefined();
    const legacy = h.sqls.filter((s) => s.includes("qualified_followup qf") && !s.includes("journey_state"));
    expect(legacy.length).toBeGreaterThanOrEqual(6); // voice, replacement, WhatsApp step, 2 reminders, no-shows, catch-up
    expect(legacy.every((s) => s.includes("qf.stopped_reason IS NULL") && s.includes("qf.mode_at_enqueue = 'live'"))).toBe(true);
    expect(h.send).toHaveBeenCalled(); // the no-show recovery still went out
    expect(h.error).toHaveBeenCalledTimes(1);
    expect(String(h.error.mock.calls[0][1])).toMatch(/migration 2138/);
    await runFollowUps({ dryRun: false });
    expect(h.error).toHaveBeenCalledTimes(1); // once, not every statement / tick
  });
  it("followup_person missing: first invites still go out without the 7-day hold", async () => {
    h.missing = "table";
    h.suggested = [{ id: "M1", lead_id: "L1", full_name: "Asha", mobile10: "9876543210", dormant: 0, has_email: 0, email_on: 1, whatsapp_on: 1, has_consent: 1 }];
    const r = await inviteForDrive("D1", { dryRun: true, max: 5 });
    expect(r.considered).toBe(1);
    const sel = h.sqls.filter((s) => s.includes("WHERE m.drive_id = ? AND m.state = 'suggested'"));
    expect(sel).toHaveLength(2);
    expect(sel[1]).not.toContain("followup_person");
    expect(h.error).toHaveBeenCalledTimes(1);
  });
  it("any other database error is not swallowed", async () => {
    const { db } = await import("../../../db/mysql.js");
    vi.mocked(db.execute).mockRejectedValueOnce(Object.assign(new Error("Lock wait timeout"), { code: "ER_LOCK_WAIT_TIMEOUT" }));
    await expect(inviteForDrive("D1", { dryRun: true, max: 5 })).rejects.toThrow(/Lock wait/);
  });
  it("a stopped (or legacy) row never counts as owned (D: stopped_reason IS NULL like main)", () => {
    const e = followupOwnedExpr({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" });
    expect(e).toContain("qf.stopped_reason IS NULL");
    expect(followupOwnedExpr({ mobileExpr: "l.mobile10", requisitionExpr: "m.requisition_id" }, true)).not.toContain("journey_state");
  });
});
