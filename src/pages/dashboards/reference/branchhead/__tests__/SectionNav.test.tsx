import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BH_SECTIONS, SectionNav, pickActive } from "../SectionNav";

describe("SectionNav", () => {
  it("lists the seven page sections in order", () => {
    expect(BH_SECTIONS.map((s) => s.id)).toEqual(["bh-overview", "bh-people", "bh-attendance", "bh-finance", "bh-pnl", "bh-hiring", "bh-ops"]);
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
});
