import { describe, expect, it, vi } from "vitest";

// The service imports the Onfido pool at module load; the pure helpers under test never touch it.
vi.mock("../../../db/onfidoDb.js", () => ({ getOnfidoPool: vi.fn() }));

import {
  buildExternalInputs,
  buildMatrixRows,
  buildRegionRows,
  buildTrailDaily,
  classifyExternalError,
  classifySla,
  computeAuditCards,
  computeTrailCards,
  formatDateLabel,
  parsePercentText,
  regionFromCountry,
  resolveFilters,
  topAnalysts,
  weekCommencingIso,
  weekCommencingLabel,
  type AuditMatrixInput,
} from "../onfido-poa-pages.service.js";

const input = (label: string, totalQc: number, errors: number, extra: Partial<AuditMatrixInput> = {}): AuditMatrixInput => ({
  label, totalQc, errors, classificationError: 0, extractionError: 0, comparisonError: 0, ...extra,
});

describe("buildMatrixRows", () => {
  it("appends a Grand Total row that sums every column and recomputes percentages", () => {
    const rows = buildMatrixRows(
      [
        input("A", 100, 2, { classificationError: 1, extractionError: 1 }),
        input("B", 300, 1, { comparisonError: 1 }),
      ],
      "ranked",
    );
    const grand = rows[rows.length - 1];
    expect(grand.isGrandTotal).toBe(true);
    expect(grand.particular).toBe("Grand Total");
    expect(grand.totalQc).toBe(400);
    expect(grand.errors).toBe(3);
    expect(grand.errorPct).toBeCloseTo(0.75, 10);
    expect(grand.classificationPct).toBeCloseTo(0.25, 10);
    expect(grand.extractionPct).toBeCloseTo(0.25, 10);
    expect(grand.comparisonPct).toBeCloseTo(0.25, 10);
  });

  it("uses errorBase (error + no-error) for Total Error % but Total QC for sub-error %", () => {
    const [row] = buildMatrixRows([input("A", 200, 4, { errorBase: 100, classificationError: 2 })], "ranked", false);
    expect(row.errorPct).toBeCloseTo(4, 10);
    expect(row.classificationPct).toBeCloseTo(1, 10);
  });

  it("returns 0% (not NaN) for a zero-volume row and no rows at all for empty input", () => {
    const [row] = buildMatrixRows([input("A", 0, 3)], "ranked", false);
    expect(row.errorPct).toBe(0);
    expect(buildMatrixRows([], "ranked")).toEqual([]);
  });

  it("sorts Date/WC tables chronologically by sortKey", () => {
    const rows = buildMatrixRows(
      [input("06-Jul-26", 1, 0, { sortKey: "2026-07-06" }), input("29-Jun-26", 1, 0, { sortKey: "2026-06-29" })],
      "chronological",
    );
    expect(rows.map((r) => r.particular)).toEqual(["29-Jun-26", "06-Jul-26", "Grand Total"]);
  });

  it("ranks other tables by errors desc, then error % desc, then volume desc, then name", () => {
    const rows = buildMatrixRows(
      [input("low", 1000, 2), input("high", 10, 5), input("mid-a", 100, 2), input("mid-b", 100, 2)],
      "ranked",
      false,
    );
    expect(rows.map((r) => r.particular)).toEqual(["high", "mid-a", "mid-b", "low"]);
  });

  it("drops rows with an empty label and no data", () => {
    const rows = buildMatrixRows([input("", 0, 0), input("A", 5, 0)], "ranked", false);
    expect(rows.map((r) => r.particular)).toEqual(["A"]);
  });
});

describe("topAnalysts", () => {
  const analysts = [
    input("a@x", 100, 0), input("b@x", 50, 0), input("c@x", 100, 5), input("d@x", 100, 1),
    input("Blank", 500, 0), input("zero@x", 0, 0),
    ...Array.from({ length: 12 }, (_, i) => input(`filler${i}@x`, 10, 1 + (i % 3))),
  ];

  it("Top Analyst lists lowest error % first, excludes Blank/zero volume and caps at 10", () => {
    const top = topAnalysts(analysts, false);
    expect(top).toHaveLength(10);
    expect(top[0].particular).toBe("a@x"); // 0 errors, larger volume beats b@x on tie
    expect(top[1].particular).toBe("b@x");
    expect(top.some((r) => r.particular === "Blank" || r.particular === "zero@x")).toBe(false);
    expect(top.some((r) => r.isGrandTotal)).toBe(false);
  });

  it("Top Defaulter lists most errors first", () => {
    const top = topAnalysts(analysts, true);
    expect(top[0].particular).toBe("c@x");
    expect(top[0].errors).toBe(5);
    expect(top.length).toBeLessThanOrEqual(10);
  });
});

describe("computeAuditCards", () => {
  it("derives sample, errors, error rate and accuracy from the audit base", () => {
    const cards = computeAuditCards([
      input("d1", 100, 1, { errorBase: 100, classificationError: 1 }),
      input("d2", 100, 0, { errorBase: 100, extractionError: 0 }),
    ]);
    expect(cards.sample).toBe(200);
    expect(cards.errors).toBe(1);
    expect(cards.errorRate).toBeCloseTo(0.5, 10);
    expect(cards.accuracy).toBeCloseTo(99.5, 10);
    expect(cards.classificationError).toBe(1);
  });

  it("shows 0 accuracy (not 100) when there are no audits", () => {
    expect(computeAuditCards([]).accuracy).toBe(0);
  });
});

describe("week commencing / date labels", () => {
  it("maps any weekday to its Monday", () => {
    expect(weekCommencingIso("2026-07-31")).toBe("2026-07-27"); // Friday
    expect(weekCommencingIso("2026-07-27")).toBe("2026-07-27"); // Monday
    expect(weekCommencingIso("2026-08-02")).toBe("2026-07-27"); // Sunday belongs to the prior Monday
    expect(weekCommencingIso("2026-07-01")).toBe("2026-06-29"); // crosses a month boundary
  });

  it("formats labels as dd-Mon-yy and leaves non-ISO input alone", () => {
    expect(formatDateLabel("2026-07-06")).toBe("06-Jul-26");
    expect(weekCommencingLabel("2026-07-31")).toBe("27-Jul-26");
    expect(formatDateLabel("Grand Total")).toBe("Grand Total");
  });
});

describe("region", () => {
  it("maps USA->US, CAN->CA and everything else (incl. blank) to EU", () => {
    expect(regionFromCountry("USA")).toBe("US");
    expect(regionFromCountry(" can ")).toBe("CA");
    expect(regionFromCountry("GBR")).toBe("EU");
    expect(regionFromCountry("")).toBe("EU");
    expect(regionFromCountry(null)).toBe("EU");
  });

  it("builds per-date rows with region splits and a Grand Total", () => {
    const rows = buildRegionRows([
      { date: "2026-07-02", country: "GBR", qc: 10, errors: 1 },
      { date: "2026-07-01", country: "USA", qc: 20, errors: 0 },
      { date: "2026-07-01", country: "CAN", qc: 5, errors: 1 },
      { date: "2026-07-01", country: "FRA", qc: 5, errors: 0 },
    ]);
    expect(rows.map((r) => r.dateLabel)).toEqual(["01-Jul-26", "02-Jul-26", "Grand Total"]);
    expect(rows[0]).toMatchObject({ euQc: 5, caQc: 5, caError: 1, usQc: 20, totalQc: 30, totalError: 1 });
    expect(rows[0].caErrorPct).toBeCloseTo(20, 10);
    const grand = rows[2];
    expect(grand.isGrandTotal).toBe(true);
    expect(grand).toMatchObject({ euQc: 15, euError: 1, totalQc: 40, totalError: 2 });
    expect(grand.totalErrorPct).toBeCloseTo(5, 10);
    expect(buildRegionRows([])).toEqual([]);
  });
});

describe("classifyExternalError", () => {
  it.each([
    ["Classification", "Incorrect document type", "classification"],
    ["Classification", "Unsupported country", "classification"],
    ["Extraction Error", "Address", "extraction"],
    ["Extraction error", "Issuing date", "extraction"],
    ["Extraction Error", "First name", "extraction"],
    ["Data Comparison", "Address", "comparison"],
    ["Data Comparison", "First Name", "comparison"],
    ["Other Language", "Incorrect document type", "classification"],
    ["Possible fraud", "Specimen Document", "other"],
    ["Image Quality", "Blurred Data Points", "other"],
    [null, null, "other"],
  ] as const)("reason %s / 2nd level %s -> %s", (reason, second, expected) => {
    expect(classifyExternalError(reason, second)).toBe(expected);
  });

  it("merges SQL groups per label, counting error buckets only on error rows", () => {
    const merged = buildExternalInputs([
      { label: "Acme", reason: "Supported Document", secondLevel: "Correctly Processed", audits: 90, errors: 0 },
      { label: "Acme", reason: "Extraction Error", secondLevel: "Address", audits: 3, errors: 3 },
      { label: "Acme", reason: "Data Comparison", secondLevel: "Address", audits: 1, errors: 1 },
      { label: "Acme", reason: "Possible fraud", secondLevel: "Specimen Document", audits: 1, errors: 1 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      totalQc: 95, errors: 5, classificationError: 0, extractionError: 3, comparisonError: 1,
    });
  });
});

describe("trail SLA", () => {
  it("classifies the SLA column: Greater than 30 Min is a miss, Less Then buckets are not", () => {
    expect(classifySla("Greater than 30 Min")).toBe("miss");
    expect(classifySla("Less Then 10 Min")).toBe("notMiss");
    expect(classifySla("Less Then 30 Min")).toBe("notMiss");
    expect(classifySla("")).toBe("unknown");
    expect(classifySla(null)).toBe("unknown");
  });

  it("parses percentage text, treating blanks as null", () => {
    expect(parsePercentText("100.00%")).toBe(100);
    expect(parsePercentText("")).toBeNull();
    expect(parsePercentText("abc")).toBeNull();
    expect(parsePercentText(null)).toBeNull();
  });

  it("aggregates per day and derives card totals and Miss SLA %", () => {
    const daily = buildTrailDaily([
      { date: "2026-07-09", slaStatus: "Greater than 30 Min", tasks: 1, audits: 1, errors: 0 },
      { date: "2026-07-08", slaStatus: "Less Then 10 Min", tasks: 1, audits: 1, errors: 1 },
      { date: "2026-07-08", slaStatus: "Less Then 30 Min", tasks: 1, audits: 1, errors: 0 },
      { date: "2026-07-08", slaStatus: "", tasks: 1, audits: 0, errors: 0 },
    ]);
    expect(daily.map((d) => d.date)).toEqual(["2026-07-08", "2026-07-09"]);
    expect(daily[0]).toMatchObject({ miss: 0, notMiss: 2, total: 2, tasks: 3, audits: 2, errors: 1 });
    expect(daily[0].errorPct).toBeCloseTo(50, 10);
    const cards = computeTrailCards(daily);
    expect(cards).toMatchObject({ total: 3, miss: 1, notMiss: 2 });
    expect(cards.missPct).toBeCloseTo(33.3333, 3);
    expect(computeTrailCards([]).missPct).toBe(0);
  });
});

describe("resolveFilters", () => {
  it("keeps valid ISO dates and trims TL/AM, blanking empties", () => {
    expect(resolveFilters({ from: "2026-07-01", to: "2026-07-31", tlName: " X ", amName: " " })).toEqual({
      from: "2026-07-01", to: "2026-07-31", tlName: "X", amName: null,
    });
  });

  it("defaults to the trailing 90 days when dates are missing or malformed", () => {
    const f = resolveFilters({ from: "nope" }, new Date(2026, 8, 19));
    expect(f.to).toBe("2026-09-19");
    expect(f.from).toBe("2026-06-21");
  });
});
