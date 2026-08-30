/**
 * The third tab's gate, rendered.
 *
 * Kept apart from ProductivityUpload.test.tsx because it has to replace different modules: the
 * Bulk Upload Hub is a full page (dashboard chrome, auth context, the master-data tab's own data
 * loading), and the only thing under test here is whether the WFM Productivity Upload tab button
 * and panel exist at all for a given page grant. Everything else is stubbed to the least
 * interesting thing that still renders.
 *
 * Same environment constraint as the sibling suites: vitest runs `environment: "node"` and this
 * repo has no jsdom or @testing-library/react, so this renders through react-dom/server. Effects
 * do not run, which is what keeps the page's own `loadData()` out of the way.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canViewPage = vi.fn<(pageCode: string) => boolean>();
let isResolved = true;

vi.mock("@/hooks/useUserRole", () => ({
  useWorkforceAccess: () => ({
    isResolved,
    canViewPage: (pageCode: string) => canViewPage(pageCode),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "wfm@example.com" } }),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: { get: vi.fn(async () => ({ success: true, data: [] })) },
  getAuthToken: () => "test-token",
}));

// The tab's own panel is a whole upload flow with its own queries; it has its own suite. Stubbed
// to a marker so this file can assert presence and absence without a QueryClientProvider.
vi.mock("@/components/wfm/ProductivityUpload", async () => {
  const actual = await vi.importActual<typeof import("@/components/wfm/ProductivityUpload")>(
    "@/components/wfm/ProductivityUpload",
  );
  return {
    ...actual,
    ProductivityUpload: () => <div>productivity-upload-panel</div>,
  };
});

import BulkUploadHub from "@/pages/BulkUploadHub";

const TAB_LABEL = "WFM Productivity Upload";

function renderHub() {
  return renderToStaticMarkup(<BulkUploadHub />);
}

beforeEach(() => {
  vi.clearAllMocks();
  isResolved = true;
});

describe("BulkUploadHub — WFM Productivity Upload tab", () => {
  it("renders neither the tab button nor its panel when the grant is absent", () => {
    canViewPage.mockReturnValue(false);
    const html = renderHub();
    expect(html).not.toContain(TAB_LABEL);
    expect(html).not.toContain("productivity-upload-panel");
  });

  it("renders the tab button when the grant is held", () => {
    canViewPage.mockImplementation((code) => code === "WFM_PRODUCTIVITY_UPLOAD");
    const html = renderHub();
    expect(html).toContain(TAB_LABEL);
    expect(canViewPage).toHaveBeenCalledWith("WFM_PRODUCTIVITY_UPLOAD");
  });

  it("hides the tab while page access has not resolved, rather than guessing", () => {
    isResolved = false;
    canViewPage.mockReturnValue(true);
    expect(renderHub()).not.toContain(TAB_LABEL);
  });

  it("leaves the two existing tabs and the master panel untouched by the gate", () => {
    canViewPage.mockReturnValue(false);
    const html = renderHub();
    expect(html).toContain("Master Data Upload");
    expect(html).toContain("APR / Dialler Attendance");
    // "master" is the default tab, and its panel must still be the one on screen.
    expect(html).toContain("New Upload");
  });
});
