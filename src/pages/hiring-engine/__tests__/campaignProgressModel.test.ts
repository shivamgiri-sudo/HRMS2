/** Per-campaign progress rows: largest drop-off, stalled badge with the server's reason, small-N rates, sorting. */
import { describe, expect, it } from "vitest";
import { CAMPAIGN_COLUMNS, campaignProgressView, sortCampaignRows } from "../command/campaignProgressModel";
import type { CampaignProgress, DriveAnalytics } from "../command/driveCommandTypes";

const st = (o: Partial<CampaignProgress["stages"]> = {}): CampaignProgress["stages"] =>
  ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const cp = (o: Partial<CampaignProgress> = {}): CampaignProgress => ({
  campaignId: "c1", campaignName: "Ahmedabad", campaignStatus: "draft", campaignRequisitionCode: "AHMEDABAD-SBI-1", requisitionId: "r1", requisitionCode: "AHMEDABAD-SBI-1",
  branch: "AHMEDABAD-JALDARSHAN", sourceType: "meta_old", blockers: [], stages: st(), ...o,
});
// Prod, 8 Oct 2026 (default window).
const prodCampaigns: CampaignProgress[] = [
  cp({ stages: st({ leads: 165, fills: 100, screened: 100, qualified: 37, contacted: 78, invited: 78, confirmed: 11 }) }),
  cp({ campaignId: "c2", campaignName: "K7BK night", campaignStatus: "active", campaignRequisitionCode: "REQ-2609-K7BK", requisitionId: "r2", requisitionCode: "REQ-2609-K7BK", branch: "NOIDA-2", sourceType: "meta_live",
    blockers: [{ code: "requisition_closed", text: "REQ-2609-K7BK: requisition is closed, so outreach refuses its leads" }, { code: "no_bmi_link", text: "REQ-2609-K7BK has no BookMyInterview link" }],
    stages: st({ leads: 72, fills: 72, screened: 72, qualified: 64 }) }),
  cp({ campaignId: "c3", campaignName: "DZCV", requisitionId: "r3", requisitionCode: "NOIDA-Onfido-17", campaignRequisitionCode: "REQ-2609-DZCV", branch: "NOIDA-2", stages: st({ leads: 116, contacted: 116, invited: 116, confirmed: 5, arrived: 2 }) }),
];
const a = (campaigns: CampaignProgress[] | undefined): DriveAnalytics => ({ campaigns } as unknown as DriveAnalytics);

describe("campaignProgressView", () => {
  it("one row per campaign and requisition, stalled first, with Live / Old in words", () => {
    const v = campaignProgressView(a(prodCampaigns));
    expect(v.rows.map((r) => r.name)).toEqual(["K7BK night", "Ahmedabad", "DZCV"]);
    expect(v.rows[0]).toMatchObject({ typeLabel: "Live Meta", stalled: true, branch: "NOIDA-2" });
    expect(v.rows[0].stalledWhy).toEqual(["REQ-2609-K7BK: requisition is closed, so outreach refuses its leads", "REQ-2609-K7BK has no BookMyInterview link"]);
    expect(v.stalledCount).toBe(1);
    expect(v.stalledPeople).toBe(64);
  });
  it("the requisition column says when the activity's requisition differs from the campaign's own", () => {
    const v = campaignProgressView(a(prodCampaigns));
    expect(v.rows.find((r) => r.name === "DZCV")!.requisition).toBe("NOIDA-Onfido-17 (campaign: REQ-2609-DZCV)");
    expect(v.rows.find((r) => r.name === "Ahmedabad")!.requisition).toBe("AHMEDABAD-SBI-1");
  });
  it("largest drop-off per row; qualified is skipped when the row has no screened fill in range (older fills)", () => {
    const v = campaignProgressView(a(prodCampaigns));
    expect(v.rows.find((r) => r.name === "DZCV")!.biggestDrop).toEqual({ from: "invited", to: "confirmed", lost: 111, text: "Invited to confirmed: 111 lost" });
    expect(v.rows.find((r) => r.name === "K7BK night")!.biggestDrop).toMatchObject({ from: "qualified", to: "contacted", lost: 64 });
    expect(v.rows.find((r) => r.name === "Ahmedabad")!.biggestDrop).toMatchObject({ from: "leads", to: "qualified", lost: 128 });
  });
  it("rates only from denominators of at least 20; text dash below", () => {
    const v = campaignProgressView(a([cp({ stages: st({ leads: 165, contacted: 78, invited: 78, confirmed: 11 }) }), cp({ campaignId: "x", stages: st({ leads: 12, confirmed: 3 }) })]));
    expect(v.rows[0].texts.leadToConfirmed).toBe("7%");
    expect(v.rows[0].texts.confirmedToArrived).toBe("–"); // 11 confirmed is under the sample
    expect(v.rows[1].texts.leadToConfirmed).toBe("–");
  });
  it("an older server (no blockers field) says the reason is not available; an empty blocker list says none was found", () => {
    const older = campaignProgressView(a([cp({ blockers: undefined, stages: st({ qualified: 3, leads: 3 }) })]));
    expect(older.rows[0].stalledWhy).toEqual(["The reason is not available from this server."]);
    const none = campaignProgressView(a([cp({ blockers: [], stages: st({ qualified: 3, leads: 3, fills: 3, screened: 3 }) })]));
    expect(none.rows[0].stalledWhy).toEqual(["No blocker was found on the campaign or its requisition."]);
  });
  it("filters to one drive type and is empty without campaigns", () => {
    expect(campaignProgressView(a(prodCampaigns), "meta_live").rows.map((r) => r.name)).toEqual(["K7BK night"]);
    expect(campaignProgressView(a(undefined)).empty).toBe(true);
    expect(campaignProgressView(a(prodCampaigns), "he").empty).toBe(true);
  });
});

describe("sortCampaignRows", () => {
  it("sorts numbers (nulls last both ways) and text, on a copy", () => {
    const rows = campaignProgressView(a(prodCampaigns)).rows;
    expect(sortCampaignRows(rows, "leads", "desc").map((r) => r.name)).toEqual(["Ahmedabad", "DZCV", "K7BK night"]);
    expect(sortCampaignRows(rows, "campaign", "asc").map((r) => r.name)).toEqual(["Ahmedabad", "DZCV", "K7BK night"]);
    expect(sortCampaignRows(rows, "leadToConfirmed", "asc").map((r) => r.name)).toEqual(["K7BK night", "DZCV", "Ahmedabad"]);
    expect(rows.map((r) => r.name)).toEqual(["K7BK night", "Ahmedabad", "DZCV"]);
  });
  it("columns cover the brief: campaign, requisition, branch, live/old, the stages and two rates", () => {
    expect(CAMPAIGN_COLUMNS.map((c) => c.key)).toEqual(["campaign", "requisition", "branch", "type", "leads", "qualified", "contacted", "invited", "confirmed", "arrived", "selected", "joined", "leadToConfirmed", "confirmedToArrived"]);
  });
});
