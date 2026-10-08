import { describe, expect, it } from "vitest";
import { makeRowReader, normalizeHeaderKey } from "../onfido-header-match.js";
import { coerce, parseRatio } from "../onfido-coerce.js";
import { ONFIDO_REPORT_CONFIGS } from "../onfido-report-configs.js";

describe("makeRowReader — header drift tolerance", () => {
  it("prefers the exact key when present", () => {
    const read = makeRowReader({ "Yes/NO": "Yes", " Yes/NO": "stale" });
    expect(read("Yes/NO")).toBe("Yes");
  });

  it("finds a header the file carries with stray spaces (the leading-space bug)", () => {
    // Hub-trimmed keys never carry the space, but a config header that does must still resolve.
    const read = makeRowReader({ "Yes/NO": "No", "Avail%": "9.60%" });
    expect(read(" Yes/NO")).toBe("No");
    expect(read(" Avail% ")).toBe("9.60%");
  });

  it("matches case-insensitively", () => {
    expect(makeRowReader({ "Yes/No": "Yes" })("Yes/NO")).toBe("Yes");
  });

  it("falls back to declared aliases (the source system's own 'Occopancy%' typo)", () => {
    const read = makeRowReader({ "Occupancy%": "90.40%" });
    expect(read("Occopancy%", ["Occupancy%"])).toBe("90.40%");
    expect(makeRowReader({ "Occopancy%": "90.40%" })("Occopancy%", ["Occupancy%"])).toBe("90.40%");
  });

  it("returns undefined for a genuinely absent header instead of guessing", () => {
    expect(makeRowReader({ GD: "1" })("MCN%")).toBeUndefined();
  });

  it("normalizes whitespace runs and case for comparison", () => {
    expect(normalizeHeaderKey("  Report   Completed  Date ")).toBe("report completed date");
  });
});

describe("parseRatio — percent text from an XLSX->CSV conversion", () => {
  it("reads a percent-formatted cell as a ratio", () => {
    expect(parseRatio("93.0%")).toBe(0.93);
    expect(parseRatio("73.30%")).toBe(0.733);
    expect(parseRatio("105%")).toBe(1.05);
  });

  it("keeps the sign of a negative deficit", () => {
    expect(parseRatio("-19.7%")).toBe(-0.197);
  });

  it("passes an already-ratio General-format cell through unchanged", () => {
    expect(parseRatio("0.93")).toBe(0.93);
    expect(parseRatio("0.096")).toBe(0.096);
  });

  it("returns null for blank or non-numeric input", () => {
    expect(parseRatio("")).toBeNull();
    expect(parseRatio(undefined)).toBeNull();
    expect(parseRatio("n/a")).toBeNull();
  });

  it("is what the ratio coercion type uses", () => {
    expect(coerce("ratio", "90.40%")).toBe(0.904);
  });
});

describe("Onfido configs whose template is served from config", () => {
  const byCode = (code: string) => ONFIDO_REPORT_CONFIGS.find((c) => c.uploadTypeCode === code)!;

  it("lists trimmed headers only — the Hub trims what it reads, so a spaced header can never match", () => {
    for (const cfg of ONFIDO_REPORT_CONFIGS.filter((c) => c.templateFromConfig)) {
      for (const header of cfg.headers) expect(header).toBe(header.trim());
    }
  });

  it("GD MCN SLA declares the 17-Sep-26 file's columns, including Doc AHT and POA AHT", () => {
    expect(byCode("ONFIDO_GD_MCN_SLA").headers).toEqual([
      "GMT", "IST", "Date", "GD%", "MCN%", "Deficit", "SLA%", "Doc AHT", "POA AHT",
      "Commitment", "FTE Delivered", "APS%", "Occopancy%", "Avail%",
    ]);
  });

  it("POA External expects 'Yes/NO' without the old leading space", () => {
    expect(byCode("ONFIDO_POA_EXTERNAL_RAW").headers).toContain("Yes/NO");
    expect(byCode("ONFIDO_POA_EXTERNAL_RAW").headers).not.toContain(" Yes/NO");
  });

  it("every extract header of a config-served template exists in its headers list", () => {
    for (const cfg of ONFIDO_REPORT_CONFIGS.filter((c) => c.templateFromConfig)) {
      const known = new Set(cfg.headers);
      for (const e of cfg.extract) {
        if (e.header === "") continue; // synthetic dedup column
        expect(known.has(e.header), `${cfg.uploadTypeCode}: ${e.header}`).toBe(true);
      }
    }
  });
});
