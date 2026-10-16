import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BH_SECTIONS, SectionNav, pickActive } from "../SectionNav";

describe("SectionNav", () => {
  it("lists the nine page sections in on-page order", () => {
    expect(BH_SECTIONS.map((s) => s.id)).toEqual(["bh-overview", "bh-people", "bh-attendance", "bh-attrition", "bh-finance", "bh-pnl", "bh-hiring", "bh-backlog", "bh-ops"]);
  });
  it("renders anchor links with aria-current on the active one (first by default), without IntersectionObserver", () => {
    const out = renderToStaticMarkup(<SectionNav sections={BH_SECTIONS} />);
    for (const s of BH_SECTIONS) expect(out).toContain(`href="#${s.id}"`);
    expect(out.split("aria-current").length - 1).toBe(1);
    expect(out).toMatch(/href="#bh-overview"[^>]*aria-current="location"|aria-current="location"[^>]*href="#bh-overview"/);
    expect(out).toContain('aria-label="Page sections"');
    expect(out).toContain("sticky");
    expect(out).toContain("var(--topbar-height, 64px)");
  });
  it("pickActive chooses the visible section nearest the top, keeping the last one when none is visible", () => {
    const ids = BH_SECTIONS.map((s) => s.id);
    expect(pickActive(ids, new Map([["bh-finance", 300], ["bh-people", 120]]), "bh-overview")).toBe("bh-people");
    expect(pickActive(ids, new Map(), "bh-pnl")).toBe("bh-pnl");
  });
  it("pickActive breaks ties by document order, whatever order the observer reported them", () => {
    const ids = BH_SECTIONS.map((s) => s.id);
    expect(pickActive(ids, new Map([["bh-backlog", 140], ["bh-attrition", 140]]), "bh-overview")).toBe("bh-attrition");
    expect(pickActive(ids, new Map([["bh-ops", 130], ["bh-hiring", 140]]), "bh-overview")).toBe("bh-ops");
  });
});
