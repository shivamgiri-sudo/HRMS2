import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The queue row read as congested tiles sitting next to empty space.
 *
 * Each of the four section tiles held a fixed min-w-[120px] inside a flex-wrap
 * container, so they never grew into the row's spare width, and their status
 * text was additionally clamped at max-w-[130px]. Labels like
 * "Conditional · 3 pending" or "Penny-drop verified" had nowhere to go, while
 * the row kept slack beside them -- and once the tiles did wrap, the row became
 * two ragged lines.
 */
const QUEUE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "payroll", "PayrollHeadSalaryReviewQueue.tsx"),
  "utf8",
);
const TILE = QUEUE.slice(QUEUE.indexOf("export function SectionCard"), QUEUE.indexOf("// ── Section popup"));

describe("Queue row — section tile layout", () => {
  it("drops the fixed tile width so tiles fill the row's spare space", () => {
    expect(TILE).not.toMatch(/min-w-\[120px\]/);
    expect(TILE).toMatch(/min-w-0/);
  });

  it("drops the fixed status-text clamp that truncated the longer labels", () => {
    expect(TILE).not.toMatch(/max-w-\[130px\]/);
  });

  it("still truncates rather than overflowing when a column really is too narrow", () => {
    expect(TILE).toMatch(/<span className="truncate">\{text\}<\/span>/);
  });

  it("keeps the full text reachable when truncated", () => {
    expect(TILE).toMatch(/title=\{`\$\{meta\.label\}: \$\{text\}`\}/);
  });

  it("uses two columns at lg and four only at xl", () => {
    // Four columns at lg would leave ~66px per tile once the row's fixed parts
    // are accounted for, truncating every label.
    expect(QUEUE).toMatch(/grid-cols-2 xl:grid-cols-4/);
  });
});
