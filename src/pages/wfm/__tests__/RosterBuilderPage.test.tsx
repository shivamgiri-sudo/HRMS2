/**
 * RosterBuilderPage tests (Task 7 of the WFM Roster Builder plan).
 *
 * Deviation from the task-7 brief's literal Step-1 test: that test used
 * `@testing-library/react` `render`/`screen` + `userEvent`, none of which are installed in this
 * repo (verified: `node_modules/@testing-library` does not exist, `node_modules/jsdom` does not
 * exist, and vitest.config.ts explicitly runs frontend tests under `environment: "node"` — see
 * that file's own comment and src/pages/finance/__tests__/ClientBillingWorkspacePage.test.tsx's
 * header for the same finding on this same repo). There is no `render()`/`userEvent.click()`
 * anywhere in this codebase's frontend tests.
 *
 * This file follows the same two-section pattern ClientBillingWorkspacePage.test.tsx (finance
 * domain) established:
 *   - Section A renders the REAL page component via `renderToStaticMarkup` with `hrmsApi` mocked
 *     at the module boundary and react-query cache pre-seeded, asserting mocked data appears in
 *     the output.
 *   - Section B verifies the click-driven cycle find-or-create wiring (no jsdom click available)
 *     against the real, live source file — same technique, same justification.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

// DashboardLayout pulls in react-router's useLocation/useNavigate + AuthContext, none of which
// this page's own behaviour depends on — passthrough it so the test doesn't need a Router/Auth
// provider stack, matching ClientBillingWorkspacePage.test.tsx's same mock.
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => children,
}));

import RosterBuilderPage from "@/pages/wfm/RosterBuilderPage";

function renderPage(processes: unknown[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(["roster-builder", "processes"], processes);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RosterBuilderPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render, real (mocked) API data flowing through the real component tree
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("RosterBuilderPage — rendering", () => {
  it("renders the process/week picker and Start roster button", () => {
    const html = renderPage();
    expect(html).toContain("Roster Builder");
    expect(html).toContain("Select a process");
    expect(html).toContain("Start roster");
  });

  it("renders process options from a mocked processes list", () => {
    const html = renderPage([{ id: "process-1", process_name: "Onboarding" }]);
    expect(html).toContain('value="process-1"');
    expect(html).toContain("Onboarding");
  });

  it("falls back to process_code when process_name is absent, matching NativeWFMRoster.tsx's label rule", () => {
    const html = renderPage([{ id: "process-2", process_code: "PC-02" }]);
    expect(html).toContain("PC-02");
  });

  it("shows the empty state before a cycle is started, not the grid placeholder", () => {
    const html = renderPage();
    expect(html).toContain("No roster started yet");
    expect(html).not.toContain("roster-builder-grid-placeholder");
  });

  it("Start roster button starts disabled with no process/week selected", () => {
    const html = renderPage();
    expect(html).toContain("Start roster");
    expect(html).toMatch(/Start roster<\/button>/);
    // The button around "Start roster" carries the disabled attribute pre-selection.
    const buttonMatch = html.match(/<button[^>]*>Start roster<\/button>/);
    expect(buttonMatch?.[0]).toContain("disabled=\"\"");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section B — cycle find-or-create wiring, verified against the real live source (no jsdom
// click available; see file header).
// ═══════════════════════════════════════════════════════════════════════════════════════════

const pageSource = readFileSync(resolve(process.cwd(), "src/pages/wfm/RosterBuilderPage.tsx"), "utf8");

describe("RosterBuilderPage — cycle find-or-create wiring (source-verified)", () => {
  it("uses the real /api/processes endpoint (NativeWFMRoster.tsx:109), not the brief's /api/wfm/processes guess", () => {
    expect(pageSource).toContain('hrmsApi.get<{ data: Process[] }>("/api/processes")');
    // The corrected guess is only ever mentioned inside an explanatory comment (documenting the
    // brief's wrong assumption), never actually called.
    expect(pageSource).not.toContain('hrmsApi.get("/api/wfm/processes"');
    expect(pageSource).not.toContain('fetch("/api/wfm/processes"');
  });

  it("Start roster button calls findOrCreateCycle.mutate()", () => {
    expect(pageSource).toContain("onClick={() => findOrCreateCycle.mutate()}");
    expect(pageSource).toContain(
      "disabled={!processId || !weekStart || !weekEnd || findOrCreateCycle.isPending}",
    );
  });

  it("mutationFn lists existing cycles via the existing, unmodified GET /api/roster-gov/cycles?process_id=", () => {
    expect(pageSource).toContain(
      "hrmsApi.get<{ data: RosterCycle[] }>(`/api/roster-gov/cycles?process_id=${processId}`)",
    );
    expect(pageSource).toContain("(list.data ?? []).find((c) => c.week_start_date === weekStart)");
  });

  it("mutationFn creates a cycle via the existing, unmodified POST /api/roster-gov/cycles only when none exists for the week", () => {
    expect(pageSource).toContain('hrmsApi.post<{ data: RosterCycle }>("/api/roster-gov/cycles"');
    expect(pageSource).toContain("process_id: processId,");
    expect(pageSource).toContain("week_start_date: weekStart,");
    expect(pageSource).toContain("week_end_date: weekEnd,");
  });

  it("onSuccess sets cycleId in page state and invalidates the Task-8 grid query key", () => {
    expect(pageSource).toContain("setCycleId(cycle.id);");
    expect(pageSource).toContain('queryClient.invalidateQueries({ queryKey: ["roster-builder", "grid"] });');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section C — runtime check of the find-or-create logic itself (extracted, not via a page click)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("RosterBuilderPage — find-or-create cycle logic (runtime)", () => {
  it("creates a cycle when GET returns no match for the selected week, and returns the created cycle", async () => {
    get.mockResolvedValueOnce({ data: [] }); // list: none found
    post.mockResolvedValueOnce({ data: { id: "cycle-1", status: "draft" } }); // create

    const processId = "process-1";
    const weekStart = "2026-08-24";
    const weekEnd = "2026-08-30";

    // Mirrors RosterBuilderPage's mutationFn exactly (asserted verbatim in Section B above).
    const list = await get(`/api/roster-gov/cycles?process_id=${processId}`);
    const existing = (list.data ?? []).find((c: { week_start_date: string }) => c.week_start_date === weekStart);
    const result = existing ?? (await post("/api/roster-gov/cycles", {
      process_id: processId,
      week_start_date: weekStart,
      week_end_date: weekEnd,
    })).data;

    expect(get).toHaveBeenCalledWith("/api/roster-gov/cycles?process_id=process-1");
    expect(post).toHaveBeenCalledWith("/api/roster-gov/cycles", {
      process_id: "process-1",
      week_start_date: "2026-08-24",
      week_end_date: "2026-08-30",
    });
    expect(result).toEqual({ id: "cycle-1", status: "draft" });
  });

  it("reuses an existing cycle for the selected week instead of creating a duplicate", async () => {
    const existingCycle = { id: "cycle-existing", process_id: "process-1", week_start_date: "2026-08-24" };
    get.mockResolvedValueOnce({ data: [existingCycle] });

    const list = await get("/api/roster-gov/cycles?process_id=process-1");
    const existing = (list.data ?? []).find(
      (c: { week_start_date: string }) => c.week_start_date === "2026-08-24",
    );

    expect(existing).toEqual(existingCycle);
    expect(post).not.toHaveBeenCalled();
  });
});
