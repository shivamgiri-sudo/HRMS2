import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizeHeader, parseFlexibleSheet, normalizeDate, normalizeDurationSeconds,
  normalizeNumber, normalizeName,
} from "../flexible-parser.js";

function bufferFrom(header: string[], rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("normalizeHeader", () => {
  it("collapses spacing/underscore/capitalization variants to the same key", () => {
    expect(normalizeHeader("Agent_Name")).toBe(normalizeHeader("Agent Name"));
    expect(normalizeHeader("AGENT NAME")).toBe(normalizeHeader("agent  name"));
  });
});

describe("parseFlexibleSheet", () => {
  const fields = [
    { key: "date", aliases: ["Date"] },
    { key: "agentName", aliases: ["Agent Name", "Agent_Name"] },
    { key: "value", aliases: ["Value", "Amount"] },
  ];

  it("maps columns regardless of order and naming variant", () => {
    const buf = bufferFrom(["Value", "agent_name", "date"], [[100, "Test Agent", "2026-09-01"]]);
    const result = parseFlexibleSheet(buf, fields, ["date", "agentName"]);
    expect(result.validRows).toBe(1);
    expect(result.rows[0].agentName).toBe("Test Agent");
    expect(result.rows[0].value).toBe(100);
  });

  it("tolerates extra columns without failing", () => {
    const buf = bufferFrom(["Date", "Agent Name", "Value", "Some Random Extra Column"], [["2026-09-01", "Test", 50, "junk"]]);
    const result = parseFlexibleSheet(buf, fields, ["date", "agentName"]);
    expect(result.validRows).toBe(1);
    expect(result.additionalColumns).toContain("Some Random Extra Column");
  });

  it("tolerates missing optional columns without failing", () => {
    const buf = bufferFrom(["Date", "Agent Name"], [["2026-09-01", "Test"]]);
    const result = parseFlexibleSheet(buf, fields, ["date", "agentName"]);
    expect(result.validRows).toBe(1);
    expect(result.missingOptionalColumns).toContain("value");
    expect(result.rows[0].value).toBeNull();
  });

  it("skips blank rows without counting them as valid or duplicate", () => {
    const buf = bufferFrom(["Date", "Agent Name", "Value"], [
      ["2026-09-01", "Test", 50],
      [null, null, null],
      ["2026-09-02", "Test2", 60],
    ]);
    const result = parseFlexibleSheet(buf, fields, ["date", "agentName"]);
    expect(result.validRows).toBe(2);
  });

  it("detects duplicates by the dedupe key without deleting legitimate distinct rows", () => {
    const buf = bufferFrom(["Date", "Agent Name", "Value"], [
      ["2026-09-01", "Test", 50],
      ["2026-09-01", "Test", 50],
      ["2026-09-01", "Other Agent", 60],
    ]);
    const result = parseFlexibleSheet(buf, fields, ["date", "agentName"]);
    expect(result.validRows).toBe(2);
    expect(result.duplicateRows).toBe(1);
  });
});

describe("normalizeDate", () => {
  it("reads a real Excel serial", () => {
    expect(normalizeDate(46266)).toBe("2026-09-01");
  });
  it("reads D-Mon-YY (both prompts' own sample format)", () => {
    expect(normalizeDate("1-Sep-26")).toBe("2026-09-01");
  });
  it("reads D-M-YYYY (Housing Premium's own Created_At sample convention)", () => {
    expect(normalizeDate("1-9-2026")).toBe("2026-09-01");
  });
  it("reads ISO", () => {
    expect(normalizeDate("2026-09-03")).toBe("2026-09-03");
  });
  it("returns null rather than guessing", () => {
    expect(normalizeDate("not a date")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

describe("normalizeDurationSeconds", () => {
  it("reads HH:MM:SS", () => {
    expect(normalizeDurationSeconds("00:08:18")).toBe(8 * 60 + 18);
  });
  it("reads a bare seconds count without misreading it as minutes", () => {
    expect(normalizeDurationSeconds(17)).toBe(17);
  });
  it("reads an Excel time fraction", () => {
    expect(normalizeDurationSeconds(0.5)).toBe(43200);
  });
});

describe("normalizeNumber", () => {
  it("parses Indian-formatted thousands", () => {
    expect(normalizeNumber("1,25,000")).toBe(125000);
  });
  it("returns null for blank, not zero", () => {
    expect(normalizeNumber("")).toBeNull();
  });
});

describe("normalizeName", () => {
  it("matches names differing only in case/spacing", () => {
    expect(normalizeName("Dhiraj   Prajapati")).toBe(normalizeName("dhiraj prajapati"));
  });
});
