import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; p: unknown[] }>,
  skipExists: false,
  req: null as Record<string, unknown> | null,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), p });
      if (sql.includes("COUNT(*) AS n FROM he_message")) return [[{ n: 7 }]];
      if (sql.includes("COUNT(*) AS n FROM qualified_followup")) return [[{ n: 3 }]];
      if (sql.includes("FROM job_requisition")) return [h.req ? [h.req] : []];
      if (sql.includes("FROM he_lead_event")) return [h.skipExists ? [{ hit: 1 }] : []];
      return [{ affectedRows: 1 }];
    }),
  },
}));

import { branchFirstContactsToday, istDayBounds, loadRequisitionFacts, recordGuardSkip, sharedWaSentToday } from "../followup-guards.service.js";

const THU_11 = new Date("2026-10-08T05:30:00Z");
beforeEach(() => { h.calls = []; h.skipExists = false; h.req = null; });

describe("followup-guards.service", () => {
  it("istDayBounds gives the IST calendar day as strings, whatever the server zone", () => {
    expect(istDayBounds(THU_11)).toEqual(["2026-10-08 00:00:00", "2026-10-09 00:00:00"]);
    expect(istDayBounds(new Date("2026-10-08T19:00:00Z"))).toEqual(["2026-10-09 00:00:00", "2026-10-10 00:00:00"]); // 00:30 IST Fri
  });

  it("sharedWaSentToday excludes he_walkin_confirmed/he_reschedule_offer/he_optout_ack and counts engine + followup sends", async () => {
    expect(await sharedWaSentToday(THU_11)).toBe(7);
    const { sql, p } = h.calls[0];
    for (const k of ["he_walkin_confirmed", "he_reschedule_offer", "he_optout_ack"]) expect(sql).toContain(`template_key NOT LIKE '${k}:%'`);
    expect(sql).toContain("direction = 'out' AND channel = 'whatsapp'");
    expect(sql).not.toContain("sent_by");
    expect(p).toEqual(["2026-10-08 00:00:00", "2026-10-09 00:00:00"]);
  });

  it("branchFirstContactsToday uses LIKE with the prefix parameter and canary rows only", async () => {
    expect(await branchFirstContactsToday("AHMEDABAD", THU_11)).toBe(3);
    const { sql, p } = h.calls[0];
    expect(sql).toContain("branch_name LIKE ?");
    expect(sql).toContain("mode_at_enqueue = 'canary'");
    expect(p).toContain("AHMEDABAD%");
    expect(p).toContain("2026-10-08 00:00:00");
  });

  it("loadRequisitionFacts maps the row (with the end date) and returns null when absent", async () => {
    expect(await loadRequisitionFacts("R1")).toBeNull();
    h.req = { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 1, requisition_validity: "2026-10-31" };
    expect(await loadRequisitionFacts("R1")).toEqual({ approvalStatus: "approved", activeStatus: 1, closedAt: null, requestedHeadcount: 5, fulfilledHeadcount: 1, validityDate: "2026-10-31" });
  });

  it("recordGuardSkip writes once per row+step+reason per IST day", async () => {
    expect(await recordGuardSkip("F1", "L1", "whatsapp", "wa_budget", THU_11)).toBe(true);
    const ins = h.calls.find((c) => c.sql.startsWith("INSERT INTO he_lead_event"))!;
    expect(ins.p).toEqual(["L1", "followup_skip", "whatsapp", "whatsapp:wa_budget", JSON.stringify({ followupId: "F1" })]);
    const sel = h.calls.find((c) => c.sql.includes("FROM he_lead_event"))!;
    expect(sel.p).toEqual(["L1", "whatsapp:wa_budget", "2026-10-08 00:00:00", "F1"]);
    h.calls = []; h.skipExists = true;
    expect(await recordGuardSkip("F1", "L1", "whatsapp", "wa_budget", THU_11)).toBe(false);
    expect(h.calls.some((c) => c.sql.startsWith("INSERT"))).toBe(false);
  });

  it("recordGuardSkip without a lead writes nothing (he_lead_event needs a lead)", async () => {
    expect(await recordGuardSkip("F1", null, "email", "outside_window", THU_11)).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
});
