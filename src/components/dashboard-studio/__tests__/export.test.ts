import { describe, it, expect } from "vitest";
import { toCsv } from "../export";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", 5]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",5');
  });
  it("neutralises spreadsheet formulas in text but leaves negative numbers alone", () => {
    expect(toCsv(["v"], [["=SUM(A1)"], ["@cmd"], [-5], [null]])).toBe("v\r\n'=SUM(A1)\r\n'@cmd\r\n-5\r\n");
  });
});
