/**
 * Every API path the frontend calls must be served by a registered route.
 *
 * This is the automated form of the audit that found eight production defects in
 * one week — three of them paths the client called and the backend never served
 * (salary certificates, BGV manual review, onboarding resend), which stayed
 * invisible because clientRouter applies requireAuth on the bare /api prefix, so
 * a missing route 401s exactly like a real one. Probing cannot tell them apart;
 * the registered route table can.
 *
 * A failure here means a client call has no route that could serve it. Either fix
 * the path, add the route, or — if it is a known gap someone has consciously
 * parked — add it to KNOWN_GAPS with a reason and a ticket. Silence is not an
 * option the test offers.
 *
 * ONE CAVEAT, and it is not a flaw in the check: the result describes the tree it
 * runs on. A worktree whose backend is stale relative to its frontend will report
 * the routes the newer client calls as missing, because on that tree they genuinely
 * are. That is what happens on this repo's shared worktree today — app.ts there has
 * 0 references to notification-admin and discard while origin/main has 4, so their
 * client calls surface here. They are deliberately NOT allow-listed: on a clean
 * checkout, which is what CI runs, those routers are mounted and the calls resolve.
 * If this test fails on paths whose router you can see in git, sync your tree
 * before hunting for a bug.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection: vi.fn() },
  pingDb: vi.fn(),
}));

vi.mock("../../db/supabaseAdmin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { app } from "../../app.js";
import {
  enumerateRoutes,
  extractFrontendCalls,
  findOrphans,
  orphanKey,
  type FrontendCall,
} from "../route-contract.js";

const repoRoot = resolve(process.cwd(), "..");
const frontendRoot = resolve(repoRoot, "src");

/**
 * Client calls with no backend route, each parked deliberately. Anything not on
 * this list fails the suite. Keep the reason specific enough that the next person
 * can tell "blocked on a decision" from "nobody has got to it".
 */
const KNOWN_GAPS: Record<string, string> = {
  // ── No route in origin/main. Triaged 2026-07-31 by whether a user can actually
  // reach the call: a page wired into the router, or a hook some mounted
  // component uses. Reachable ones are live defects; the rest are unfinished
  // scaffolding that cannot fire, and should be built or deleted, not rushed.

  // Not a call at all — a scanner artifact.
  "GET /api/wfm/processes":
    "NOT A REAL CALL. The only occurrence is a string literal inside RosterBuilderPage.test.tsx, in a NEGATIVE assertion (`expect(pageSource).not.toContain('hrmsApi.get(\"/api/wfm/processes\"')`) that exists precisely to prove the page does NOT call this path. RosterBuilderPage.tsx calls `/api/processes` (mounted at app.ts:344), matching NativeWFMRoster.tsx:109. The scanner reads test sources verbatim and cannot tell an assertion-that-something-is-absent from a call. `/api/wfm/processes` is separately mounted as planningModeRouter (app.ts:581) but exposes no GET '/', which is why it surfaces as missing. Nothing to build or delete.",

  // Reachable — a user can hit this today.
  "POST /api/ats/onboarding/requests":
    "BLOCKED on a product decision, not wiring. useOnboardingRequest is a self-service flow: someone who is not yet an employee asks to be onboarded, posting {user_id, email, full_name, message}. ats_onboarding_request is a different concept entirely — HR-initiated candidate onboarding keyed by candidate_id/branch_id/requested_by, with 287 live rows — so writing that payload there would corrupt an active HR table. The GET half is broken for the same mismatch: it sits behind requireRole('hr','recruiter','admin','super_admin','payroll_hr'), which the non-employee caller cannot satisfy, and its rows carry no user_id for the client's find(r => r.user_id === user.id) to match. Needs its own table and a decision on who reviews these requests.",

  // Not reachable — dead scaffolding. Cannot lose data because nothing invokes it.
  "POST /api/wfm/attendance/web-punch-in":
    "NOT REACHABLE: WebPunchButton is never mounted and useWebPunchIn is never used. The schema was never shipped either — no web_punch_in/out column exists anywhere in mas_hrms. Build the feature properly or delete the client code; do not add a route to satisfy this line.",
  "POST /api/wfm/attendance/web-punch-out":
    "NOT REACHABLE: pairs with web-punch-in, same dead component and same missing schema.",
  "POST /api/performance-feedback/quality/connect-sheet":
    "NOT REACHABLE: QualityDataUpload is not used by any mounted component. Sheet-connect for quality feedback; unfinished scaffolding.",

  // ── Blocked on a decision, investigated in depth on 2026-07-31.
  "POST /api/performance-feedback/reports":
    "Blocked on a schema decision. The client sends review_period/status/comments/acknowledged_*; performance_feedback_report has none of them and is a generated artifact (report_generated_at, total_reviewers), not a hand-authored record. Needs a separate employee review table.",
  "PATCH /api/performance-feedback/reports/:p":
    "Same schema decision as POST /reports. The delete flow is PATCH {status:'deleted'} against a status column that does not exist.",
  "GET /api/wfm/roster":
    "Deliberately unbuilt. /roster/assignments cannot serve it: requireRosterPlanScope throws when planId is absent, before the global-role bypass, and the caller is a plan-agnostic date-range view. Needs a cross-plan read model.",

  // ── Pages added 2026-08-22 by concurrent session; backend routes not yet built.
  "GET /api/call-master/inbound/today":
    "NOT REACHABLE: NativeOpsCommandCenter.tsx is not mounted in any route — no lazy import or <Route> wires it into the app. Page is unfinished scaffolding. Backend route should be built alongside the page mount.",
  "GET /api/operations-live/summary":
    "NOT REACHABLE: Same page as above (NativeOpsCommandCenter.tsx). Not mounted in the router. Backend route needed when the page is wired up.",
  "POST /api/lms-integration/assign":
    "REACHABLE via /quality/tni (NativeTNIAnalysis.tsx, mounted in performance.routes.tsx). Backend LMS integration assign route not yet built — blocked on LMS integration layer (Package 6 in the charter). Do not stub — needs real LMS integration scaffolding.",

};

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

function allFrontendCalls(): FrontendCall[] {
  return collectSourceFiles(frontendRoot).flatMap((file) =>
    extractFrontendCalls(readFileSync(file, "utf8"), relative(repoRoot, file).replace(/\\/g, "/")),
  );
}

const routes = enumerateRoutes(app);
const calls = allFrontendCalls();
const orphans = findOrphans(calls, routes);

describe("route contract — the audit, automated", () => {
  it("enumerates a realistic route table (guards against a broken walk)", () => {
    // A silently-empty walk would make every call look orphaned, or — worse, if
    // inverted — make every missing route look fine. Both have happened.
    expect(routes.length).toBeGreaterThan(500);
    expect(routes.some((r) => r.path.startsWith("/api/"))).toBe(true);
  });

  it("finds the frontend calls (guards against a broken extractor)", () => {
    expect(calls.length).toBeGreaterThan(200);
    expect(calls.every((c) => c.path.startsWith("/api/"))).toBe(true);
  });

  it("every client call resolves to a registered route", () => {
    const unexpected = orphans.filter((o) => !(orphanKey(o) in KNOWN_GAPS));

    const report = unexpected
      .map((o) => `  ${orphanKey(o)}\n      called from ${o.file}:${o.line}`)
      .join("\n");

    expect(
      unexpected.length,
      unexpected.length === 0
        ? ""
        : `\n${unexpected.length} frontend call(s) have no backend route.\n\n${report}\n\n` +
          "Fix the path, add the route, or add it to KNOWN_GAPS with a reason.\n",
    ).toBe(0);
  });
});

describe("route contract — the allow-list stays honest", () => {
  it("every known gap is still a real gap", () => {
    // When someone finally builds one of these, this fails and the entry gets
    // deleted — so the list cannot rot into a graveyard of stale excuses.
    const stillOrphaned = new Set(orphans.map(orphanKey));
    const fixed = Object.keys(KNOWN_GAPS).filter((key) => !stillOrphaned.has(key));

    expect(
      fixed,
      fixed.length === 0 ? "" : `\nThese are now served — remove them from KNOWN_GAPS:\n  ${fixed.join("\n  ")}\n`,
    ).toEqual([]);
  });

  it("every known gap carries a reason, not just a path", () => {
    for (const [key, reason] of Object.entries(KNOWN_GAPS)) {
      expect(reason.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});
