import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DrillDrawer } from "../DrillDrawer";

describe("DrillDrawer", () => {
  it("renders the title, a labelled close button and children when open", () => {
    const html = renderToStaticMarkup(
      <DrillDrawer open onClose={() => {}} title="Process 360" subtitle="Alpha" inline><p>drill body</p></DrillDrawer>,
    );
    expect(html).toContain("Process 360");
    expect(html).toContain("Alpha");
    expect(html).toContain('aria-label="Close Process 360"');
    expect(html).toContain("drill body");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("aria-labelledby");
  });
  it("renders nothing of its content when closed", () => {
    const html = renderToStaticMarkup(
      <DrillDrawer open={false} onClose={() => {}} title="Process 360" inline><p>drill body</p></DrillDrawer>,
    );
    expect(html).not.toContain("drill body");
    expect(html).not.toContain("Process 360");
  });
});
