import { describe, expect, it } from "vitest";
import { decomposeRatio } from "../decompose.js";
import { explain, fmtChange, fmtValue } from "../explain.js";

const meta = { key: "aht", label: "AHT", unit: "seconds", direction: "lower" as const };
const base = { metric: meta, dimension: "tl", dimensionNoun: "team leader", volumeUnit: "calls", minVolume: 30, baselineLabel: "last week" };

describe("explain", () => {
  it("formats values and changes by unit", () => {
    expect(fmtValue(311.3, "seconds")).toBe("311s"); expect(fmtValue(700, "seconds")).toBe("11m 40s"); expect(fmtChange(-3.25, "percent")).toBe("3.3 pp");
    expect(fmtValue(1234567, "count")).toBe("12,34,567"); expect(fmtValue(1500, "currency")).toBe("₹1,500");
  });
  it("names the rate driver with numbers that match the structured data", () => {
    const dec = decomposeRatio([
      { key: "TL_A", label: "TL_A", nA: 270 * 500, dA: 500, nB: 270 * 500, dB: 500, presentA: true, presentB: true },
      { key: "TL_B", label: "TL_B", nA: 270 * 500, dA: 500, nB: 510 * 500, dB: 500, presentA: true, presentB: true },
    ], { scale: 1, minVolume: 30 });
    const text = explain({ ...base, dec }).join(" ");
    expect(text).toContain("AHT rose 120s (unfavourable): 270s last week to 390s now (+44.4%)");
    expect(text).toContain("100% of the change comes from TL_B (+120s)"); expect(text).toContain("rate effect +120s");
  });
  it("names a mix driver and reports the share move in percentage points", () => {
    const dec = decomposeRatio([
      { key: "TL_B", label: "TL_B", nA: 400 * 30, dA: 30, nB: 400 * 42, dB: 42, presentA: true, presentB: true },
      { key: "TL_A", label: "TL_A", nA: 200 * 70, dA: 70, nB: 200 * 58, dB: 58, presentA: true, presentB: true },
    ], { scale: 1, minVolume: 1 });
    const text = explain({ ...base, dec }).join(" ");
    expect(text).toMatch(/share of calls moved from 30% to 42% \(\+12pp, mix effect \+/);
  });
  it("does not over-attribute to low-volume segments and says so", () => {
    const dec = decomposeRatio([
      { key: "big", label: "Big", nA: 300 * 500, dA: 500, nB: 330 * 500, dB: 500, presentA: true, presentB: true },
      { key: "tiny", label: "Tiny", nA: 100 * 3, dA: 3, nB: 2000 * 4, dB: 4, presentA: true, presentB: true },
    ], { scale: 1, minVolume: 30 });
    const text = explain({ ...base, dec }).join(" ");
    expect(text).toContain("1 low-volume team leader (under 30 calls) is not treated as a driver"); expect(text).toContain("comes from Big");
    expect(text).not.toContain("comes from Tiny");
  });
  it("says so when a period has no data instead of inventing a change", () => {
    const dec = decomposeRatio([{ key: "a", label: "A", nA: 0, dA: 0, nB: 10, dB: 1, presentA: false, presentB: true }], { scale: 1 });
    expect(explain({ ...base, dec })[0]).toContain("cannot be compared");
  });
});
