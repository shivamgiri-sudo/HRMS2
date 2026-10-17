import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import { HeroScore, pillarRows } from "../HeroScore";
import * as fx from "./fixtures";

type Score = BranchHeadHealthPayload["branches"][number]["score"];
const branch = { branchId: "b1", branchCode: "b1", branchName: "Kolkata" };
const overview = (o: Partial<BranchOverview> = {}): BranchOverview => ({
  branch, date: "2026-10-15", status: "healthy",
  attention: [{ label: "Late arrivals flagged", detail: "12 employees arrived late today", severity: "warning" }],
  positives: [],
  people: fx.ok(fx.people), attendance: fx.ok(fx.attendance), hiring: fx.ok(fx.hiring), finance: fx.ok(fx.finance),
  leaderboard: fx.ok([]), ...o,
});
const score: Score = {
  score: 82,
  pillars: [
    { key: "attendance", weight: 25, score: 90 },
    { key: "people", weight: 20, score: 70 },
    { key: "quality", weight: 10, score: null },
  ] as never,
  excluded: ["finance", "hiring"],
};
const html = (o: { ov?: BranchOverview; sc?: Score; trend?: Array<number | null> } = {}) => renderToStaticMarkup(
  <HeroScore branch={branch} overview={o.ov ?? overview()} score={o.sc === undefined ? score : o.sc} trend={o.trend} onOpenAttention={() => {}} />,
);

describe("HeroScore", () => {
  it("left column is a centred stack: name, a 150px ring with its band, attention, the labelled report status, date, vs yesterday", () => {
    const out = html({ trend: [70, 75, 82] });
    const left = out.slice(out.indexOf("bh-hero-left"), out.indexOf("Score by pillar"));
    expect(left).toContain("items-center justify-center");
    expect(left).toContain('width="150"');
    const at = ["Kolkata", 'aria-label="Health score:', "Health score trend", "1 needs attention", "Report status", "Healthy", "2026-10-15", "vs 10.0% yesterday"].map((t) => left.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("shows the score ring with its band and the status chip", () => {
    const out = html();
    expect(out).toContain("Health score: 82 out of 100, Good");
    expect(out).toContain("Healthy");
    expect(out).toContain("Kolkata");
    expect(out).toContain("2026-10-15");
  });
  it("draws one pillar bar per scored pillar with its weight", () => {
    const out = html();
    expect(out).toContain("attendance");
    expect(out).toContain("90/100");
    expect(out).toContain("weight 25");
    expect(out).toContain("70/100");
    expect(out).toContain("weight 20");
    expect(out).toContain("Score by pillar");
    expect(out).toContain("View as table");
  });
  it("shows excluded and null pillars as not scored, never as 0", () => {
    const out = html();
    expect(out).not.toContain(">0/100<");
    expect(out.split("not scored").length - 1).toBeGreaterThanOrEqual(3);
    expect(out).toContain("bh-hero-unscored");
    expect(out).toContain("Not scored (no data): finance, hiring - remaining weights renormalised");
    const rows = pillarRows(score!);
    expect(rows.scored.map((r) => r.id)).toEqual(["attendance", "people"]);
    expect(rows.unscored.map((r) => r.key)).toEqual(["quality", "finance", "hiring"]);
  });
  it("omits the excluded line when nothing is excluded", () => {
    expect(html({ sc: { score: 82, pillars: [{ key: "attendance", weight: 25, score: 90 }] as never, excluded: [] } })).not.toContain("Not scored");
  });
  it("no score keeps the No data chip and says the score is unavailable", () => {
    const out = html({ ov: overview({ status: "no_data" }), sc: null });
    expect(out).toContain("No data");
    expect(out).toContain("Score unavailable");
    expect(out).not.toContain("Healthy");
    expect(out).not.toContain("out of 100");
  });
  it("draws the score sparkline only with 3 or more points", () => {
    expect(html({ trend: [80, 81] })).not.toContain("Health score trend");
    expect(html({ trend: [80, 81, 82] })).toContain("Health score trend");
  });
  it("shows vs yesterday only where the payload has it", () => {
    expect(html()).toContain("Shrinkage 12.0% vs 10.0% yesterday");
    const noPrev = overview({ attendance: fx.ok({ ...fx.attendance, previousDay: null }) });
    expect(html({ ov: noPrev })).not.toContain("yesterday");
  });
  it("offers the attention count as a button", () => {
    expect(html()).toContain("1 needs attention");
    expect(html({ ov: overview({ attention: [] }) })).not.toContain("attention");
  });
});
