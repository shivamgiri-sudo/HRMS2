import { describe, expect, it } from "vitest";
import { csvFilename, formatAge, formatDelta, formatDuration, formatValue, isStale, statusMeta } from "../format";

describe("formatDelta", () => {
  it("higher-is-better: a rise is good, with arrow and text", () => {
    const d = formatDelta(12.34, "higher");
    expect(d).toMatchObject({ arrow: "up", tone: "good", text: "+12.3% vs prev" });
    expect(d.srText).toContain("favourable");
  });
  it("lower-is-better flips the tone but not the arrow", () => {
    expect(formatDelta(8, "lower")).toMatchObject({ arrow: "up", tone: "bad" });
    expect(formatDelta(-8, "lower")).toMatchObject({ arrow: "down", tone: "good", text: "-8.0% vs prev" });
  });
  it("neutral when flat or missing", () => {
    expect(formatDelta(0.01).arrow).toBe("flat");
    expect(formatDelta(null)).toMatchObject({ arrow: "none", tone: "neutral" });
    expect(formatDelta(Number.NaN).arrow).toBe("none");
  });
});

describe("formatValue", () => {
  it("formats by unit and shows a dash for missing", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(45.25, "percent")).toBe("45.3%");
    expect(formatValue(3725, "seconds")).toBe("1h 02m");
    expect(formatValue(75, "seconds")).toBe("1m 15s");
    expect(formatValue(123456, "currency")).toBe("₹1,23,456");
    expect(formatValue(1234567)).toBe("12,34,567");
    expect(formatValue(0)).toBe("0");
  });
  it("formatDuration clamps negatives", () => expect(formatDuration(-5)).toBe("0s"));
});

describe("statusMeta", () => {
  it("has a text label for every status (colour is never the only cue) and defaults to no data", () => {
    for (const s of ["good", "warn", "bad", "nodata"]) expect(statusMeta(s).label.length).toBeGreaterThan(3);
    expect(statusMeta("weird").label).toBe("No data");
    expect(statusMeta(undefined).label).toBe("No data");
  });
});

describe("csvFilename", () => {
  it("is filesystem-safe and carries view and range", () => {
    expect(csvFilename("SBI CARD/01", "agents", "2026-09-01", "2026-09-30")).toBe("SBI_CARD_01_agents_2026-09-01_2026-09-30.csv");
    expect(csvFilename("", "daily", "a", "b")).toBe("process_daily_a_b.csv");
  });
});

describe("freshness helpers", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  it("formatAge", () => {
    expect(formatAge(2000)).toBe("just now"); expect(formatAge(12_000)).toBe("12s ago");
    expect(formatAge(5 * 60_000)).toBe("5m ago"); expect(formatAge(3 * 3600_000)).toBe("3h ago"); expect(formatAge(2 * 86400_000)).toBe("2d ago");
  });
  it("isStale uses 10 refresh cycles with a 30 minute floor", () => {
    expect(isStale("2026-09-30T11:50:00Z", now, 60)).toBe(false);
    expect(isStale("2026-09-30T11:20:00Z", now, 60)).toBe(true);
    expect(isStale("2026-09-30T08:00:00Z", now, 600)).toBe(true);
    expect(isStale(null, now)).toBe(false); expect(isStale("garbage", now)).toBe(false);
  });
});
