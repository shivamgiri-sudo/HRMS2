import { describe, expect, it } from "vitest";
import {
  parseCsv,
  parseSheetDate,
  parseSheetNumber,
  validateSheetCsvUrl,
  SheetUrlError,
} from "../kpi-studio.gsheet.js";

/**
 * Google Sheet source: URL safety and parsing.
 *
 * Two areas, and the first is the one that matters most.
 *
 * The URL is supplied by an administrator over HTTP and then fetched BY THE SERVER. Without a
 * restriction that is a request-forgery primitive — http://169.254.169.254/latest/meta-data/ would
 * have the backend read cloud instance credentials and return them as "sheet data". So the allowlist
 * is tested against the shapes an attack actually takes, not just against a happy path.
 *
 * The parser matters because the existing CSV handling in quality-aggregator.service.ts uses
 * split('\n') then split(','), which breaks on a quoted comma — and breaks SILENTLY, shifting every
 * later column by one, so the numbers are wrong rather than absent. A KPI that is quietly wrong is
 * worse than one that is obviously broken.
 */

const PUBLISHED = "https://docs.google.com/spreadsheets/d/e/2PACX-1vABC/pub?gid=0&single=true&output=csv";

describe("validateSheetCsvUrl — SSRF guard", () => {
  it("accepts a genuine published CSV link", () => {
    expect(validateSheetCsvUrl(PUBLISHED)).toBe(PUBLISHED);
  });

  it("accepts the export form", () => {
    const url = "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0";
    expect(validateSheetCsvUrl(url)).toContain("export");
  });

  it("refuses the cloud metadata endpoint", () => {
    // The canonical SSRF target. On AWS this returns instance credentials.
    expect(() => validateSheetCsvUrl("http://169.254.169.254/latest/meta-data/")).toThrow(SheetUrlError);
    expect(() => validateSheetCsvUrl("https://169.254.169.254/latest/meta-data/")).toThrow(/Only published Google Sheets/);
  });

  it("refuses localhost and internal addresses", () => {
    for (const url of [
      "https://localhost:5055/api/admin/users",
      "https://127.0.0.1/",
      "https://10.0.0.5/internal",
      "https://192.168.1.1/",
      "https://[::1]/",
    ]) {
      expect(() => validateSheetCsvUrl(url)).toThrow(SheetUrlError);
    }
  });

  it("refuses a host that merely CONTAINS a Google domain", () => {
    // The bug a substring or unanchored-regex check would have. docs.google.com.attacker.example is
    // an attacker-controlled host.
    expect(() => validateSheetCsvUrl("https://docs.google.com.attacker.example/pub?output=csv")).toThrow(
      /Only published Google Sheets/,
    );
    expect(() => validateSheetCsvUrl("https://notdocs.google.com.evil.io/pub?output=csv")).toThrow(SheetUrlError);
  });

  it("refuses http", () => {
    expect(() => validateSheetCsvUrl("http://docs.google.com/spreadsheets/d/e/x/pub?output=csv")).toThrow(
      /must start with https/,
    );
  });

  it("refuses credentials embedded in the URL", () => {
    expect(() =>
      validateSheetCsvUrl("https://user:pass@docs.google.com/spreadsheets/d/e/x/pub?output=csv"),
    ).toThrow(/username or password/);
  });

  it("refuses other schemes outright", () => {
    for (const url of ["file:///etc/passwd", "gopher://docs.google.com/", "ftp://docs.google.com/x.csv"]) {
      expect(() => validateSheetCsvUrl(url)).toThrow(SheetUrlError);
    }
  });

  it("refuses an unpublished sheet link with instructions rather than a generic error", () => {
    // The most common real mistake: pasting the address bar URL. It returns Google's HTML sign-in
    // page, so without this check the failure surfaces later as "the sheet is empty".
    const editUrl = "https://docs.google.com/spreadsheets/d/1AbCdEf/edit#gid=0";
    expect(() => validateSheetCsvUrl(editUrl)).toThrow(/Publish to web/);
  });

  it("refuses blanks and non-URLs", () => {
    expect(() => validateSheetCsvUrl("")).toThrow(/Paste the published CSV link/);
    expect(() => validateSheetCsvUrl("   ")).toThrow(SheetUrlError);
    expect(() => validateSheetCsvUrl("just some text")).toThrow(/not a valid URL/);
  });

  it("accepts the googleusercontent host published links redirect to", () => {
    expect(() =>
      validateSheetCsvUrl("https://doc-0g-4s-sheets.googleusercontent.com/pub?output=csv"),
    ).not.toThrow();
  });
});

describe("parseCsv — RFC 4180", () => {
  it("parses a plain sheet", () => {
    const { headers, rows } = parseCsv("employee_code,call_date,audited\nMAS001,2026-08-21,12\n");
    expect(headers).toEqual(["employee_code", "call_date", "audited"]);
    expect(rows).toEqual([{ employee_code: "MAS001", call_date: "2026-08-21", audited: "12" }]);
  });

  it("keeps a comma inside quotes as data", () => {
    // The exact case split(',') gets wrong, shifting every later column by one.
    const { rows } = parseCsv('code,process,score\nMAS001,"Onfido, Voice",85\n');
    expect(rows[0].process).toBe("Onfido, Voice");
    expect(rows[0].score).toBe("85");
  });

  it("keeps a newline inside quotes as data", () => {
    // The case split('\n') gets wrong, which turns one row into two malformed ones.
    const { rows } = parseCsv('code,note,score\nMAS001,"line one\nline two",85\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("line one\nline two");
    expect(rows[0].score).toBe("85");
  });

  it("treats a doubled quote as one literal quote", () => {
    const { rows } = parseCsv('code,note\nMAS001,"she said ""ok"""\n');
    expect(rows[0].note).toBe('she said "ok"');
  });

  it("strips the UTF-8 BOM Google prefixes", () => {
    // Left in place the BOM becomes part of the first header's name, so a column called
    // employee_code silently fails to match.
    const { headers, rows } = parseCsv("\uFEFFemployee_code,score\nMAS001,85\n");
    expect(headers[0]).toBe("employee_code");
    expect(rows[0].employee_code).toBe("MAS001");
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseCsv("code,score\r\nMAS001,85\r\nMAS002,90\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ code: "MAS002", score: "90" });
  });

  it("skips blank spacer rows people leave in sheets", () => {
    const { rows } = parseCsv("code,score\nMAS001,85\n,,\n\nMAS002,90\n");
    expect(rows.map((row) => row.code)).toEqual(["MAS001", "MAS002"]);
  });

  it("does not invent a trailing row when the file ends with a newline", () => {
    expect(parseCsv("code,score\nMAS001,85\n").rows).toHaveLength(1);
  });

  it("handles a final row with no trailing newline", () => {
    expect(parseCsv("code,score\nMAS001,85").rows).toHaveLength(1);
  });

  it("tolerates a short row by leaving later columns blank", () => {
    const { rows } = parseCsv("code,a,b\nMAS001,1\n");
    expect(rows[0]).toEqual({ code: "MAS001", a: "1", b: "" });
  });

  it("returns no headers for empty input rather than throwing", () => {
    expect(parseCsv("").headers).toEqual([]);
  });
});

describe("parseSheetDate", () => {
  it("reads ISO dates", () => {
    expect(parseSheetDate("2026-08-21")).toBe("2026-08-21");
    expect(parseSheetDate("2026-8-1")).toBe("2026-08-01");
  });

  it("reads DD/MM/YYYY, the convention in this deployment's region", () => {
    expect(parseSheetDate("21/08/2026")).toBe("2026-08-21");
  });

  it("resolves the ambiguous case in favour of the only possible reading", () => {
    // 25 cannot be a month, so 25/03 is unambiguously 25 March regardless of locale.
    expect(parseSheetDate("25/03/2026")).toBe("2026-03-25");
    // The genuinely ambiguous 03/04 is taken as DD/MM, matching quality-data-mapper.ts so two
    // importers cannot disagree about what it means.
    expect(parseSheetDate("03/04/2026")).toBe("2026-04-03");
  });

  it("swaps when the second component cannot be a month", () => {
    expect(parseSheetDate("03/25/2026")).toBe("2026-03-25");
  });

  it("reads an Excel serial date", () => {
    // A cell formatted as a date publishes as a serial when the publish strips formatting.
    // 46255 is 2026-08-21 on the 1900 epoch (days since 1899-12-30), computed rather than guessed.
    expect(parseSheetDate("46255")).toBe("2026-08-21");
    expect(parseSheetDate("46234")).toBe("2026-07-31");
  });

  it("does not mistake a small count for a date", () => {
    // A cell holding 12 (calls handled) must not become 1900-01-12. The serial branch is bounded to
    // a plausible modern range for exactly this reason.
    expect(parseSheetDate("12")).toBeNull();
    expect(parseSheetDate("250")).toBeNull();
  });

  it("returns null for anything unreadable rather than guessing", () => {
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate("not a date")).toBeNull();
    expect(parseSheetDate("32/13/2026")).toBeNull();
  });
});

describe("parseSheetNumber", () => {
  it("reads plain numbers", () => {
    expect(parseSheetNumber("85")).toBe(85);
    expect(parseSheetNumber("85.5")).toBe(85.5);
    expect(parseSheetNumber("-3")).toBe(-3);
  });

  it("strips thousands separators and currency symbols", () => {
    expect(parseSheetNumber("50,000")).toBe(50000);
    expect(parseSheetNumber("₹1,25,000")).toBe(125000);
    expect(parseSheetNumber("$1,200.50")).toBe(1200.5);
  });

  it("reads a percentage as the number as written", () => {
    // 85% -> 85, NOT 0.85. A target for a percentage metric is also written as 85, so converting
    // here would make every such comparison wrong by 100x.
    expect(parseSheetNumber("85%")).toBe(85);
    expect(parseSheetNumber("92.5%")).toBe(92.5);
  });

  it("converts a duration to seconds, the unit operational metrics already use", () => {
    expect(parseSheetNumber("00:04:10")).toBe(250);
    expect(parseSheetNumber("4:10")).toBe(4 * 3600 + 10 * 60);
    expect(parseSheetNumber("7:30:00")).toBe(27000);
  });

  it("returns null for a blank or non-numeric cell rather than zero", () => {
    // The distinction the whole engine rests on: absent is not zero.
    expect(parseSheetNumber("")).toBeNull();
    expect(parseSheetNumber("   ")).toBeNull();
    expect(parseSheetNumber("N/A")).toBeNull();
    expect(parseSheetNumber("-")).toBeNull();
    expect(parseSheetNumber("pending")).toBeNull();
  });

  it("reads zero as zero", () => {
    expect(parseSheetNumber("0")).toBe(0);
  });
});
