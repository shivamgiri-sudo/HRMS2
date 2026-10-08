import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

import { collectFunnelFacts, type FunnelFactsInput } from "../he-drive-insight-funnel-facts.service.js";
import { INSIGHT_DEFAULTS } from "../he-drive-insights.js";
import type { CampaignProgress } from "../he-drive-persons.service.js";

const T = { ...INSIGHT_DEFAULTS };
const grid = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
const st = (o: Partial<CampaignProgress["stages"]> = {}): CampaignProgress["stages"] =>
  ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const cp = (o: Partial<CampaignProgress> = {}): CampaignProgress => ({
  campaignId: "c1", campaignName: "Ahmedabad", campaignStatus: "draft", campaignRequisitionCode: "REQ-1", requisitionId: "r1", requisitionCode: "REQ-1", branch: "AHMEDABAD",
  sourceType: "meta_old", blockers: [], stages: st(), ...o,
});
const input = (o: Partial<FunnelFactsInput> = {}): FunnelFactsInput => ({
  journey: null, campaigns: [], openSeats: [], replies: { meta_live: grid(), meta_old: grid(), he: grid() }, arrivals: { meta_live: grid(), meta_old: grid(), he: grid() },
  cost: null, from: "2026-09-25", to: "2026-10-08", t: T, ...o,
});

beforeEach(() => { vi.clearAllMocks(); execute.mockResolvedValue([[]]); });

describe("collectFunnelFacts", () => {
  it("builds the facts from what the analytics build already holds, with no read when no campaign fails screening", async () => {
    const replies = grid(); replies[1][11] = 7; replies[2][15] = 3;
    const failed: string[] = [];
    const f = await collectFunnelFacts(input({
      journey: { meta_live: { leads: 9, fills: 9, screened: 9, qualified: 8, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0 },
        meta_old: { leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0 },
        he: { leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0 } },
      campaigns: [cp({ stages: st({ leads: 40, fills: 40, screened: 40, qualified: 30 }), blockers: [{ code: "no_bmi_link", text: "x" }] }), cp({ campaignId: null, campaignName: "No campaign", stages: st({ leads: 2 }) })],
      openSeats: [{ requisitionId: "r1", code: "REQ-1", branch: "AHMEDABAD", open: 32, closedReason: null }],
      replies: { meta_live: grid(), meta_old: replies, he: grid() }, cost: { meta_live: { perJoin: 100, joined: 6 }, meta_old: { perJoin: null, joined: 0 }, he: { perJoin: null, joined: 0 } },
    }), failed);
    expect(execute).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
    expect(f.journey?.meta_live.qualified).toBe(8);
    expect(f.campaigns).toEqual([
      expect.objectContaining({ key: "c1", name: "Ahmedabad", requisitionId: "r1", code: "REQ-1", branch: "AHMEDABAD", sourceType: "meta_old", leads: 40, screened: 40, qualified: 30, blockers: [{ code: "no_bmi_link", text: "x" }] }),
      expect.objectContaining({ key: "none", name: "No campaign", leads: 2 }),
    ]);
    expect(f.openSeats).toEqual([{ requisitionId: "r1", code: "REQ-1", branch: "AHMEDABAD", open: 32 }]);
    expect(f.replyPeak.meta_old).toEqual({ hour: 11, n: 7, total: 10 });
    expect(f.arrivalPeak.he.total).toBe(0);
    expect(f.cost?.meta_live).toEqual({ perJoin: 100, joined: 6 });
  });
  it("reads the top disqualify reasons only for campaigns that fail screening, by campaign and window, grouping by the rule text", async () => {
    execute.mockResolvedValue([[
      { campaign_id: "c1", reason: "Age 17 below minimum 18", n: 4 }, { campaign_id: "c1", reason: "Age 16 below minimum 18", n: 3 },
      { campaign_id: "c1", reason: "DRA certification required but candidate answered: \"No\"", n: 20 }, { campaign_id: "c1", reason: null, n: 1 },
    ]]);
    const f = await collectFunnelFacts(input({ campaigns: [cp({ stages: st({ leads: 40, fills: 40, screened: 40, qualified: 5 }) }), cp({ campaignId: "c2", stages: st({ screened: 40, qualified: 30 }) })] }), []);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql.replace(/\s+/g, " ").trim()).toBe("SELECT /*+ MAX_EXECUTION_TIME(8000) */ r.campaign_id, r.disqualification_reason AS reason, COUNT(*) AS n FROM meta_lead_raw r WHERE r.campaign_id IN (?) AND r.created_at >= ? AND r.created_at < ? AND r.screening_result = 'disqualified' GROUP BY r.campaign_id, r.disqualification_reason");
    expect(params).toEqual(["c1", "2026-09-25 00:00:00", "2026-10-09 00:00:00"]);
    expect(f.campaigns[0].disqualify).toEqual([{ reason: "DRA certification required but candidate answered", n: 20 }, { reason: "Age", n: 7 }, { reason: "Not recorded", n: 1 }]);
    expect(f.campaigns[1].disqualify).toBeUndefined();
  });
  it("a failing reasons read flags insight:screening and keeps every other fact", async () => {
    execute.mockRejectedValue(Object.assign(new Error("boom 9876543210"), { code: "ER_X" }));
    const failed: string[] = [];
    const f = await collectFunnelFacts(input({ campaigns: [cp({ stages: st({ screened: 40, qualified: 5 }) })] }), failed);
    expect(failed).toEqual(["insight:screening"]);
    expect(f.campaigns).toHaveLength(1);
    expect(JSON.stringify(logError.mock.calls)).not.toContain("9876543210");
  });
});
