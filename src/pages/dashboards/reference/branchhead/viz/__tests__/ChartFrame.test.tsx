import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartFrame, type TableSpec } from "../index";

const table: TableSpec = { caption: "Headcount by process", columns: ["Process", "Headcount"], rows: [["Alpha", 12], ["Beta", null]] };

describe("ChartFrame", () => {
  it("renders the title, subtitle and a table toggle with the chart by default", () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Headcount" subtitle="vs mandate" table={table} height={180}><svg data-chart="yes" /></ChartFrame>,
    );
    expect(html).toContain("Headcount");
    expect(html).toContain("vs mandate");
    expect(html).toContain("View as table");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-chart="yes"');
    expect(html).toContain("min-height:180px");
    expect(html).not.toContain("<table");
  });
  it("renders a real table from the same data when toggled", () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Headcount" table={table} defaultShowTable><svg data-chart="yes" /></ChartFrame>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("<caption");
    expect(html).toContain("Headcount by process");
    expect(html).toContain('scope="col"');
    expect(html).toContain("Alpha");
    expect(html).toContain(">12<");
    expect(html).toContain("—");
    expect(html).not.toContain('data-chart="yes"');
  });
});
