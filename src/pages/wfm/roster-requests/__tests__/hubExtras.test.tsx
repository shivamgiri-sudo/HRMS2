import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { indexPendingCells, pendingBadgeHref, pendingBadgeTitle } from "../pendingCells";
import { findDeepLinked, parseDeepLink } from "../deepLink";
import { DEFAULT_RULE, ruleFor, validateAutoRule } from "../autoRuleForm";
import { PendingRequestBadges } from "@/components/wfm/team-roster/TeamRosterGrid";
import type { RosterRequest } from "../types";

describe("indexPendingCells", () => {
  it("groups by employee|date and drops junk", () => {
    const m = indexPendingCells([
      { employeeId: "e1", date: "2026-10-02", kind: "swap", id: 5 },
      { employeeId: "e1", date: "2026-10-02", kind: "dispute", id: "9" },
      { employeeId: "e2", date: "2026-10-03", kind: "nope" as never, id: "1" },
    ]);
    expect(m.get("e1|2026-10-02")).toEqual([{ kind: "swap", id: "5" }, { kind: "dispute", id: "9" }]);
    expect(m.size).toBe(1);
  });
});

describe("badge", () => {
  it("renders an amber link to the hub", () => {
    const html = renderToStaticMarkup(<MemoryRouter><PendingRequestBadges refs={[{ kind: "swap", id: "5" }]} /></MemoryRouter>);
    expect(html).toContain("Pending shift swap");
    expect(html).toContain('href="/wfm/roster-requests?kind=swap&amp;id=5"');
    expect(pendingBadgeTitle("weekoff_rejection")).toBe("Pending week-off rejected");
    expect(pendingBadgeHref({ kind: "swap", id: "5" })).toBe("/wfm/roster-requests?kind=swap&id=5");
  });
});

describe("deep link", () => {
  const req = (kind: RosterRequest["kind"], id: string) => ({ key: `${kind}:${id}`, kind, id } as RosterRequest);
  it("parses and finds", () => {
    expect(parseDeepLink(new URLSearchParams("kind=swap&id=5"))).toEqual({ kind: "swap", id: "5" });
    expect(parseDeepLink(new URLSearchParams("kind=bad"))).toEqual({ kind: null, id: null });
    const list = [req("dispute", "5"), req("swap", "5")];
    expect(findDeepLinked(list, { kind: "swap", id: "5" })?.key).toBe("swap:5");
    expect(findDeepLinked(list, { kind: "swap", id: "7" })).toBeNull();
    expect(findDeepLinked(list, { kind: null, id: null })).toBeNull();
  });
});

describe("auto rule form", () => {
  it("defaults off and maps server rows", () => {
    expect(ruleFor([], "p", "swap")).toEqual(DEFAULT_RULE);
    expect(ruleFor([{ process_id: "p", kind: "swap", enabled: 1, max_coverage_drop: 2, require_counterpart_accept: 0 }], "p", "swap"))
      .toEqual({ enabled: true, maxCoverageDrop: "2", requireCounterpartAccept: false });
  });
  it("validates", () => {
    expect(validateAutoRule("", "swap", DEFAULT_RULE).ok).toBe(false);
    expect(validateAutoRule("p", "dispute", DEFAULT_RULE).ok).toBe(false);
    expect(validateAutoRule("p", "swap", { ...DEFAULT_RULE, maxCoverageDrop: "-1" }).ok).toBe(false);
    expect(validateAutoRule("p", "swap", { ...DEFAULT_RULE, maxCoverageDrop: "1.5" }).ok).toBe(false);
    expect(validateAutoRule("p", "swap", { ...DEFAULT_RULE, enabled: true, maxCoverageDrop: "2" }))
      .toEqual({ ok: true, body: { processId: "p", kind: "swap", enabled: true, maxCoverageDrop: 2, requireCounterpartAccept: true } });
  });
});
