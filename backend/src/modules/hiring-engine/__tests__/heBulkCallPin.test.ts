import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pin (before the unified call step): the manual Bulk calls "Prepare from campaigns" SQL and the result-import writes for a person with no
 * follow-up row, with QUAL_FOLLOWUP_MODE unset (as on prod). The response record writer is mocked away.
 */
const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, events: [] as unknown[][] }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.includes("FROM he_lead WHERE id = ?")) return [[{ id: "L1", mobile10: "9876543210", full_name: "Asha", status: "invited", meta_lead_id: null }]];
      if (q.includes("FROM he_match WHERE lead_id = ? AND state IN")) return [[{ id: "M1", requisition_id: "R1", drive_id: "D1" }]];
      if (q.includes("COUNT(*) AS n FROM he_lead_event")) return [[{ n: 0 }]];
      if (q.startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }), setLeadStatus: vi.fn(), revokeConsent: vi.fn(), persistSignals: vi.fn(),
  findLeadByMobile: vi.fn(), upsertLead: vi.fn(async () => ({ id: "L1", created: false })),
}));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn(async () => ({ status: "sent" })) }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async () => ({ status: "sent" })) }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn() }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(() => false), sendLocationLink: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: vi.fn(async () => ({ id: 1, created: true, dedupeOf: null, conflict: false })) }));

import { prepareRowsFromCampaigns } from "../he-bulk-call-prepare.service.js";
import { applyCallResults } from "../he-call-results.service.js";

beforeEach(() => { h.sqls = []; h.events = []; delete process.env.QUAL_FOLLOWUP_MODE; });

describe("manual bulk-call pin (no follow-up row, mode unset)", () => {
  it("Prepare from campaigns SQL", async () => {
    await prepareRowsFromCampaigns({ campaignIds: ["c1", "c2"] } as never);
    expect(h.sqls).toMatchSnapshot();
  });
  for (const result of ["Confirmed", "No answer", "Busy", "DND"]) {
    it(`result import: ${result}`, async () => {
      await applyCallResults([{ phone: "9876543210", result, call_id: `c-${result}`, duration: 30 }], { userId: "U1" });
      expect({ sqls: h.sqls, events: h.events }).toMatchSnapshot();
    });
  }
});
