import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMPTY_DRILL, MAX_DRILL_DEPTH, backDrill, drillResetKey, drillSync, pruneDrill, pushDrill, type DrillEntry } from "../drill/history";
import { DRILL_LINKS, linksFor } from "../drill/links";
import { ariaSort, sortPnlRows } from "../drill/metrics/pnlSort";
import { processTarget } from "../drill";
import * as fx from "./fixtures";

const m = (id: "pnl" | "headcount" | "late" | "ops" | "backlog" | "hiring", branchId = "b1"): DrillEntry => ({ target: { kind: "metric", id }, branchId });
const p = (id: string, branchId = "b1"): DrillEntry => ({ target: { kind: "process", id, name: id, branchId }, branchId });

describe("drill history stack", () => {
  it("a first open starts fresh; opening from inside pushes the current entry", () => {
    const s1 = pushDrill(EMPTY_DRILL, m("pnl"));
    expect(s1).toEqual({ current: m("pnl"), back: [] });
    const s2 = pushDrill(s1, p("p1"));
    expect(s2.current).toEqual(p("p1"));
    expect(s2.back).toEqual([m("pnl")]);
  });
  it("back pops to the previous entry and is a no-op with no history", () => {
    const s = pushDrill(pushDrill(EMPTY_DRILL, m("pnl")), p("p1"));
    expect(backDrill(s)).toEqual({ current: m("pnl"), back: [] });
    const one = pushDrill(EMPTY_DRILL, m("pnl"));
    expect(backDrill(one)).toBe(one);
    expect(backDrill(EMPTY_DRILL)).toBe(EMPTY_DRILL);
  });
  it("keeps at most MAX_DRILL_DEPTH entries of history (oldest dropped)", () => {
    expect(MAX_DRILL_DEPTH).toBe(5);
    let s = pushDrill(EMPTY_DRILL, p("p0"));
    for (let i = 1; i <= 8; i += 1) s = pushDrill(s, p(`p${i}`));
    expect(s.back).toHaveLength(5);
    expect(s.back.map((e) => (e.target as { id: string }).id)).toEqual(["p3", "p4", "p5", "p6", "p7"]);
    expect((s.current?.target as { id: string }).id).toBe("p8");
  });
  it("re-opening the current target does not grow the history", () => {
    const s = pushDrill(EMPTY_DRILL, m("pnl"));
    expect(pushDrill(s, m("pnl"))).toBe(s);
  });
  it("the reset key changes with the selected branch, the date and the payload's branch list", () => {
    const a = drillResetKey("b1", "2026-10-15", ["b1"]);
    expect(drillResetKey("b1", "2026-10-15", ["b1"])).toBe(a);
    expect(drillResetKey("", "2026-10-15", ["b1"])).not.toBe(a);
    expect(drillResetKey("b1", "2026-10-14", ["b1"])).not.toBe(a);
    expect(drillResetKey("b1", "2026-10-15", ["b1", "b2"])).not.toBe(a);
  });
  it("pruneDrill closes when the payload loses the branch or the process", () => {
    const data = fx.payloadOf();
    const open = pushDrill(EMPTY_DRILL, p("p-alpha"));
    expect(pruneDrill(open, data)).toBe(open);
    expect(pruneDrill(pushDrill(EMPTY_DRILL, p("p-gone")), data)).toEqual(EMPTY_DRILL);
    expect(pruneDrill(pushDrill(EMPTY_DRILL, m("pnl", "b9")), data)).toEqual(EMPTY_DRILL);
    expect(pruneDrill(pushDrill(EMPTY_DRILL, m("pnl")), data).current).toEqual(m("pnl"));
    expect(pruneDrill(EMPTY_DRILL, data)).toBe(EMPTY_DRILL);
  });
  it("a vanished current asks the host to close; a vanished Back entry is pruned", () => {
    const data = fx.payloadOf();
    const gone = pushDrill(pushDrill(EMPTY_DRILL, m("pnl")), p("p-gone"));
    expect(drillSync(gone, data)).toBe("close");
    const staleBack = pushDrill(pushDrill(pushDrill(EMPTY_DRILL, m("pnl")), p("p-gone")), p("p-alpha"));
    expect(drillSync(staleBack, data)).toBe("prune");
    expect(pruneDrill(staleBack, data)).toEqual({ current: p("p-alpha"), back: [m("pnl")] });
    expect(drillSync(pushDrill(EMPTY_DRILL, p("p-alpha")), data)).toBe("none");
  });
  it("a process that reappears after being pruned does not pop the drawer open", () => {
    const without = fx.payloadOf(undefined, { processes: { active: [], unmapped: [] } });
    const closed = pruneDrill(pushDrill(EMPTY_DRILL, p("p-alpha")), without);
    expect(closed).toEqual(EMPTY_DRILL);
    expect(pruneDrill(closed, fx.payloadOf()).current).toBeNull();
  });
  it("a P&L-only process (not in the coverage lists) stays valid while its P&L row exists", () => {
    const data = fx.payloadOf();
    const s = pushDrill(EMPTY_DRILL, p("p2"));
    expect(pruneDrill(s, data)).toBe(s);
    expect(pruneDrill(pushDrill(EMPTY_DRILL, p("p2", "b9")), data)).toEqual(EMPTY_DRILL);
  });
});

describe("process targets carry the branch", () => {
  it("processTarget adds the branch id only when given", () => {
    const rows = [fx.procRow({})];
    expect(processTarget("alpha voice", rows, "headcount")).toEqual({ kind: "process", id: "p-alpha", name: "Alpha Voice" });
    expect(processTarget("alpha voice", rows, "headcount", "b1")).toEqual({ kind: "process", id: "p-alpha", name: "Alpha Voice", branchId: "b1" });
  });
});

describe("deep links", () => {
  it("every href is a real href/path entry of navConfig", () => {
    const nav = readFileSync(resolve(__dirname, "../../../../../components/layout/navConfig.tsx"), "utf8");
    const routes = new Set<string>();
    for (const key of ["href:", "path:"]) {
      for (const part of nav.split(key).slice(1)) {
        const t = part.trimStart();
        const q = t[0];
        if (q === '"' || q === "'" || q === "`") routes.add(t.slice(1, t.indexOf(q, 1)));
      }
    }
    expect(routes.size).toBeGreaterThan(20);
    for (const l of Object.values(DRILL_LINKS)) expect(routes.has(l.href), l.href).toBe(true);
  });
  it("uses the listed paths", () => {
    expect(Object.values(DRILL_LINKS).map((l) => l.href).sort()).toEqual([
      "/ats/command-center", "/call-master", "/finance/branch-budget", "/finance/grn", "/finance/process-pnl",
      "/process-operations", "/wfm/attendance-integrity", "/wfm/roster-command-center", "/workforce/aon-analytics",
    ]);
  });
  it("maps targets to the relevant subset, always with a text label", () => {
    const hrefs = (t: Parameters<typeof linksFor>[0]) => linksFor(t).map((l) => l.href);
    expect(hrefs({ kind: "process", id: "x", name: "X" })).toEqual(["/finance/process-pnl", "/wfm/roster-command-center", "/process-operations"]);
    expect(hrefs({ kind: "metric", id: "pnl" })).toContain("/finance/process-pnl");
    expect(hrefs({ kind: "metric", id: "grn" })).toContain("/finance/grn");
    expect(hrefs({ kind: "metric", id: "budget" })).toContain("/finance/branch-budget");
    expect(hrefs({ kind: "metric", id: "openings" })).toEqual(["/ats/command-center"]);
    expect(hrefs({ kind: "metric", id: "attrition" })).toEqual(["/workforce/aon-analytics"]);
    expect(hrefs({ kind: "metric", id: "ops" })).toEqual(["/process-operations", "/call-master"]);
    expect(hrefs({ kind: "metric", id: "shrinkage" })).toContain("/wfm/attendance-integrity");
    for (const id of ["shrinkage", "late", "headcount", "attrition", "profit", "budget", "grn", "openings", "attendance", "finance", "pnl", "hiring", "backlog", "ops"] as const) {
      const ls = linksFor({ kind: "metric", id });
      expect(ls.length, id).toBeGreaterThan(0);
      for (const l of ls) expect(l.label.length).toBeGreaterThan(0);
    }
  });
});

describe("sortPnlRows", () => {
  const rows = fx.pnlRows(4).map((r, i) => ({ ...r, processName: ["Delta", "Alpha", "Charlie", "Bravo"][i] }));
  rows[0].revenue = 500; rows[1].revenue = 100; rows[2].revenue = 500; rows[3].revenue = 300;
  rows[0].opPct = null; rows[1].opPct = 4; rows[2].opPct = -2; rows[3].opPct = null;
  const names = (rs: typeof rows) => rs.map((r) => r.processName);
  it("sorts by revenue both ways, ties by process name", () => {
    expect(names(sortPnlRows(rows, "revenue", "desc"))).toEqual(["Charlie", "Delta", "Bravo", "Alpha"]);
    expect(names(sortPnlRows(rows, "revenue", "asc"))).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });
  it("nulls go last in either direction", () => {
    expect(names(sortPnlRows(rows, "opPct", "asc"))).toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);
    expect(names(sortPnlRows(rows, "opPct", "desc"))).toEqual(["Alpha", "Charlie", "Bravo", "Delta"]);
  });
  it("status orders loss-making, at risk, profitable; does not mutate the input", () => {
    const before = names(rows);
    const s = sortPnlRows(rows, "status", "asc").map((r) => r.status);
    expect(s).toEqual([...s].sort((a, b) => ["loss-making", "at-risk", "profitable"].indexOf(a) - ["loss-making", "at-risk", "profitable"].indexOf(b)));
    expect(names(rows)).toEqual(before);
    expect(sortPnlRows([], "op", "asc")).toEqual([]);
  });
  it("aria-sort values", () => {
    expect(ariaSort("revenue", "revenue", "asc")).toBe("ascending");
    expect(ariaSort("revenue", "revenue", "desc")).toBe("descending");
    expect(ariaSort("people", "revenue", "desc")).toBe("none");
  });
});
