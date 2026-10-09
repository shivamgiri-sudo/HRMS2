import { describe, expect, it } from "vitest";
import {
  actionError, ageText, canWriteHe, channelCounts, confidenceText, confirmPrompt, defaultResponseFilters, filtersQuery, listPath, listRequest, masked, parseResponsesHash, queueBuckets,
  responsesHash, summaryPath, summaryRequest, whenText, withoutRow, QUEUE_ACTIONS, type ResponseFilters,
} from "../responses/responsesModel";
import { campaignOptions, nextDrives } from "../responses/nextDriveModel";

const NOW = new Date("2026-10-08T06:30:00Z"); // 12:00 IST
const RID = "11111111-1111-1111-1111-111111111111";

describe("filters and the URL hash", () => {
  it("defaults to the last 7 days (IST)", () => {
    expect(defaultResponseFilters(NOW)).toMatchObject({ from: "2026-10-02", to: "2026-10-08", channel: "", q: "" });
  });
  it("round-trips through #responses?... but the mobile search never enters the URL or hash", () => {
    const f: ResponseFilters = { ...defaultResponseFilters(NOW), requisitionId: RID, channel: "whatsapp", answer: "confirm", status: "needs_review", driveType: "meta_live", q: "9876543210" };
    expect(parseResponsesHash(responsesHash(f), NOW)).toEqual({ ...f, q: "" });
    expect(responsesHash(f)).toBe(`#responses?from=2026-10-02&to=2026-10-08&requisitionId=${RID}&driveType=meta_live&channel=whatsapp&answer=confirm&status=needs_review`);
    expect(parseResponsesHash("#responses?q=9876543210", NOW).q).toBe("");
  });
  it("a search goes in a POST body, never in the request URL", () => {
    const f: ResponseFilters = { ...defaultResponseFilters(NOW), channel: "web", q: "9876543210" };
    const l = listRequest(f, "abc=");
    expect(l).toEqual({ method: "post", path: "/api/he/responses/search", body: { from: "2026-10-02", to: "2026-10-08", channel: "web", q: "9876543210", cursor: "abc=", limit: 50 } });
    expect(summaryRequest(f)).toEqual({ method: "post", path: "/api/he/responses/summary/search", body: { from: "2026-10-02", to: "2026-10-08", channel: "web", q: "9876543210" } });
    expect(listPath(f)).not.toContain("9876543210");
    expect(summaryPath(f)).not.toContain("9876543210");
    const g = { ...f, q: "" };
    expect(listRequest(g, null)).toEqual({ method: "get", path: listPath(g, null) });
    expect(summaryRequest(g)).toEqual({ method: "get", path: summaryPath(g) });
  });
  it("unknown or malformed values fall back; reversed dates reset the range", () => {
    const f = parseResponsesHash("#responses?channel=fax&answer=maybe&requisitionId=x&from=2026-02-30&q=12", NOW);
    expect(f).toEqual(defaultResponseFilters(NOW));
    expect(parseResponsesHash("#responses?from=2026-10-08&to=2026-10-01", NOW)).toMatchObject({ from: "2026-10-02", to: "2026-10-08" });
    expect(parseResponsesHash("#responses", NOW)).toEqual(defaultResponseFilters(NOW));
  });
  it("API paths carry only the set filters", () => {
    const f = { ...defaultResponseFilters(NOW), channel: "web" as const };
    expect(filtersQuery(f)).toBe("from=2026-10-02&to=2026-10-08&channel=web");
    expect(listPath(f, "abc=")).toBe("/api/he/responses?from=2026-10-02&to=2026-10-08&channel=web&cursor=abc%3D&limit=50");
    expect(summaryPath(f)).toBe("/api/he/responses/summary?from=2026-10-02&to=2026-10-08&channel=web");
  });
});

describe("display helpers", () => {
  it("write roles only: ceo and recruiter are view-only", () => {
    expect(canWriteHe(["hr"])).toBe(true);
    expect(canWriteHe(["super_admin"])).toBe(true);
    expect(canWriteHe(["ceo"])).toBe(false);
    expect(canWriteHe(["recruiter"])).toBe(false);
    expect(canWriteHe(null)).toBe(false);
  });
  it("masks a number that arrives unmasked; keeps a masked one", () => {
    expect(masked("9876543210")).toBe("xxxxxx3210");
    expect(masked("xxxxxx3210")).toBe("xxxxxx3210");
    expect(masked(null)).toBe("xxxxxx");
  });
  it("times and ages", () => {
    expect(whenText("2026-10-08 14:05:00")).toBe("8 Oct, 14:05");
    expect(whenText("2026-10-09")).toBe("9 Oct");
    expect(whenText(null)).toBe("–");
    const now = NOW.getTime();
    expect([ageText("2026-10-08 11:20:00", now), ageText("2026-10-08 09:00:00", now), ageText("2026-10-05 12:00:00", now), ageText("2026-10-09 12:00:00", now)]).toEqual(["40 min", "3 h", "3 days", "–"]);
    expect([confidenceText(0.6), confidenceText(null)]).toEqual(["60% sure", ""]);
  });
  it("channel counts keep every channel, zeros included", () => {
    const rows = channelCounts({ byChannel: { whatsapp: { responses: 3, confirms: 1, people: 2 } } as never, rateByChannel: {} as never, rateByType: {} as never, byDrive: [] });
    expect(rows.map((r) => [r.channel, r.responses])).toEqual([["email", 0], ["web", 0], ["whatsapp", 3], ["voice_bot", 0], ["call_file", 0], ["hr", 0]]);
    expect(channelCounts(null).every((r) => r.responses === 0)).toBe(true);
  });
});

describe("review queue helpers", () => {
  const row = { matchId: null as string | null, person: { name: "Asha V.", mobileMasked: "xxxxxx3210" }, slotAt: "2026-10-09 10:30:00" };
  it("a Confirm that would book a slot asks first; other answers and a booked person do not", () => {
    expect(confirmPrompt(row, QUEUE_ACTIONS[0])).toBe("This books a walk-in slot for Asha V. (asked for 9 Oct, 10:30). Continue?");
    expect(confirmPrompt({ ...row, matchId: "M1" }, QUEUE_ACTIONS[0])).toBeNull();
    expect(confirmPrompt(row, QUEUE_ACTIONS[1])).toBeNull();
    expect(confirmPrompt(row, QUEUE_ACTIONS[4])).toBeNull();
  });
  it("optimistic removal puts the row back at its place", () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const cut = withoutRow(rows, 2);
    expect(cut.rows.map((r) => r.id)).toEqual([1, 3]);
    expect(cut.restore(cut.rows).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(cut.restore([{ id: 2 }]).map((r) => r.id)).toEqual([2]);
  });
  it("errors in words; 409 says someone else handled it", () => {
    expect(actionError({ status: 409 })).toMatch(/already handled/);
    expect(actionError({ status: 403 })).toMatch(/view replies but not change/);
    expect(actionError({ status: 404, message: "Requisition not found" })).toBe("Requisition not found");
    expect(actionError(null)).toBe("Could not save. Please try again.");
  });
  it("age buckets", () => {
    expect(queueBuckets({ total: 4, under1h: 1, h1to4: 0, h4to24: 2, over24h: 1 }).map((b) => b.n)).toEqual([1, 0, 2, 1]);
  });
});

describe("next drive and campaign pickers", () => {
  it("upcoming drives (today .. 14 days, not closed), soonest first, labelled", () => {
    const d = nextDrives([
      { id: "a", drive_date: "2026-10-10", status: "active", branch_name: "PUNE", requisition_code: "R1", designation_name: "Agent", confirmed: "3" },
      { id: "b", drive_date: "2026-10-08", status: "draft", branch_name: "PUNE", requisition_code: "R2", designation_name: "Agent", confirmed: 0 },
      { id: "c", drive_date: "2026-10-07", status: "active" }, { id: "d", drive_date: "2026-10-09", status: "closed" }, { id: "e", drive_date: "2026-10-30", status: "active" },
    ], "2026-10-08");
    expect(d.map((x) => x.id)).toEqual(["b", "a"]);
    expect(d[0].label).toBe("Today · PUNE · R2 Agent (0 confirmed)");
    expect(nextDrives(null, "2026-10-08")).toEqual([]);
  });
  it("campaign options", () => {
    expect(campaignOptions([{ campaignId: "C1", campaignName: "AHM" }, { campaignName: "x" }])).toEqual([{ id: "C1", label: "AHM" }]);
  });
});
