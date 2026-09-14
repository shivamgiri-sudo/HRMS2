import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The cost-centre scope popover ("5/5 CC") must not live inside the grid's scroll container.
 *
 * It used to be `<div className="absolute left-0 top-6 z-50 …">` inside the first column's cell.
 * That cell is `sticky left-0 z-20`, so it is its own stacking context: the popover's z-50 only
 * ordered it against its siblings, and the sticky cells of the rows BELOW — same z-index, later in
 * the DOM — painted straight over it, while the `overflow-auto` scroller clipped whatever hung out
 * of the viewport. On screen that read as a half-hidden dropdown with table rows showing through.
 *
 * There is no jsdom in this project (see vitest.config.ts), so this guards the structure at source
 * level, the same way process-pnl-page.contract.test.tsx does.
 */
const SOURCE = readFileSync(
  path.resolve(__dirname, "../BranchBudgetPlannerGrid.tsx"),
  "utf8"
);

describe("BranchBudgetPlannerGrid cost-centre scope popover", () => {
  it("renders in a portal on document.body rather than inside the scrolling table", () => {
    expect(SOURCE).toContain("createPortal(");
    expect(SOURCE).toContain("document.body");
    expect(SOURCE).not.toContain('className="absolute left-0 top-6 z-50 w-56');
  });

  it("is positioned fixed and above the full-page overlay (z-[70])", () => {
    expect(SOURCE).toMatch(/className="fixed z-\[80\][^"]*"/);
  });

  it("tracks its anchor and closes on scroll, Escape and outside clicks", () => {
    expect(SOURCE).toContain('window.addEventListener("scroll", place, true)');
    expect(SOURCE).toContain('window.addEventListener("resize", place)');
    expect(SOURCE).toContain('window.addEventListener("keydown", onKey, true)');
    expect(SOURCE).toContain('document.addEventListener("mousedown", onPointerDown)');
  });
});
