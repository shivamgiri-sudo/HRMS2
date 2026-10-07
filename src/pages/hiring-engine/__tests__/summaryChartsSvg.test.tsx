/**
 * Renders the recharts bodies at a fixed size (ResponsiveContainer measures nothing on the server) with reduced motion on, so the
 * markup is the final frame (no animation) and isAnimationActive={false} is exercised.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  const Fixed = ({ children }: { children: React.ReactElement }) => React.cloneElement(children, { width: 640, height: 300 });
  return { ...actual, ResponsiveContainer: Fixed };
});

vi.mock("../command/chartTheme", async (orig) => ({ ...(await orig<typeof import("../command/chartTheme")>()), usePrefersReducedMotion: () => true }));

import FunnelCompare from "../command/charts/FunnelCompare";
import YieldChart from "../command/charts/YieldChart";
import ShowRateScatter from "../command/charts/ShowRateScatter";
import DropOffWaterfall from "../command/charts/DropOffWaterfall";
import { STAGES } from "../command/driveCommandTypes";
import type { DriveAnalytics, SourceType, StageCounts } from "../command/driveCommandTypes";

const TYPES: SourceType[] = ["meta_live", "meta_old", "he"];
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const conv = (s: StageCounts) => STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: s[STAGES[i]] > 0 ? s[to] / s[STAGES[i]] : null }));
const typ = (s: StageCounts) => ({ stages: s, previous: sc(), noShow: 0, declined: 0, conversions: conv(s), sparkline: [] });
const live = sc({ leads: 100, qualified: 60, invited: 50, confirmed: 30, arrived: 20, selected: 10, joined: 8 });
const he = sc({ leads: 40, qualified: 30, invited: 30, confirmed: 24, arrived: 20, selected: 12, joined: 9 });
const a = (qualifiedTracked: boolean): DriveAnalytics => ({
  window: { from: "2026-10-01", to: "2026-10-14", days: 14 }, qualifiedTracked, typesPresent: ["meta_live", "he"],
  types: { meta_live: typ(live), meta_old: typ(sc()), he: typ(he) },
  daily: ["2026-10-12", "2026-10-13", "2026-10-14"].map((date, i) => ({ date, target: 25, byType: { meta_live: { invited: 0, confirmed: 0, arrived: i + 1 }, meta_old: { invited: 0, confirmed: 0, arrived: 0 }, he: { invited: 0, confirmed: 0, arrived: 2 * i } } })),
  timing: { replies: {}, arrivals: {}, arrivalsWithoutTime: 0 },
  scatter: Array.from({ length: 8 }, (_, i) => ({ requisitionId: `r${i}`, code: `REQ-${i}`, branch: `B${i}`, sourceType: TYPES[i % 3], leads: 10 + i * 7, showRate: 0.3 + i / 100, leadToJoinRate: 0.05 + i / 200 })),
  waterfall: { meta_live: [{ from: "invited", to: "confirmed", lost: 20, reasons: [{ reason: "declined", n: 4 }, { reason: "no_reply", n: 16 }] }], meta_old: [], he: [] },
  cost: { available: false, note: "" },
} as unknown as DriveAnalytics);
const clean = (html: string) => { for (const bad of ["NaN", "undefined", "Infinity"]) expect(html).not.toContain(bad); };

describe("drawn SVG", () => {
  it("funnel: textured bars, value labels with the type name on the largest bar, conversions under the stage", () => {
    const html = renderToStaticMarkup(<FunnelCompare analytics={a(true)} />);
    clean(html);
    expect(html.match(/<pattern /g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/fill="url\(#p[^"]*-tex-meta-live\)"/);
    expect(html).toContain("100 Live Meta");
    expect(html).toContain("60% / – / 75%");
  });
  it("funnel untracked: qualified label is an en dash", () => {
    const html = renderToStaticMarkup(<FunnelCompare analytics={a(false)} />);
    clean(html);
    expect(html).toContain("– / – / –");
    expect(html.match(/>–<\/tspan>/g)?.length).toBe(3);
  });
  it("yield: end labels, marker symbols and the dashed target", () => {
    const html = renderToStaticMarkup(<YieldChart analytics={a(true)} />);
    clean(html);
    expect(html).toContain(">Live Meta</text>");
    expect(html).toContain(">Target</text>");
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain("recharts-symbols");
  });
  it("scatter: five labels, shapes per type, axis titles", () => {
    const html = renderToStaticMarkup(<ShowRateScatter analytics={a(true)} />);
    clean(html);
    for (const code of ["REQ-7", "REQ-6", "REQ-5", "REQ-4", "REQ-3"]) expect(html).toContain(`>${code}</`);
    const svg = html.split("<svg class=\"recharts-surface")[1].split("</svg>")[0];
    expect(svg).not.toContain(">REQ-0</");
    expect(svg).toContain("recharts-symbols");
    expect(html).toContain("Show rate %");
    expect(html).toContain("Lead to join %");
  });
  it("waterfall: invisible base and the lost label", () => {
    const html = renderToStaticMarkup(<DropOffWaterfall analytics={a(true)} />);
    clean(html);
    expect(html).toContain("20 lost");
    expect(html).toContain('fill="transparent"');
  });
});
