/** Static-markup tests (node env, no DOM). Click, Enter and Space behaviour needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));

import { PipelineHealthView } from "../PipelineHealthStrip";
import PipelineHealthStrip from "../PipelineHealthStrip";
import { buildStripView } from "../healthStripModel";

const critical = {
  generatedAt: "2026-10-07T10:00:00.000Z",
  level: "critical" as const,
  checks: [{ key: "lead_intake", label: "Lead intake", level: "critical" as const, detail: "No leads for 5 h" }],
};
const noop = () => undefined;

describe("PipelineHealthStrip", () => {
  it("renders the loading skeleton on first render", () => {
    const html = renderToStaticMarkup(<PipelineHealthStrip />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Loading pipeline health");
  });
  it("shows Critical and the lead intake chip with its level word", () => {
    const html = renderToStaticMarkup(<PipelineHealthView view={buildStripView(critical, null)} error={null} loading={false} onToggle={noop} onRefresh={noop} />);
    expect(html).toContain("Critical");
    expect(html).toContain("Lead intake");
    expect(html).toContain("<button");
    expect(html).toContain("Refresh pipeline health");
  });
  it("shows the expanded detail below the chips", () => {
    const html = renderToStaticMarkup(<PipelineHealthView view={buildStripView(critical, "lead_intake")} error={null} loading={false} onToggle={noop} onRefresh={noop} />);
    expect(html).toContain("No leads for 5 h");
    expect(html).toContain('aria-expanded="true"');
  });
  it("shows the error message and a Retry button", () => {
    const html = renderToStaticMarkup(<PipelineHealthView view={buildStripView(null, null)} error="Network down" loading={false} onToggle={noop} onRefresh={noop} />);
    expect(html).toContain("Network down");
    expect(html).toContain("Retry");
  });
});
