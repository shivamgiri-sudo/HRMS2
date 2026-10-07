import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPARE_COLUMNS, SECTIONS, analyticsPath, changeArrow, commandHash, compareRows, countText, defaultFilters, drivePlanPath, istTodayClient,
  kpiTiles, nextSectionByKey, parseCommandHash, pctText, sortCompareRows, toCsv, type Filters,
} from "../command/driveCommandModel";
import type { DriveAnalytics, StageCounts } from "../command/driveCommandTypes";
import { tabFromHash } from "../hiringEngineTabs";

const NOW = new Date("2026-10-07T20:00:00Z"); // 01:30 IST on 8 Oct
const stages = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const analytics = (cur: Partial<StageCounts>, prev: Partial<StageCounts>, days = 14): DriveAnalytics => {
  const t = (c: Partial<StageCounts>, p: Partial<StageCounts>) => ({ stages: stages(c), previous: stages(p), noShow: 0, declined: 0, conversions: [], sparkline: [1, 2, 3] });
  return { window: { from: "2026-09-25", to: "2026-10-08", days }, types: { meta_live: t(cur, prev), meta_old: t({}, {}), he: t({}, {}) } } as unknown as DriveAnalytics;
};

describe("IST dates", () => {
  it("default window at 01:30 IST on 8 Oct", () => {
    expect(defaultFilters(NOW)).toEqual({ from: "2026-09-25", to: "2026-10-08", requisitionId: null, branch: null });
  });
  it("istTodayClient is the UTC date of now + 5.5 h", () => {
    expect(istTodayClient(new Date("2026-10-07T18:29:59Z"))).toBe("2026-10-07");
    expect(istTodayClient(new Date("2026-10-07T18:30:00Z"))).toBe("2026-10-08");
    expect(istTodayClient(new Date(Number.NaN))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("hash", () => {
  it("parses section and filters", () => {
    const r = parseCommandHash("#drives:plan?req=123e4567-e89b-42d3-a456-426614174000&from=2026-10-01&to=2026-10-14", NOW);
    expect(r.section).toBe("plan");
    expect(r.filters).toEqual({ from: "2026-10-01", to: "2026-10-14", requisitionId: "123e4567-e89b-42d3-a456-426614174000", branch: null });
  });
  it("unknown section and bad dates fall back", () => {
    expect(parseCommandHash("#drives:bogus", NOW).section).toBe("summary");
    expect(parseCommandHash("#drives:old?from=2026-02-30", NOW).filters).toEqual(defaultFilters(NOW));
    expect(parseCommandHash("#drives:old?from=2026-01-01&to=2026-10-01", NOW).filters.from).toBe("2026-09-25"); // 274 days
    expect(parseCommandHash("#drives:old?from=2026-10-05&to=2026-10-01", NOW).filters.to).toBe("2026-10-08");
    expect(parseCommandHash("#drives:old?from=2026-10-01&to=2026-12-01", NOW).filters.to).toBe("2026-10-08"); // too far ahead
  });
  it("is total on garbage", () => {
    const junk = ["", "#", "#drives", "#drives:", "#drives:?", "#drives:plan?%E0%A4%A", "#board", "#drives:summary?from=&to=&req=&branch=", "drives:plan",
      "#drives:plan?req=" + "x".repeat(500), "#drives:\u0000￿?from=%", "#drives:plan?from=2026-10-01", "#drives:plan?to=zzz"];
    for (const h of junk) {
      expect(() => parseCommandHash(h, NOW)).not.toThrow();
      const r = parseCommandHash(h, NOW);
      expect(SECTIONS.some((s) => s.id === r.section)).toBe(true);
      expect(r.filters.from <= r.filters.to).toBe(true);
    }
    expect(() => parseCommandHash(undefined as unknown as string, NOW)).not.toThrow();
    expect(parseCommandHash("#drives:plan?req=" + "x".repeat(500), NOW).filters.requisitionId).toBeNull();
    expect(parseCommandHash("#board", NOW)).toEqual({ section: "summary", filters: defaultFilters(NOW) });
  });
  it("omits defaults and round-trips", () => {
    expect(commandHash("summary", defaultFilters(NOW), NOW)).toBe("#drives:summary");
    const f: Filters = { from: "2026-10-01", to: "2026-10-14", requisitionId: "123e4567-e89b-42d3-a456-426614174000", branch: "Pune & Co" };
    for (const section of SECTIONS.map((s) => s.id)) expect(parseCommandHash(commandHash(section, f, NOW), NOW)).toEqual({ section, filters: f });
    const onlyReq: Filters = { ...defaultFilters(NOW), requisitionId: "abc" };
    expect(commandHash("he", onlyReq, NOW)).toBe("#drives:he?req=abc");
    const onlyTo: Filters = { ...defaultFilters(NOW), to: "2026-10-03" };
    expect(parseCommandHash(commandHash("live", onlyTo, NOW), NOW).filters).toEqual(onlyTo);
  });
  it("keyboard moves through the sections", () => {
    expect(nextSectionByKey("summary", "ArrowLeft")).toBe("plan");
    expect(nextSectionByKey("plan", "ArrowRight")).toBe("summary");
    expect(nextSectionByKey("live", "ArrowRight")).toBe("old");
    expect(nextSectionByKey("live", "Home")).toBe("summary");
    expect(nextSectionByKey("live", "End")).toBe("plan");
    expect(nextSectionByKey("live", "a")).toBeNull();
  });
});

describe("tabFromHash and the existing Hiring Engine hashes", () => {
  const ids = ["board", "drives", "leads", "master", "planner", "calls", "templates"] as const;
  it("resolves every existing hash exactly as before", () => {
    const before = (h: string) => ids.find((id) => `#${id}` === h) ?? "board";
    for (const h of [...ids.map((i) => `#${i}`), "", "#", "#nope", "#Board", "board", "#board ", "#drivesx", "#master/x"]) {
      expect(tabFromHash(h, ids, "board")).toBe(before(h));
    }
  });
  it("uses the part before the first colon", () => {
    expect(tabFromHash("#drives:plan", ["board", "drives"], "board")).toBe("drives");
    expect(tabFromHash("#drives:plan?req=a:b", ["board", "drives"], "board")).toBe("drives");
    expect(tabFromHash("#drives?req=1", ["board", "drives"], "board")).toBe("drives");
    expect(tabFromHash("#nope", ["board", "drives"], "board")).toBe("board");
    expect(tabFromHash(undefined as unknown as string, ["board"], "board")).toBe("board");
  });
});

describe("req validation", () => {
  it("keeps a UUID req and drops junk", () => {
    expect(parseCommandHash("#drives:plan?req=123e4567-e89b-42d3-a456-426614174000", NOW).filters.requisitionId).toBe("123e4567-e89b-42d3-a456-426614174000");
    for (const bad of ["1", "r1", "123e4567-e89b-42d3-a456-42661417400g", "123e4567e89b42d3a456426614174000", "123e4567-e89b-42d3-a456-4266141740000"]) {
      expect(parseCommandHash("#drives:plan?req=" + bad, NOW).filters.requisitionId).toBeNull();
    }
  });
});

describe("paths", () => {
  it("analyticsPath encodes", () => {
    expect(analyticsPath({ from: "2026-10-01", to: "2026-10-14", requisitionId: null, branch: "Pune & Co" })).toBe("/api/he/drive-analytics?from=2026-10-01&to=2026-10-14&branch=Pune+%26+Co");
    expect(analyticsPath({ from: "2026-10-01", to: "2026-10-14", requisitionId: "r1", branch: null })).toContain("&requisitionId=r1");
  });
  it("drivePlanPath", () => {
    expect(drivePlanPath("r 1")).toBe("/api/he/drive-plan?requisitionId=r+1");
    expect(drivePlanPath("r1", "2026-10-08", 7)).toBe("/api/he/drive-plan?requisitionId=r1&from=2026-10-08&days=7");
    expect(drivePlanPath("r1", null, Number.NaN)).toBe("/api/he/drive-plan?requisitionId=r1");
  });
});

describe("KPI and compare rows", () => {
  it("change arrow carries number, icon and words", () => {
    const tile = kpiTiles(analytics({ arrived: 20 }, { arrived: 8 }))[0];
    expect(tile.arrivalsChange).toMatchObject({ delta: 12, direction: "up", icon: "arrow-up", text: "+12 vs previous 14 days" });
    expect(changeArrow(5, 8, 14)).toMatchObject({ delta: -3, direction: "down", icon: "arrow-down", text: "-3 vs previous 14 days" });
    expect(changeArrow(8, 8, 14)).toMatchObject({ delta: 0, direction: "flat", text: "no change vs previous 14 days" });
    expect(changeArrow(2, 1, 1).text).toBe("+1 vs previous 1 day");
    expect(changeArrow(Number.NaN, Infinity, 14).direction).toBe("flat");
  });
  it("always three tiles in order with all stages", () => {
    const tiles = kpiTiles(analytics({ leads: 1234 }, {}));
    expect(tiles.map((t) => t.label)).toEqual(["Live Meta", "Old Meta data", "Hiring Engine"]);
    expect(tiles[0].values).toHaveLength(7);
    expect(tiles[0].values[0]).toMatchObject({ stage: "leads", value: 1234, text: "1,234" });
    expect(tiles[2].values.every((v) => v.value === 0)).toBe(true);
  });
  it("pctText and countText never show NaN", () => {
    expect(pctText(null)).toBe("–");
    expect(pctText(0.456)).toBe("46%");
    expect(pctText(0)).toBe("0%");
    expect(pctText(-0.001)).toBe("0%");
    expect(pctText(Number.NaN)).toBe("–");
    expect(pctText(Infinity)).toBe("–");
    expect(countText(Number.NaN)).toBe("–");
    expect(countText(1234567)).toBe("1,234,567");
    expect(countText(12)).toBe("12");
    expect(countText(0)).toBe("0");
  });
  it("compare rows: 0 confirmed gives a null show rate; empty input still has three rows", () => {
    const rows = compareRows(analytics({ leads: 10, joined: 2, arrived: 3, confirmed: 0 }, {}));
    expect(rows).toHaveLength(3);
    expect(rows[0].cells.showRate).toBeNull();
    expect(rows[0].cells.leadToJoin).toBe(0.2);
    expect(rows[1].cells.leadToJoin).toBeNull();
    expect(COMPARE_COLUMNS.map((c) => c.key)).toEqual(["leads", "qualified", "invited", "confirmed", "arrived", "selected", "joined", "showRate", "leadToJoin"]);
    const empty = compareRows({} as DriveAnalytics);
    expect(empty).toHaveLength(3);
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/);
  });
  it("sorts with null last in both directions and does not mutate", () => {
    const a = compareRows(analytics({ confirmed: 10, arrived: 5 }, {}));
    a[1].cells.showRate = 0.9;
    const input = [...a];
    expect(sortCompareRows(a, "showRate", "desc").map((r) => r.sourceType)).toEqual(["meta_old", "meta_live", "he"]);
    expect(sortCompareRows(a, "showRate", "asc").map((r) => r.sourceType)).toEqual(["meta_live", "meta_old", "he"]);
    expect(a).toEqual(input);
  });
});

describe("toCsv", () => {
  it("neutralises formulas, escapes, keeps numbers numeric", () => {
    expect(toCsv([{ key: "a", label: "a" }], [{ a: "=1+1" }, { a: "x,\"y\"" }])).toBe("﻿a\r\n'=1+1\r\n\"x,\"\"y\"\"\"\r\n");
    const csv = toCsv([{ key: "t", label: "Type" }, { key: "n", label: "N" }], [
      { t: "+cmd", n: -3 }, { t: "-x", n: 0.5 }, { t: "@sum", n: Number.NaN }, { t: "line\nbreak", n: null }, { t: "ok", n: 1 }]);
    expect(csv).toBe("﻿Type,N\r\n'+cmd,-3\r\n'-x,0.5\r\n'@sum,\r\n\"line\nbreak\",\r\nok,1\r\n");
  });
  it("escapes header labels too", () => {
    expect(toCsv([{ key: "a", label: "=bad" }], [])).toBe("﻿'=bad\r\n");
  });
});

describe("source hygiene", () => {
  it("has no regex literal with a character class", () => {
    for (const f of ["../command/driveCommandModel.ts", "../hiringEngineTabs.ts"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/\/\[/);
    }
  });
});
