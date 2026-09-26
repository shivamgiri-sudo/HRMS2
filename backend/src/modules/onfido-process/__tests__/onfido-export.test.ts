import { describe, expect, it } from "vitest";
import { csvCell, csvLine, exportColumns } from "../onfido-export.service";

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Kamal Negi")).toBe("Kamal Negi");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises spreadsheet formulas but keeps real negative numbers", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-5")).toBe("-5");
  });

  it("prints nulls as empty and dates as ISO", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date(2026, 7, 3))).toBe("2026-08-03");
  });
});

describe("csvLine", () => {
  it("joins cells and ends with CRLF", () => {
    expect(csvLine(["a", 1, null])).toBe("a,1,\r\n");
  });
});

describe("exportColumns", () => {
  it("drops internal-tool URLs and loader bookkeeping, keeps dashboard data", () => {
    const cols = ["id", "report_date", "emp_name", "tl_name", "ims_url", "qc_tool_url", "ims_report_url",
      "task_url", "raw_data", "uploaded_at", "upload_batch_id", "row_hash", "aht_seconds", "emp_id"];
    expect(exportColumns(cols)).toEqual(["report_date", "emp_name", "tl_name", "aht_seconds", "emp_id"]);
  });
});
