import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BH_SECTIONS, BranchHero } from "../BranchHero";

const render = (active = "overview") => renderToStaticMarkup(
  <BranchHero branchName="Kolkata" status="watch" date="2026-10-15" activeTab={active} onTabChange={() => {}} />,
);

describe("BranchHero", () => {
  it("shows eyebrow, title, branch, status chip and date in the banner", () => {
    const out = render();
    for (const t of ["Branch Head", "Branch health", "Kolkata", "Watch", "2026-10-15", "from-sky-700 via-blue-700 to-indigo-800"]) expect(out).toContain(t);
  });
  it("is a real tablist: ten tabs, exactly one selected, roving tabindex, 44px targets", () => {
    const out = render("hiring");
    expect(out).toContain('role="tablist"');
    expect(out.split('role="tab"').length - 1).toBe(BH_SECTIONS.length);
    expect(out.split('aria-selected="true"').length - 1).toBe(1);
    expect(out.split('tabindex="-1"').length - 1).toBe(BH_SECTIONS.length - 1);
    expect(out.split("min-h-[44px]").length - 1).toBe(BH_SECTIONS.length);
    expect(out).toMatch(/id="bh-tab-hiring"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="bh-tab-hiring"/);
  });
  it("tabs scroll sideways inside the banner instead of the page", () => {
    expect(render()).toContain("overflow-x-auto");
  });
});
