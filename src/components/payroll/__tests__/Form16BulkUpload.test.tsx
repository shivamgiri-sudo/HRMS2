import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { postForm: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { Form16BulkUpload, financialYearOptions } from "@/components/payroll/Form16BulkUpload";

describe("financialYearOptions", () => {
  it("before April the latest completed FY is the one ending the previous March", () => {
    expect(financialYearOptions(new Date(2026, 1, 10))).toEqual(["2024-25", "2023-24", "2022-23", "2021-22"]);
  });
  it("from April the just-ended FY is offered first", () => {
    expect(financialYearOptions(new Date(2026, 9, 3))).toEqual(["2025-26", "2024-25", "2023-24", "2022-23"]);
  });
  it("rolls the two-digit suffix across a century", () => {
    expect(financialYearOptions(new Date(2100, 5, 1), 1)).toEqual(["2099-00"]);
  });
});

describe("Form16BulkUpload", () => {
  const html = renderToStaticMarkup(<Form16BulkUpload />);
  it("explains the file naming and that nothing is saved before confirmation", () => {
    expect(html).toContain("Upload Form 16 (TRACES)");
    expect(html).toContain("PAN");
    expect(html).toContain("ABCDE1234F_");
  });
  it("starts with the check button disabled until files are chosen", () => {
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Check files/s);
  });
});
