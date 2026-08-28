/**
 * Direct regression test for the Task 6 gap: PAGE_CODE_BY_ROUTE dropped its entries for
 * the old attendance-exceptions/mismatch-queue paths (correctly — they now only redirect,
 * see AttendanceIntegrityRedirect.tsx) but ModuleLauncher's reverse lookup
 * (ROUTE_BY_PAGE_CODE, built from that same map) was never taught where
 * WFM_ATTENDANCE_EXCEPTIONS goes instead. Left unfixed, resolveLaunchRoute() silently fell
 * through to "/dashboard" for the eight roles holding that grant.
 *
 * This imports the real resolveLaunchRoute() from ModuleLauncher.tsx — not a source-text
 * regex like page-catalog-route-drift.contract.test.ts uses for its checks — so it proves
 * the actual resolution logic, not just that some string appears in the file.
 */
import { describe, expect, it } from "vitest";
import { resolveLaunchRoute } from "@/pages/ModuleLauncher";

describe("ModuleLauncher WFM_ATTENDANCE_EXCEPTIONS resolution", () => {
  it("resolves WFM_ATTENDANCE_EXCEPTIONS to the merged console's exceptions tab, not /dashboard", () => {
    const resolved = resolveLaunchRoute({
      page_code: "WFM_ATTENDANCE_EXCEPTIONS",
      // page_catalog's real, still-unmigrated row (backend/sql/1083_wfm_attendance_exceptions_page_code.sql)
      // — the fix must not depend on this ever being updated.
      route_path: "/wfm/attendance-exceptions",
    });

    expect(resolved).toBe("/wfm/attendance-integrity?tab=exceptions");
    expect(resolved).not.toBe("/dashboard");
  });

  it("still resolves correctly even with a null/absent db path (fallback-catalog case)", () => {
    const resolved = resolveLaunchRoute({
      page_code: "WFM_ATTENDANCE_EXCEPTIONS",
      route_path: null,
      page_path: null,
    });

    expect(resolved).toBe("/wfm/attendance-integrity?tab=exceptions");
  });

  it("leaves an unrelated, unmapped page code falling back to /dashboard (sanity check on the harness itself)", () => {
    const resolved = resolveLaunchRoute({
      page_code: "SOME_CODE_THAT_DOES_NOT_EXIST_ANYWHERE",
      route_path: "/this/route/does/not/exist",
    });

    expect(resolved).toBe("/dashboard");
  });
});
