/**
 * Attendance Integrity redirects — Task 6 of the WFM attendance-page merge.
 *
 * The four pre-merge attendance paths (/wfm/attendance-exceptions, /wfm/mismatch-queue,
 * /wfm/cosec-monitoring, /attendance/billing-config) now redirect into the merged
 * /wfm/attendance-integrity console with the right tab. The regression this guards against
 * is the route wiring itself, not just the search-string-forwarding logic in isolation — so
 * these tests render the real `workforceRouteElements` route table (the same object App.tsx
 * mounts) through a `<Routes>` tree in a `MemoryRouter`, at the old path plus a real deep-link
 * query string, and assert on the resulting redirect target.
 *
 * Same node-environment approach as RosterRulesPage.test.tsx / RosterConsolidatedPages.test.tsx:
 * @testing-library/react and jsdom are not installed, and vitest runs frontend tests under
 * `environment: "node"`. `<Navigate>` computes its target during render but only calls
 * `navigate()` from a `useEffect`, which never fires under `renderToStaticMarkup` (no DOM, no
 * effects) — so `react-router-dom`'s `Navigate` is mocked here to render its `to` prop into a
 * visible element instead of returning null, which is the only way to observe it without a
 * DOM. Nothing about the redirect component's own logic is mocked or bypassed by this: the
 * mock only substitutes the leaf primitive so its otherwise-invisible prop can be asserted on.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) =>
      React.createElement("div", { "data-navigate-to": to }),
  };
});

// vi.mock calls are hoisted above imports by vitest's transform, so these static imports
// resolve against the mocked react-router-dom — same convention as RosterRulesPage.test.tsx.
import { workforceRouteElements } from "../workforce.routes";
import { AttendanceIntegrityRedirect } from "../AttendanceIntegrityRedirect";

const ROUTES_SRC = readFileSync(resolve(__dirname, "../workforce.routes.tsx"), "utf8");

function redirectTargetAt(path: string): string | null {
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(Routes, null, workforceRouteElements),
    ),
  );
  return html.match(/data-navigate-to="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;
}

describe("Attendance Integrity redirects (route table)", () => {
  it("sends /wfm/attendance-exceptions deep links to the exceptions tab, params intact", () => {
    expect(redirectTargetAt("/wfm/attendance-exceptions")).toBe(
      "/wfm/attendance-integrity?tab=exceptions",
    );
    expect(
      redirectTargetAt("/wfm/attendance-exceptions?issueType=salary_payable_days_mismatch&status=open"),
    ).toBe("/wfm/attendance-integrity?tab=exceptions&issueType=salary_payable_days_mismatch&status=open");
    expect(redirectTargetAt("/wfm/attendance-exceptions?issueType=missing_adr&status=open")).toBe(
      "/wfm/attendance-integrity?tab=exceptions&issueType=missing_adr&status=open",
    );
    expect(redirectTargetAt("/wfm/attendance-exceptions?severity=warning&status=open")).toBe(
      "/wfm/attendance-integrity?tab=exceptions&severity=warning&status=open",
    );
    expect(redirectTargetAt("/wfm/attendance-exceptions?status=resolved")).toBe(
      "/wfm/attendance-integrity?tab=exceptions&status=resolved",
    );
  });

  it("sends /wfm/mismatch-queue to the mismatches tab", () => {
    expect(redirectTargetAt("/wfm/mismatch-queue")).toBe(
      "/wfm/attendance-integrity?tab=mismatches",
    );
    expect(redirectTargetAt("/wfm/mismatch-queue?branchId=42")).toBe(
      "/wfm/attendance-integrity?tab=mismatches&branchId=42",
    );
  });

  it("sends /wfm/cosec-monitoring to the biometric tab", () => {
    expect(redirectTargetAt("/wfm/cosec-monitoring")).toBe(
      "/wfm/attendance-integrity?tab=biometric",
    );
  });

  it("sends /attendance/billing-config to the billing tab", () => {
    expect(redirectTargetAt("/attendance/billing-config")).toBe(
      "/wfm/attendance-integrity?tab=billing",
    );
  });

  it("lets the merged tab win over a stray pre-existing ?tab= rather than duplicating the key", () => {
    const target = redirectTargetAt("/wfm/mismatch-queue?tab=exceptions&status=open");
    expect(target).toBe("/wfm/attendance-integrity?tab=mismatches&status=open");
    expect(target?.match(/tab=/g)?.length).toBe(1);
  });

  it("registers all four old paths and the merged route", () => {
    for (const p of [
      "/wfm/attendance-integrity",
      "/wfm/attendance-exceptions",
      "/wfm/mismatch-queue",
      "/wfm/cosec-monitoring",
      "/attendance/billing-config",
    ]) {
      expect(ROUTES_SRC, `route ${p} missing`).toContain(`path="${p}"`);
    }
  });
});

describe("AttendanceIntegrityRedirect component in isolation", () => {
  function renderTarget(toTab: "exceptions" | "mismatches" | "biometric" | "billing", search = ""): string | null {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/wfm/attendance-exceptions${search}`] },
        React.createElement(AttendanceIntegrityRedirect, { toTab }),
      ),
    );
    return html.match(/data-navigate-to="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;
  }

  it("preserves every original param, order intact, after the tab key", () => {
    expect(renderTarget("exceptions", "?issueType=missing_adr&status=open")).toBe(
      "/wfm/attendance-integrity?tab=exceptions&issueType=missing_adr&status=open",
    );
  });

  it("returns just the tab param when there is no search string", () => {
    expect(renderTarget("billing")).toBe("/wfm/attendance-integrity?tab=billing");
  });
});
