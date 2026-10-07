import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(async () => ({ data: [], total: 0 })), post: vi.fn() } }));

import MyReportRequests from "@/components/reports/views/ReportRequestsView";

// Shape returned by GET /api/reports/my-requests (report-request.service.ts getMyReportRequests).
const ROW = {
  id: "r1", requestReference: "RPT-2026-000040", reportCode: "new-join-export", reportName: "New Join Employee Export",
  requestedFilters: { branch: "NOIDA" }, officialEmailMasked: "m***@teammas.in", status: "EMAILED",
  requestedAt: "2026-10-07T10:00:00.000Z", generationCompletedAt: "2026-10-07T10:00:25.000Z", emailSentAt: "2026-10-07T10:00:50.000Z",
  failureMessage: null, failureCode: null, retryCount: 0, expiresAt: "2026-10-14T10:00:00.000Z", generatedRowCount: 86, fileSizeBytes: 17806,
};

function render(rows: unknown[], key: unknown[] = ["my-report-requests", 1, "", ""]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(key, { success: true, data: rows, total: rows.length });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MyReportRequests />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("My Report Requests table", () => {
  it("renders every column from the API's camelCase fields (none blank)", () => {
    const html = render([ROW]);
    expect(html).toContain("RPT-2026-000040");
    expect(html).toContain("New Join Employee Export");
    expect(html).toContain("Emailed");
    expect(html).toContain("m***@teammas.in");
    // Requested, Generated and Emailed timestamps all rendered (no em dash placeholders for them).
    expect(html.match(/Oct 2026|7 Oct 2026|Oct 7, 2026/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("offers Retry for a failed request and Cancel for a queued one", () => {
    const html = render([
      { ...ROW, id: "r2", requestReference: "RPT-2026-000041", status: "GENERATION_FAILED", failureMessage: "boom", failureCode: "GENERATION_ERROR" },
      { ...ROW, id: "r3", requestReference: "RPT-2026-000042", status: "QUEUED", generationCompletedAt: null, emailSentAt: null },
    ]);
    expect(html).toContain("Retry");
    expect(html).toContain("Cancel");
    expect(html).toContain("boom");
  });

  it("shows status tabs and the empty state when nothing matches", () => {
    const html = render([]);
    for (const label of ["All", "In progress", "Emailed", "Failed"]) expect(html).toContain(label);
    expect(html).toContain("not submitted any report requests");
  });
});
