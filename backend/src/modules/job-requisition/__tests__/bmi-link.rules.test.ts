import { describe, expect, it } from "vitest";
import { normalizeBmiLink } from "../job-requisition-bmi-link.rules.js";

describe("normalizeBmiLink", () => {
  it("clears on null, undefined, empty and whitespace", () => {
    for (const v of [null, undefined, "", "   "]) expect(normalizeBmiLink(v)).toEqual({ ok: true, value: null });
  });
  it("trims and accepts a well-formed https url", () => {
    expect(normalizeBmiLink("  https://bmi.example.com/t?x=1  ")).toEqual({ ok: true, value: "https://bmi.example.com/t?x=1" });
  });
  it.each([
    ["http://bmi.example.com/a"],
    ["javascript:alert(1)"],
    ["data:text/html;base64,AAAA"],
    ["ftp://x.com/a"],
    ["bmi.example.com/a"],
    ["https://"],
    ["https://bmi.example.com/a b"],
    ["https://bmi.example.com/a\nb"],
    ["https://bmi.example.com/a\u0000"],
    ["https://" + "a".repeat(500) + ".com"],
  ])("rejects %s", (v) => {
    const r = normalizeBmiLink(v);
    expect(r.ok).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(normalizeBmiLink(42 as unknown).ok).toBe(false);
  });
  it("accepts exactly 500 chars", () => {
    const u = "https://a.com/" + "b".repeat(500 - 14);
    expect(u.length).toBe(500);
    expect(normalizeBmiLink(u).ok).toBe(true);
  });
});
