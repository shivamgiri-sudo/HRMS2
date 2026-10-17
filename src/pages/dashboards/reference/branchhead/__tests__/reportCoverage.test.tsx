import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BranchHeadReferenceLayout } from "../BranchHeadReferenceLayout";
import { REPORT_SECTIONS } from "../CoverageStrip";
import { BH_SECTIONS } from "../BranchHero";
import { FINANCE_SUBS } from "../sections/FinanceVisual";
import { richPayload } from "./richFixtures";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn() } }));

const page = (tab: string, sub?: string) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <BranchHeadReferenceLayout data={richPayload()} initialTab={tab} initialSub={sub} />
  </MemoryRouter></QueryClientProvider>,
);

/** One distinctive marker per emailed-report section (template.ts 1-11) on the tab the coverage strip names. */
const MARKERS: Record<number, string[]> = {
  1: ["Budget history and after closure", "Still-open sub-heads", "Heads: % of budget used", "Total budget"],
  2: ["Open GRNs by approval stage", "GRNs by type", "Bridge: GRNs raised to budget charged", "Unbudgeted"],
  3: ["Recent GRNs (latest 15, excluding drafts)", "GRN-2210-0060", "Sai Facility Services"],
  4: ["ATS today: tokens by outcome", "Walk-ins", "Closure pending", "SLA breaches today"],
  5: ["Shift bands: planned, absent, late", "By process and shift slot", "Late arrivals by process", "Not on today&#x27;s roster", "Late arrivals by team"],
  6: ["Headcount by process", "Attrition MTD", "Joined today", "Left today", "Pending actions", "Attendance regularizations pending", "Line of business"],
  7: ["Consecutive absence", "Asha Rao", "Vikram Nair", "Offer to join", "Last 30 days", "joining in 7 days"],
  8: ["Open hiring batches", "Collection Agent", "Short by 5"],
  9: ["Revenue to operating profit", "Projection for the full month", "Tie-out between budget and P&amp;L"],
  10: ["Top risk people", "Neha Singh", "Resignation hint", "Monthly exits", "Risk by process"],
  11: ["Needs attention", "Going well", "Utilities over budget"],
};

describe("every emailed-report section is on the page", () => {
  it("the coverage strip lists the 11 sections in email order, each pointing at a real tab (and Finance sub-tab)", () => {
    expect(REPORT_SECTIONS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const tabs = new Set(BH_SECTIONS.map((t) => t.id));
    const subs = new Set(FINANCE_SUBS.map((s) => s.id));
    for (const s of REPORT_SECTIONS) {
      expect(tabs.has(s.tab)).toBe(true);
      if (s.sub) expect(subs.has(s.sub)).toBe(true);
    }
    const out = page("overview");
    const strip = out.slice(out.indexOf('aria-label="Emailed report sections on this page"'));
    expect(strip.split('class="bhl-cover-btn"').length - 1).toBe(11);
    expect(out).toContain("11 of 11 email sections");
  });
  it.each(REPORT_SECTIONS.map((s) => [s.n, s] as const))("section %i renders on its tab", (n, s) => {
    const out = page(s.tab, s.sub);
    for (const m of MARKERS[n]) expect(out, `section ${n}: ${m}`).toContain(m);
    expect(out).not.toContain("NaN");
  });
  it("overview: the score band and the report status are separate, labelled things", () => {
    const out = page("overview");
    expect(out).toContain("Health score: 68 out of 100, Fair");
    expect(out.split("Report status").length - 1).toBeGreaterThanOrEqual(2);
    expect(out).toContain("Watch");
  });
});
