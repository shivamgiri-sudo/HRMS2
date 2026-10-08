/** Employee DPDP withdrawal page: the form must not demand a reason and must explain what happens. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => children }));

import NativeDPDPWithdrawal from "@/pages/NativeDPDPWithdrawal";

describe("NativeDPDPWithdrawal", () => {
  const html = renderToStaticMarkup(<NativeDPDPWithdrawal />);
  it("marks the reason optional and no longer shows a required asterisk", () => {
    expect(html).toContain("(optional)");
    expect(html).not.toContain("text-red-500\">*");
    expect(html).toContain("you do not have to give a reason");
  });
  it("tells the employee that law-required records are still kept", () => {
    expect(html).toContain("payroll");
    expect(html).toContain("which parts we can restrict");
  });
  it("states the decision deadline, what continues, the retention periods and the grievance route", () => {
    expect(html).toContain("within 7 days");
    expect(html).toContain("8 years");
    expect(html).toContain("5 years");
    expect(html).toContain("Grievance Officer");
    expect(html).toContain("<strong>optional</strong>");
  });
  it("renders the submit control", () => {
    expect(html).toContain("Submit Withdrawal Request");
  });
});
