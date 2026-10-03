/**
 * Ops Control Tower on-behalf UX. Frontend suite runs under environment "node" (no jsdom), so the real
 * components are rendered with renderToStaticMarkup, hrmsApi mocked and the react-query cache seeded.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn(), postForm: vi.fn() } }));
const access = { roles: new Set<string>() };
vi.mock("@/hooks/useUserRole", () => ({
  useWorkforceAccess: () => ({ canViewPage: () => true, hasAnyRole: (...r: string[]) => r.some((x) => access.roles.has(x)) }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useIsReadOnly: () => false }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => children }));

import OpsControlTowerPage from "@/pages/ops/OpsControlTowerPage";
import { DetailRowItem } from "@/pages/ops/OpsDetailDrawer";
import { EmployeeDocuments } from "@/components/documents/EmployeeDocuments";

const block = (n: number) => ({ branches: [{ branchId: "b1", branchName: "NOIDA", count: n }], grandTotal: n });
const summary = {
  nowMs: Date.UTC(2026, 9, 3), esignSlaDays: 3, appointmentLetterSlaDays: 7,
  attendanceMismatch: { branches: [{ branchId: "b1", branchName: "NOIDA", count: 1, lastCorrectedMs: null }], grandTotal: 1 },
  rosterUploaded: { branches: [{ branchId: "b1", branchName: "NOIDA", lastDateMs: null, stale: true }] },
  joining: { branches: [{ branchId: "b1", branchName: "NOIDA", total: 1, buckets: { "Same day": 1 } }], grandTotal: 1, grandBuckets: { "Same day": 1 } },
  fnfPending: block(1), nocPending: block(1), digilockerPending: block(2), esignPending: block(1), appointmentLetter: block(1),
  pennyDropMissing: block(4), accountDetailsMissing: block(5), docsPending: block(6), bgvPending: block(1),
  itProvisioningPending: block(1), adminProvisioningPending: block(1), wfmProvisioningPending: block(1),
};
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function renderPage() {
  const qc = new QueryClient();
  qc.setQueryData(["ops-control-tower", today()], summary);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}><MemoryRouter><OpsControlTowerPage /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => access.roles.clear());

describe("Ops Control Tower page by role", () => {
  it("payroll_hr-only sees just the bank and penny-drop items, plus an explanatory note", () => {
    access.roles.add("payroll_hr");
    const html = renderPage();
    expect(html).toContain("Penny drop missing");
    expect(html).toContain("Account details missing");
    expect(html).not.toContain("DigiLocker pending");
    expect(html).not.toContain("F&amp;F pending");
    expect(html).not.toContain("Documents pending");
    expect(html).toContain("Showing the bank and penny-drop items");
  });

  it("HR sees the whole tower including the new Documents pending tile and section", () => {
    access.roles.add("hr");
    const html = renderPage();
    for (const label of ["Penny drop missing", "DigiLocker pending", "F&amp;F pending", "Documents pending"]) expect(html).toContain(label);
    expect(html).toContain("mandatory joining documents pending");
    expect(html).not.toContain("Showing the bank and penny-drop items");
  });

  it("a user who is payroll_hr AND hr is not narrowed", () => {
    access.roles.add("payroll_hr"); access.roles.add("hr");
    expect(renderPage()).toContain("DigiLocker pending");
  });
});

describe("drawer row", () => {
  const row = { employeeId: "e1", employeeCode: "MAS1", employeeName: "Asha Rao", daysOpen: 4, ageBucket: "3-7", status: "2 pending: Aadhaar copy, PAN card" } as never;
  const html = (b: Parameters<typeof DetailRowItem>[0]["block"]) =>
    renderToStaticMarkup(<MemoryRouter><DetailRowItem block={b} row={row} supported pending={false} onNotify={() => undefined} /></MemoryRouter>);

  it("docs-pending lists each missing document as a chip and offers Upload documents first", () => {
    const out = html("docs-pending");
    expect(out).toContain("Aadhaar copy");
    expect(out).toContain("PAN card");
    expect(out).not.toContain("2 pending:");
    expect(out.indexOf("Upload documents")).toBeLessThan(out.indexOf("Employee 360"));
    expect(out).toContain("/employees/e1/complete-profile?step=documents");
  });

  it("bank row's primary action opens the Bank step", () => {
    expect(html("account-details-missing")).toContain("/employees/e1/complete-profile?step=bank");
  });
});

describe("employee Documents tab", () => {
  it("employee view (no upload rights): pending-upload panel is rendered, no view/download controls without a file url", () => {
    const qc = new QueryClient();
    qc.setQueryData(["employee-documents", "e1"], [
      { id: "d1", employee_id: "e1", document_name: "PAN.pdf", document_type: "id_proof", file_url: null, verified: false, uploaded_at: "2026-10-01T00:00:00Z" },
    ]);
    qc.setQueryData(["employee-pending-documents", "e1"], [
      { id: "c1", document_name: "Aadhaar copy", status: "pending", mandatory: 1 },
      { id: "c2", document_name: "Photo", status: "verified", mandatory: 1 },
    ]);
    const out = renderToStaticMarkup(<QueryClientProvider client={qc}><EmployeeDocuments employeeId="e1" /></QueryClientProvider>);
    expect(out).toContain("Pending from you (1)");
    expect(out).toContain("Aadhaar copy");
    expect(out).not.toContain(">Photo<");
    expect(out).toContain("Under review");
    expect(out).not.toContain("View document");
    expect(out).not.toContain("Download document");
  });

  it("HR view keeps View / Download when a file url is present and shows no pending panel", () => {
    const qc = new QueryClient();
    qc.setQueryData(["employee-documents", "e1"], [
      { id: "d1", employee_id: "e1", document_name: "PAN.pdf", document_type: "id_proof", file_url: "/api/files/employee-documents/x.pdf", verified: true, uploaded_at: "2026-10-01T00:00:00Z" },
    ]);
    const out = renderToStaticMarkup(<QueryClientProvider client={qc}><EmployeeDocuments employeeId="e1" canUpload canDelete /></QueryClientProvider>);
    expect(out).toContain("View document");
    expect(out).toContain("Download document");
    expect(out).not.toContain("Pending from you");
  });
});

import { TaxDocumentsViewer } from "@/components/profile/TaxDocumentsViewer";

describe("Tax Documents panel", () => {
  const seed = (rows: unknown[]) => {
    const qc = new QueryClient();
    qc.setQueryData(["my-tax-documents", "e1"], rows);
    return renderToStaticMarkup(<QueryClientProvider client={qc}><TaxDocumentsViewer employeeId="e1" /></QueryClientProvider>);
  };
  it("shows status instead of dead View/Download buttons when the server withholds the file", () => {
    const out = seed([{ id: "t1", document_name: "Form 16 FY26", document_type: "form_16", file_url: null, verified: 0, uploaded_at: "2026-06-01T00:00:00Z" }]);
    expect(out).toContain("Form 16 FY26");
    expect(out).toContain("Under review");
    expect(out).not.toContain("View document");
  });
  it("keeps View/Download when a file url is present (HR view)", () => {
    const out = seed([{ id: "t1", document_name: "Form 16 FY26", document_type: "form_16", file_url: "/api/files/employee-documents/x.pdf", verified: 1, uploaded_at: "2026-06-01T00:00:00Z" }]);
    expect(out).toContain("View document");
    expect(out).toContain("Download document");
  });
});
