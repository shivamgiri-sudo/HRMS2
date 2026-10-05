import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let roles: string[] = [];
vi.mock("@/hooks/useUserRole", () => ({
  useWorkforceAccess: () => ({ hasAnyRole: (...want: string[]) => want.some((r) => roles.includes(r)) }),
}));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(async () => ({ data: [] })), post: vi.fn() } }));
vi.mock("@/hooks/useDateLockMin", () => ({ useDateLockMin: () => "2026-01-01" }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => children }));
vi.mock("@/components/payroll/PackageBuilderDialog", () => ({ PackageBuilderDialog: () => null }));
vi.mock("../PayrollHeadSalaryReviewQueue", () => ({ inr: (n: number) => String(n), fmtDate: (d: string) => String(d) }));

import { SalaryChangeHub } from "../SalaryChangeCenter";

function render(initialTab: "change" | "increment") {
  const qc = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SalaryChangeHub initialTab={initialTab} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { roles = []; });

describe("Salary Change & Increment hub", () => {
  it("the Payroll Head sees both tabs and lands on Change salary with the typed employee search", () => {
    roles = ["payroll_head"];
    const html = render("change");
    expect(html).toContain("Salary Change &amp; Increment");
    expect(html).toContain("Change salary");
    expect(html).toContain("Increment requests");
    expect(html).toContain("Search by name or employee code");
    expect(html).toContain("Step 1");
  });

  it("opening it as Increment (the old /salary-increment link) shows the increment requests", () => {
    roles = ["payroll_head"];
    const html = render("increment");
    expect(html).toContain("Raise a request");
    expect(html).toContain("New Request");
    expect(html).not.toContain("Step 1");
    expect(html).not.toMatch(/Finance Validate/);
  });

  it("HR sees only the increment requests: no tabs, no salary-change form, even if opened on the change tab", () => {
    roles = ["hr"];
    const html = render("change");
    expect(html).toContain("New Request");
    expect(html).not.toContain("Change salary");
    expect(html).not.toContain("Step 1");
  });

  it("the status filter has no Finance chip and defaults to what is waiting for approval", () => {
    roles = ["payroll_head"];
    const html = render("increment");
    expect(html).toContain("Pending approval");
    expect(html).toContain("Legacy import");
    expect(html).not.toContain("Finance Validated");
  });

  it("has a typed search and paging controls instead of listing every request", () => {
    roles = ["payroll_head"];
    const html = render("increment");
    expect(html).toContain("Search employee code or name");
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
  });
});
