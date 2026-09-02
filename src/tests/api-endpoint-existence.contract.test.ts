/**
 * Every /api/* path the frontend calls must be served by a route the backend actually mounts.
 *
 * WHY THIS EXISTS
 *   A page can be routed, gated, granted, linked in the nav and fully typechecked, and still
 *   call an endpoint nobody ever wrote. Nothing in the build catches it: TypeScript does not
 *   check URL strings, and a missing /api/* route answers 401 rather than 404 (the auth
 *   middleware runs before the miss), so it reads like a permissions problem instead of an
 *   absent feature.
 *
 *   A sweep on 2026-08-08 found seven such calls. All seven have since been built; anything that
 *   reappears here is a new one. None was a typo — each was a UI built against a
 *   server side that was never finished, which is the failure CLAUDE.md rule 9 names directly:
 *   "UI enhancement must not hide missing backend functionality." They accumulated silently
 *   because nothing was watching.
 *
 * WHAT IT DOES AND DOES NOT PROVE
 *   Proves: the path matches some mounted route. Does NOT prove the handler returns the shape
 *   the caller expects — three of the seven below would still have been wrong after a URL fix,
 *   because the columns they read do not exist anywhere in the schema. Route existence is the
 *   floor, not the ceiling.
 *
 * SIX PARSER TRAPS, each of which made an earlier draft accuse working code
 *   The raw first run reported 281 dead endpoints; the true answer was 7. Every one of these
 *   was a bug in the READER, found by verifying candidates by hand against the serving module:
 *     1. app.use quote style is not consistent — one mount uses single quotes. Matching only
 *        double quotes dropped 23 live /api/wfm/attendance/* routes.
 *     2. `router.get ("/overview"` has a space before the paren in portal.routes.ts. Without
 *        \s* the entire client-portal surface reads as missing.
 *     3. A template appended with no preceding slash (`/summary${qs}`) is a query string, not
 *        a path segment. Treating it as one invented 22 fake /api/finance misses.
 *     4. org.routes.ts registers through a CRUD factory — router.get(path, ...) with `path` a
 *        parameter — so its paths are invisible to any static reader. Such prefixes are marked
 *        UNVERIFIABLE rather than reported: claiming /api/org/branches is missing, when 25
 *        files call it daily, would discredit every other finding.
 *     5. The CALLER can hold the wildcard while the route holds a literal —
 *        `/candidates/${id}/${section}` against /candidates/:candidateId/payroll. Matching
 *        must allow a wildcard on either side (see isServed).
 *     6. A base constant (`const API = "/api/ats/onboarding-full"`, called as `${API}/save`)
 *        is seen bare, because the composed string does not begin "/api/". Sub-mount points
 *        are therefore recorded as served in their own right.
 *
 *   If this test ever starts failing on something obviously alive, suspect a SEVENTH trap of
 *   the same kind before suspecting the route. Verify against the serving module by hand.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../..");
const BE = `${REPO}/backend/src`;

const cache = new Map<string, string | null>();
function read(file: string): string | null {
  if (!cache.has(file)) {
    let value: string | null = null;
    for (const candidate of [file, file.replace(/\.ts$/, "/index.ts")]) {
      try { value = readFileSync(candidate, "utf8"); break; } catch { /* try the next */ }
    }
    cache.set(file, value);
  }
  return cache.get(file) ?? null;
}

/** Local imports declared in one file, so a router symbol can be followed to its source. */
function importMap(src: string, fromFile: string): Map<string, string> {
  const map = new Map<string, string>();
  const dir = dirname(fromFile);
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
    const target = resolve(dir, m[2].replace(/\.js$/, ".ts"));
    for (const raw of m[1].split(",")) {
      const sym = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (sym) map.set(sym, target);
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*"(\.[^"]+)"/g)) {
    map.set(m[1], resolve(dir, m[2].replace(/\.js$/, ".ts")));
  }
  return map;
}

// `\s*` before every paren is load-bearing — see trap 2.
const VERB =
  /\b[A-Za-z_$][\w$]*\.(get|post|put|patch|delete|all)\s*\(\s*\n?\s*(?:`([^`\n]*)`|"([^"\n]*)"|'([^'\n]*)')/g;
const USE =
  /\b[A-Za-z_$][\w$]*\.use\s*\(\s*\n?\s*(?:(?:`([^`\n]*)`|"([^"\n]*)"|'([^'\n]*)')\s*,\s*)?([^)]*)\)/g;
const DYNAMIC_REGISTRATION =
  /\b[A-Za-z_$][\w$]*\.(?:get|post|put|patch|delete|all)\s*\(\s*(?!["'`])[A-Za-z_$]/;

const served = new Set<string>();
const dynamicPrefixes = new Set<string>();
const visited = new Set<string>();

function walkRouter(file: string, prefix: string, depth: number): void {
  const key = `${file}|${prefix}`;
  if (depth > 6 || visited.has(key)) return;
  visited.add(key);
  const src = read(file);
  if (!src) return;
  const imports = importMap(src, file);

  for (const m of src.matchAll(VERB)) {
    const p = m[2] ?? m[3] ?? m[4] ?? "";
    served.add((prefix + (p === "/" ? "" : p)).replace(/\/+$/, "") || "/");
  }

  if (DYNAMIC_REGISTRATION.test(src)) dynamicPrefixes.add(prefix); // trap 4

  for (const m of src.matchAll(USE)) {
    const sub = m[1] ?? m[2] ?? m[3] ?? "";
    for (const rawArg of (m[4] || "").split(",")) {
      const sym = rawArg.trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(sym) || !/router/i.test(sym)) continue;
      const target = imports.get(sym);
      if (!target) continue;
      // Record the sub-mount POINT itself, not only the routes beneath it — trap 6.
      // Files declare base constants (`const API = "/api/ats/onboarding-full"`) and call
      // `${API}/save`. The composed call is invisible to a reader scanning for strings that
      // begin "/api/", so only the bare base is seen, and a base that Express really does
      // mount is not a missing endpoint.
      const subPrefix = (prefix + sub).replace(/\/+$/, "");
      if (sub) served.add(subPrefix);
      walkRouter(target, subPrefix, depth + 1);
    }
  }
}

const appSrc = read(`${BE}/app.ts`)!;
const appImports = importMap(appSrc, `${BE}/app.ts`);
// All three quote characters — see trap 1.
for (const m of appSrc.matchAll(
  /app\.use\(\s*(?:"(\/api[^"]*)"|'(\/api[^']*)'|`(\/api[^`]*)`)\s*,\s*([^)]+)\)/g
)) {
  const prefix = (m[1] ?? m[2] ?? m[3]).replace(/\/+$/, "");
  served.add(prefix);
  for (const sym of m[4].split(",").map((s) => s.trim()).filter(Boolean)) {
    const target = appImports.get(sym);
    if (target) walkRouter(target, prefix, 0);
  }
}

/**
 * Segment-wise matching with wildcards on BOTH sides — trap 5.
 *
 * A regex built only from the served side compares the caller's wildcard against the route's
 * literal and fails. NativeJoiningControlRoom builds its last segment from a variable —
 * `/candidates/${id}/${section}` where section is "payroll" | "jclr" | "statutory" — and the
 * backend declares those as separate literal routes. Both sides are right; only the matcher
 * was wrong. So a wildcard on either side matches anything in that position.
 *
 * This cannot mask a real miss, because segment COUNT must still agree: /upload/:x is three
 * segments and /upload-neemans-apr is two, so the dead sales-upload call stays dead.
 */
const servedSegments = [...served].map((p) => p.split("/"));
const isWildcard = (seg: string) => seg.startsWith(":") || seg === "*";

function isServed(callPath: string): boolean {
  const call = callPath.split("/");
  return servedSegments.some((route) => {
    if (route.length !== call.length) return route.at(-1) === "*" && call.length >= route.length;
    return route.every((seg, i) => seg === call[i] || isWildcard(seg) || isWildcard(call[i]));
  });
}

/** Every /api/... string in the app source, normalised to a comparable path. */
function frontendCalls(): Map<string, string[]> {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (/node_modules|\.test\.|__tests__|\.d\.ts$/.test(full)) continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  })(`${REPO}/src`);

  const calls = new Map<string, string[]>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`](\/api\/[^"'`\s]*)/g)) {
      let p = m[1].split("?")[0];
      p = p.replace(/([^/])\$\{[^}]*\}/g, "$1"); // query / intra-segment — see trap 3
      p = p.replace(/\$\{[^}]*\}/g, ":x");        // after a slash: a real parameter
      p = p.replace(/\/+$/, "").split("#")[0];
      if (!p || p.includes("${") || p.includes("{")) continue;
      const rel = file.replace(`${REPO}/`, "");
      calls.set(p, [...(calls.get(p) ?? []), rel]);
    }
  }
  return calls;
}

/**
 * Calls with no matching route as of 2026-08-09. Each was verified by hand against the
 * serving module — none is a typo, and none can be fixed by editing the URL.
 *
 * Listed so this test can pass today and fail on the EIGHTH one. Removing an entry requires
 * building the endpoint, not repointing the call.
 */
const KNOWN_MISSING: Record<string, string> = {
  // UnifiedPerformanceCommandCenter.tsx. The page is honest about these — it renders
  // "Some performance data sources are unavailable … This is not an all-clear" rather than
  // letting an empty array become a real zero. But three of its seven feeds can never load,
  // so that banner is permanent and its quality/ops alerts never actually evaluate.
  // /api/quality-dashboard/scores used to sit here too, described as unbuildable because no
  // endpoint returned quality_score and fatal_count together. The real obstacle was
  // ATTRIBUTION, and it was solvable: db_audit identifies an agent only by an 8-char dialer
  // login, and employees.call_centre_code — the obvious bridge — is NULL on all 58,627 rows.
  // Shivamgiri.employee_source_alias maps employee_code to source_agent_name per source_system
  // and resolves 17,949 of 19,827 audits (90.5%), every one with a branch.
  //
  // The lesson matches the ops entry above: "the data does not exist" was really "I looked for
  // it under one name, in one database". Both feeds were built once the right table was found.
  // /api/performance-dashboard/ops used to sit here, described as "unfixable by URL:
  // handled_volume, target_volume and shrinkage_minutes appear NOWHERE in the backend". That
  // was wrong, and wrong in an instructive way: those exact column NAMES appear nowhere, but
  // the metrics do. mas_hrms.apr carries Calls, Net_Login and BIO/LUNCH/QA/DISMX/TRAINING for
  // 37,867 rows, with branch_name and process_name already denormalised. Searching for the
  // caller's field names found nothing; searching for the concept found the table.
  // target_volume genuinely does not exist and is omitted rather than invented.

  // The two sales-upload entries that used to sit here are gone: POST /upload/:type and
  // DELETE /batch/:batchId are now wired to the handlers that had always existed.
  //
  // Worth recording why they were held back, because the reasoning was half wrong. They were
  // left unwired on the grounds that db_masmis returns ER_TABLEACCESS_DENIED_ERROR to the
  // application user, so adding routes would only turn a 401 into a 500 — "needs a GRANT,
  // not a route".
  //
  // I then over-corrected and claimed the real cause was that db_masmis sits on a different
  // server. That was an inference from the same error code, and it is invalid: MySQL returns
  // ER_TABLEACCESS_DENIED_ERROR for any database the user lacks privileges on, existing or
  // not — `SELECT ... FROM db_definitely_not_here.x` returns the identical code. The original
  // "needs a GRANT" reading may well have been right.
  //
  // What is established: the routes are wired now, and MASMIS_DB_HOST/PORT/USER/PASSWORD exist
  // (defaulting to DB_* when unset) so the module can reach db_masmis wherever it turns out to
  // be. The lesson worth keeping is about the diagnosis, not the location: an error code that
  // answers "may I read this" was twice read as answering "where is this".

  // Not a fetch, but still a promise the product makes and does not keep.
  "/api/webhooks/:x":
    "SimpleConnectorWizard DISPLAYS this to the user as 'your webhook URL will be /api/webhooks/{key}'. No /api/webhooks is mounted anywhere, so any external system configured against it posts into nothing. Listed here rather than ignored because the URL is published to third parties.",

  // ── RosterComplianceMonitor (/wfm/roster-compliance), audited 2026-08-28 ──────────────
  // A backend for this dashboard DOES exist — wfm-compliance-analytics.routes.ts, mounted at
  // /api/wfm/compliance, and its own doc comments say it was written for this page. It is not
  // a matter of correcting the prefix, which is why these are listed rather than repointed:
  //   • /summary returns {period, compliancePct, totalEmployees, totalViolations, rules[],
  //     trend} where the page consumes {overallScore, byRule{...}, byBranch, byProcess}. The
  //     rules[] array does carry all five rule types, so summary and trend are adaptable.
  //   • /violations is a DIFFERENT DOMAIN. It returns attendance exceptions
  //     (ABSENT_NO_CALL, LATE_ARRIVAL, status WEEK_OFF/WORKING); the page wants roster-rule
  //     breaches (MINIMUM_REST, CONSECUTIVE_DAYS, ...) with an OPEN/ACKNOWLEDGED/RESOLVED
  //     workflow that has no table behind it. Wiring one to the other would file "Late
  //     Arrival" under "Minimum Rest violations".
  // Deeper still: that engine queries `roster_assignment`, which holds 0 rows. The live roster
  // is `wfm_roster_assignment` (417,773). Because its own fallback is `: 100` when
  // total_shifts = 0, the backend itself returns 100% compliance with 0 violations. Repointing
  // the table is a product decision about which roster is authoritative — both are live code
  // paths — so it is deliberately not made here.
  // /api/roster-compliance/{summary,violations,trend} used to sit here. RESOLVED 2026-08-28 —
  // RosterComplianceMonitor now calls /api/wfm/compliance/* with adapters, so these paths are
  // no longer requested by anything and listing them would describe a call that does not exist.
  //
  // The blocker was never only the prefix. That engine queried roster_assignment (0 rows) and
  // returned a flat 100% through its own `: 100` fallback, so repointing alone would have
  // swapped an error state for a false all-clear. It was repointed to wfm_roster_assignment
  // first (bbe27b4b), and only then was the frontend wired up.
  //
  // One genuine gap remains and is NOT hidden by that wiring: /violations serves
  // attendance-derived breaches (ABSENT_NO_CALL, LATE_ARRIVAL), not the five roster rules the
  // summary counts, and the page's OPEN/ACKNOWLEDGED/RESOLVED workflow still has no backing
  // table. The rows render under their own honest labels rather than being forced into rule
  // buckets they do not belong to.

  // ── RosterInterventionDashboard (/wfm/roster-interventions) ───────────────────────────
  // Served in substance at /api/analytics/intervention-recommendations (/outcomes, /pending,
  // PATCH /:id) — the paths and the verb differ from what the page calls, and /outcomes
  // covers total/retained/exited/pending/retentionRate but not the byTier breakdown the page
  // renders. Repointing is cheap; it would also change nothing a user sees, because
  // employee_retention_recommendation holds 0 rows. This is an unpopulated feature, not a
  // broken one, so the honest fix is to generate recommendations, not to move a URL.
  // /api/analytics/interventions/* used to sit here. RESOLVED 2026-08-28 —
  // RosterInterventionDashboard now calls /api/analytics/intervention-recommendations/{outcomes,
  // pending} and PATCH /:id, which is where that router has always been mounted.
  //
  // Two mismatches beyond the path were fixed with it: the API is snake_case and returns a
  // narrower column set than the page's camelCase type described, and the page sent `tier` and
  // `outcome` parameters the handler ignores (tier is now filtered client-side; outcome is not
  // filtered at all, because /pending already selects outcome = 'pending' and filtering on
  // anything else would blank the list rather than narrow it).
  //
  // What wiring does NOT fix, and is deliberately left visible: employee_retention_recommendation
  // holds 0 rows, so the page honestly shows zeros until recommendations are generated. The
  // difference is that a 401 from an unserved URL was indistinguishable from a quiet week.
  // /outcomes also carries no per-tier split, so byTier is counted from the pending rows.

  // /api/workforce-mandate/hiring-demand used to sit here, described as genuinely absent and
  // needing a priority model that did not exist. RESOLVED 2026-08-28 — and the description was
  // wrong. /capacity-summary already returns both the hiringDemand total AND a per-process
  // `hiringByProcess` breakdown carrying its own priority, bucketed from each mandate's
  // headcount. It was a duplicated endpoint, not a missing one.
  //
  // WFMCapacityDashboard now derives the panel from the /capacity-summary response it already
  // fetches, so the page makes one request fewer than before rather than one more. `critical`
  // stays 0 on purpose: the API buckets HIGH/MEDIUM/LOW and has no CRITICAL tier, and inventing
  // a threshold to fill that tile would manufacture a severity the data does not express.

  // ── NativeTNIAnalysis (/wfm/tni-analysis) ─────────────────────────────────────────────
  // The two /api/quality-dashboard/tni-* entries are gone as of 2026-08-28, and my note on
  // them ("training-needs analysis was never built on the backend") was wrong. tni.service.ts
  // already exported getTniAnalysis and getTniAgentCalls in full — the exact two calls this
  // page documents in its own header — and was imported by nothing, so both 401'd. Mounting
  // them in quality-dashboard.routes.ts was the entire fix. Verified live before wiring:
  // db_audit.call_quality_assessment holds 452,620 rows through today, and August returns 58
  // agents with 51 flagged for coaching. The page is now linked in the sidebar.
  // /api/lms-integration/assign is retired 2026-08-28 — the page calls POST /api/lms/assign
  // now, where lmsIntegrationRouter is mounted, and that endpoint is served.
  //
  // It deliberately does less than its name: it records a `training_need` row in HRMS at status
  // 'identified' and does NOT write into the LMS, because CLAUDE.md makes the deployed LMS the
  // system of record for learning assignments. training_need's status enum
  // ('identified' -> 'mapped_to_lms' -> 'in_training' -> ...) is built for that handoff. The
  // response and the page's toast both say "recorded in HRMS, LMS enrolment actioned
  // separately" rather than claiming anyone is enrolled.

  // ── NativeOpsCommandCenter (/ops/command-center) ──────────────────────────────────────
  // Both entries retired 2026-08-28. Like the TNI pair, neither endpoint was missing — each
  // was mounted under a different prefix, and the page has been repointed:
  //   /api/call-master/inbound/today  ->  /api/inbound/today          (inboundRouter, app.ts)
  //   /api/operations-live/summary    ->  /api/operations/live-status (reads .summary off
  //                                       {agents, summary, timestamp})
  // My earlier note called the second "a missing handler as well as a prefix mismatch". Wrong
  // on the first half: live-status already returns exactly the OperationsSummary this panel
  // renders — total_agents, logged_in, on_break, logged_out, absent, avg_call_duration.
  //
  // The page still is NOT linked in the sidebar, for a reason unrelated to these two feeds:
  // its Escalation Signals and Process Utilization sections are hardcoded to empty arrays
  // behind "mock for now - replace with real endpoints" comments. Two working feeds do not
  // make half a stubbed screen worth advertising. See app-shell-routing.contract.test.ts.

  // ── KPI Studio (src/hooks/useKpiStudio.ts) ────────────────────────────────────────────
  // A KPI-definition builder: data sources, formula validation/preview/compute, coverage
  // checking, employee scope, and a manual-value upload flow. Genuinely absent, not a prefix
  // mismatch -- there is no backend/src/modules/kpi-studio directory at all, no route file
  // under any name, nothing to repoint to. The hook's own StudioCapability check
  // ({tables, resolution}) suggests the UI is meant to degrade gracefully when this 401s,
  // but that has not been verified against a real KPI Studio page render.
  "/api/kpi-studio/capability": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/formula-help": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/metrics": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/scope-options": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/data-sources": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/data-sources/:x": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/data-sources/:x/columns": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/data-sources/:x/fields": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/definitions": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/definitions/:x": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/definitions/:x/coverage": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/definitions/validate": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/employees": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/fields/:x": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/validate-formula": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/preview": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/compute": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/manual-value": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/upload/preview": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/upload/commit": "No backend module exists for KPI Studio. See the block comment above this list.",
  "/api/kpi-studio/explain/:x/:x": "No backend module exists for KPI Studio. See the block comment above this list.",
};

/**
 * Strings that look like endpoints but are never requested. Kept separate from KNOWN_MISSING
 * on purpose: calling these "missing endpoints" would be wrong, and a guard that muddles
 * "nobody serves this" with "nobody calls this" teaches people to stop reading its output.
 */
const NOT_A_REQUEST: Record<string, string> = {
  "/api/files/company-feed":
    "a prefix in AuthedImage.tsx's PUBLIC_CATEGORIES, used by isPublicUrl(src) to decide whether to attach an auth header to a URL it was given. It is a predicate, never a fetch target, so the backend is not expected to mount it.",
};

describe("every /api path the frontend calls is served by a mounted route", () => {
  it("has no unknown missing endpoints", () => {
    const dynamic = [...dynamicPrefixes].filter(Boolean).sort((a, b) => b.length - a.length);
    const offenders: string[] = [];

    for (const [path, where] of frontendCalls()) {
      if (isServed(path)) continue;
      if (dynamic.some((d) => path === d || path.startsWith(`${d}/`))) continue; // trap 4
      if (path in KNOWN_MISSING || path in NOT_A_REQUEST) continue;
      offenders.push(`${path}\n      called from ${where.slice(0, 3).join(", ")}`);
    }

    expect(
      offenders,
      offenders.length
        ? `The frontend calls ${offenders.length} endpoint(s) the backend does not serve:\n\n` +
          offenders.map((o) => `  ${o}`).join("\n\n") +
          `\n\nA missing /api route answers 401, not 404, so this looks like a permissions bug` +
          `\nwhen it is actually an absent feature.\n\n` +
          `Before "fixing" the URL: confirm the replacement handler returns the SHAPE the` +
          `\ncaller reads. Three of the seven known cases would still have been wrong after a` +
          `\nURL change because the columns they use do not exist in the schema. Pointing a` +
          `\nfeed at a wrong-shaped endpoint turns an honest "unavailable" into confidently` +
          `\nwrong numbers, which CLAUDE.md rules 9 and 10 both forbid.\n\n` +
          `If the endpoint is genuinely absent, add it to KNOWN_MISSING with the reason.`
        : ""
    ).toEqual([]);
  });

  it("parsed a plausible number of routes, so a broken parser cannot pass silently", () => {
    // Without this, any regex mistake that made `served` huge or `calls` empty would make the
    // test above pass while checking nothing. Trap 1 alone once cost 23 real routes.
    expect(served.size).toBeGreaterThan(2000);
    expect(frontendCalls().size).toBeGreaterThan(1000);
  });

  it("every KNOWN_MISSING entry is still missing, so fixed ones get removed", () => {
    const nowServed = Object.keys(KNOWN_MISSING).filter((p) => isServed(p));
    expect(
      nowServed,
      `These are now served and must be deleted from KNOWN_MISSING: ${nowServed.join(", ")}`
    ).toEqual([]);
  });
});
