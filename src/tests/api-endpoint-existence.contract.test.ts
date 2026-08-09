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
 *   A sweep on 2026-08-08 found seven such calls. Five have since been built; the rest are in
 *   KNOWN_MISSING below with the reason. None was a typo — each was a UI built against a
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
  "/api/quality-dashboard/scores":
    "router serves /summary, /trend, /agents, /clients, /apr. No endpoint returns per-row quality_score AND fatal_count together; quality-executive.service.ts computes quality_score but is wired to no route at all.",
  "/api/performance-dashboard/ops":
    "router serves /goals, /ratings, /agent-matrix, /utilization. Unfixable by URL: handled_volume, target_volume and shrinkage_minutes appear NOWHERE in the backend, so no endpoint can supply this shape.",

  // The two sales-upload entries that used to sit here are gone: POST /upload/:type and
  // DELETE /batch/:batchId are now wired to the handlers that had always existed.
  //
  // Worth recording why they were held back, because the reasoning was half wrong. They were
  // left unwired on the grounds that db_masmis returns ER_TABLEACCESS_DENIED_ERROR to the
  // application user, so adding routes would only turn a 401 into a 500 — "needs a GRANT,
  // not a route". The access error was real, but the cause was not a missing grant: masmisDb.ts
  // built its pool from DB_HOST/DB_USER, and db_masmis is on a different server, so the code
  // could only ever look for it in the one place it is not. MASMIS_DB_HOST/PORT/USER/PASSWORD
  // now exist (falling back to DB_* when unset), which is what makes these routes reachable.
  //
  // The lesson worth keeping: "permission denied" answered the question "may I read this
  // table" when the question that mattered was "am I connected to the right server at all".

  // Not a fetch, but still a promise the product makes and does not keep.
  "/api/webhooks/:x":
    "SimpleConnectorWizard DISPLAYS this to the user as 'your webhook URL will be /api/webhooks/{key}'. No /api/webhooks is mounted anywhere, so any external system configured against it posts into nothing. Listed here rather than ignored because the URL is published to third parties.",
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
