import { describe, expect, it } from "vitest";
import { pipelineStages, whenIst, windowBanner, type PipelineSource, type PipelineView } from "../pipelineFunnelModel";

const src = (o: Partial<PipelineSource> = {}): PipelineSource => ({ sourceType: "meta_old", label: "Old Meta data", enrolled: 200, emailed: 100, whatsapped: 0, called: 0, engaged: 10, confirmed: 5, arrived: 0, stopped: 0, waiting: { email: 100, whatsapp: 200, call: 200 }, lastEmailAt: null, lastWhatsappAt: null, ...o });
const view = (o: Partial<PipelineView> = {}): PipelineView => ({ generatedAt: "2026-10-11T10:00:00.000Z", windowOpen: false, nextWindowOpen: "2026-10-12T03:30:00.000Z", last24h: { emails: 0, whatsapps: 0, callResults: 0, replies: 0, confirmations: 0 }, sources: [src()], ...o });

describe("pipelineStages", () => {
  it("is a percentage of everyone enrolled, in journey order", () => {
    const s = pipelineStages(src());
    expect(s.map((x) => x.key)).toEqual(["enrolled", "emailed", "whatsapped", "called", "engaged", "confirmed", "arrived"]);
    expect(s[1]).toMatchObject({ value: 100, pct: 50 });
    expect(s[2]).toMatchObject({ value: 0, pct: 0 });
  });
  it("never divides by zero and never passes 100", () => {
    expect(pipelineStages(src({ enrolled: 0, emailed: 0 }))[1].pct).toBe(0);
    expect(pipelineStages(src({ enrolled: 10, emailed: 15 }))[1].pct).toBe(100);
  });
});

describe("window banner", () => {
  it("says when sending resumes and how much is queued while closed", () => {
    const b = windowBanner(view());
    expect(b).toContain("closed");
    expect(b).toContain("Mon 12 Oct");
    expect(b).toContain("09:00 IST");
    expect(b).toContain("300");
  });
  it("says it is open when it is", () => expect(windowBanner(view({ windowOpen: true }))).toContain("Sending is open"));
  it("formats an IST time", () => expect(whenIst("2026-10-12T03:30:00.000Z")).toBe("Mon 12 Oct, 09:00 IST"));
});
