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

  // ── Reachable — a live defect, parked on a security decision. Found 2026-08-14.
  //
  // Unlike every other entry above, the backend for these is WRITTEN. bank-payment-readiness.routes.ts
  // exists and exports bankPaymentReadinessRouter; nothing ever calls app.use() on it. Grepping the
  // symbol outside its own file finds only a migration comment, a service comment and its own tests —
  // no mount. So all five 401 in production, which is indistinguishable from a permission failure
  // (the exact confusion this suite exists to catch).
  //
  // This is NOT unreachable scaffolding: /payroll/bank-readiness is routed in payroll.routes.tsx and
  // sits in the sidebar for super_admin, admin, payroll*, finance*, hr, branch_head and branch_admin.
  // Any of them can click "Bank Payment Readiness" today and get a page where every panel fails.
  //
  // Parked rather than fixed because the one-line mount is not a neutral act: the same router serves
  // GET /payment-file, described in its own header as "THE payment export. Full account numbers."
  // Mounting the router to green this contract would ship a full-account-number export as a side
  // effect of a test fix. That belongs to whoever owns payroll, with the export gating reviewed on
  // purpose — not to whoever happens to be unblocking CI. Listing them here states the gap honestly
  // and stops it blocking every unrelated deploy while that decision is made.
  "GET /api/payroll/bank-readiness/summary":
    "REACHABLE, LIVE DEFECT. bankPaymentReadinessRouter is exported but never mounted (no app.use), so this 401s for every role the page is offered to. Parked, not fixed, because mounting the router also exposes GET /payment-file — the full-account-number payment export — which needs a payroll-owner decision on its gating first. Mount the router as one deliberate change, or delete the page; do not add a narrower route to satisfy this line.",
  "GET /api/payroll/bank-readiness/exceptions":
    "Same unmounted router as /bank-readiness/summary — see that entry for why it is parked.",
  "GET /api/payroll/bank-readiness/remediation-list":
    "Same unmounted router as /bank-readiness/summary.",
  "GET /api/payroll/bank-readiness/payment-source-divergence":
    "Same unmounted router as /bank-readiness/summary.",
  "PATCH /api/payroll/bank-readiness/exceptions/:p":
    "Same unmounted router as /bank-readiness/summary. This is the write half — INSERT ... ON DUPLICATE KEY UPDATE against payroll_bank_exception — so the page's edit action fails silently today as well as its reads.",
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
