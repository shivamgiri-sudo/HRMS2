/**
 * The deterministic pass. Runs BEFORE any LLM call and can terminate the pipeline on its own.
 *
 * A payroll or auth request is stopped, explained to the submitter and routed to a human
 * with zero model tokens spent. The LLM (Phase 2) is a second opinion, never the first or
 * only judge — an LLM's judgement is not sufficient protection for a codebase where three
 * rival engines compute salary and 2,242 hand-written SQL sites write to the database.
 *
 * THREE ANCHORS, none of which is NLP guesswork:
 *   1. Captured context. page_route and page_code come from the SPA's actual location and
 *      are authoritative. module_hint is the user's own dropdown selection and is advisory
 *      ONLY — a user mislabelling a payroll bug as "cosmetic UI" changes nothing.
 *   2. The impact index: page component -> its imports -> the /api literals it calls ->
 *      the backend routers serving them, plus reverse-dependency fan-in.
 *   3. A curated keyword safety net, deliberately over-broad. Its job is to CATCH
 *      protected-domain requests, not to route ordinary ones. A false positive costs one
 *      human review; a false negative costs a wrong salary.
 */
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  capabilityClassFor,
  explainCapabilityDeny,
  extractIdentifierTokens,
  loadCapabilityRegistry,
  matchCapabilities,
  requiredApproverRoles,
} from "./capability-registry.js";
import { normalisePath } from "./control-plane.js";
import {
  backendFilesForApiPaths,
  buildImpactIndex,
  componentForRoute,
  directDependencies,
  fanIn,
  type ImpactIndex,
} from "./uat-impact-index.js";
import { explainDeny, hitsForPaths, loadProtectedPaths, pathTierFor } from "./protected-paths.js";
import {
  CAPABILITY_CLASS_RANK,
  PATH_TIER_RANK,
  rankToPathTier,
  type ImpactedPath,
  type ScanInput,
  type StaticScanResult,
} from "./uat-pipeline.types.js";

export const SCANNER_VERSION = "1.0.0";

/**
 * Keyword -> directory hints. This is the safety net, NOT the router. It exists so that a
 * request whose page and module give no useful signal ("my payslip shows the wrong PF") is
 * still pulled toward the code that owns the subject. Overlaps with the capability registry
 * on purpose: the registry decides the risk CLASS, these decide which files to look at.
 */
const SUBJECT_HINTS: Array<[RegExp, string[]]> = [
  [/payslip|salary|\bCTC\b|\bPF\b|\bUAN\b|\bESIC?\b|\bTDS\b|gratuity|F&F|arrear|deduction/i,
    ["backend/src/modules/payroll/", "backend/src/modules/payroll-compliance/", "backend/src/modules/payroll-masters/"]],
  [/punch|biometric|cosec|attendance|half.?day|\blate\b|missing punch/i,
    ["backend/src/modules/wfm/", "backend/src/modules/attendance/"]],
  [/leave|accrual|entitlement|comp.?off|encash|carry.?forward/i,
    ["backend/src/modules/leave/"]],
  [/roster|shift|week.?off|\bOT\b|overtime|regulari[sz]ation|shrinkage/i,
    ["backend/src/modules/roster/", "backend/src/modules/wfm/"]],
  [/login|password|\bOTP\b|role|permission|access denied|unauthori[sz]ed/i,
    ["backend/src/modules/auth/", "backend/src/modules/access/", "backend/src/middleware/"]],
  [/candidate|interview|offer letter|recruit|requisition|shortlist/i,
    ["backend/src/modules/ats/"]],
  [/resignation|exit|clearance|relieving|notice period|full and final/i,
    ["backend/src/modules/exit/"]],
  [/invoice|vendor|\bGRN\b|budget|\bP&L\b|cost cent|disburs|payment/i,
    ["backend/src/modules/finance/", "backend/src/modules/process-pnl/"]],
  [/report|dashboard|export|does not tally|mismatch/i,
    ["backend/src/modules/reporting/", "backend/src/modules/dashboards/"]],
  [/\bLMS\b|course|curriculum|certification|trainee|\bMCQ\b/i,
    ["backend/src/modules/lms/", "backend/src/modules/lms-integration/"]],
];

function filesUnderPrefixes(prefixes: string[], index: ImpactIndex, cap = 40): string[] {
  const out: string[] = [];
  for (const f of index.forward.keys()) {
    if (prefixes.some((p) => f.startsWith(p))) {
      out.push(f);
      if (out.length >= cap) break;
    }
  }
  return out;
}

interface Candidate {
  path: string;
  confidence: "high" | "medium" | "low";
  why: string;
}

/**
 * Union of the three anchors. Confidence records WHERE a candidate came from, so the
 * console can show a reviewer that a payroll file was reached by a keyword rather than by
 * the page they were on — which is the difference between "probably relevant" and "the
 * safety net fired".
 */
function resolveCandidates(input: ScanInput, index: ImpactIndex): Candidate[] {
  const byPath = new Map<string, Candidate>();
  const add = (path: string, confidence: Candidate["confidence"], why: string) => {
    const p = normalisePath(path);
    const existing = byPath.get(p);
    // Keep the highest-confidence explanation for a path reached more than one way.
    const rank = { high: 3, medium: 2, low: 1 };
    if (!existing || rank[confidence] > rank[existing.confidence]) {
      byPath.set(p, { path: p, confidence, why });
    }
  };

  // Anchor 1+2: the page the user was actually on.
  const route = input.pageRoute?.trim();
  if (route) {
    const component = componentForRoute(route, index);
    if (component) {
      add(component, "high", `page component for route ${route}`);
      for (const dep of directDependencies(component, index)) {
        if (dep.startsWith("src/")) add(dep, "medium", `imported by the ${route} page`);
      }
      const apis = [...(index.apiLiterals.get(component) ?? [])];
      for (const f of backendFilesForApiPaths(apis, index)) {
        add(f, "high", `serves an /api path the ${route} page calls`);
      }
    }
  }

  // An explicit failing endpoint beats everything else for precision.
  if (input.apiPathHint) {
    for (const f of backendFilesForApiPaths([input.apiPathHint], index)) {
      add(f, "high", `serves ${input.apiPathHint}`);
    }
  }

  // Advisory only.
  if (input.moduleHint) {
    const safe = input.moduleHint.replace(/[^A-Za-z0-9_-]/g, "");
    if (safe.length >= 2) {
      for (const f of filesUnderPrefixes([`backend/src/modules/${safe}/`], index, 25)) {
        add(f, "low", `user-selected module hint "${safe}" (advisory)`);
      }
    }
  }

  // Anchor 3: the safety net.
  const text = `${input.title}\n${input.text}`;
  for (const [re, prefixes] of SUBJECT_HINTS) {
    const m = re.exec(text);
    if (!m) continue;
    for (const f of filesUnderPrefixes(prefixes, index, 25)) {
      add(f, "low", `subject keyword "${m[0]}" points at ${prefixes[0]}`);
    }
  }

  return [...byPath.values()];
}

export function runStaticScan(input: ScanInput): StaticScanResult {
  const started = Date.now();
  const index = buildImpactIndex();
  const protectedPaths = loadProtectedPaths();
  const registry = loadCapabilityRegistry();

  const candidates = resolveCandidates(input, index);

  /**
   * THE PATH DIMENSION USES EVIDENCE, NOT SUSPICION.
   *
   * Only high/medium-confidence candidates — the page the user was actually on, the files it
   * imports, and the routers serving the /api paths it calls — may produce a protected-path
   * hit or a capability PATH match. Low-confidence candidates come from the keyword sweep,
   * which returns whole module directories.
   *
   * Without this split the sweep fabricates evidence. Every module containing a *.cron.ts
   * file is deny-tier via `backend/src/**\/*.cron.ts`, so "spelling mistake on the dashboard
   * heading" was denied because backend/src/modules/dashboards/dashboard-snapshot.cron.ts
   * exists — a file nobody had any reason to think was involved. A system that blocks
   * typo fixes as if they were payroll changes teaches its users that it always says no.
   *
   * The subject-matter risk those sweeps exist to catch is not lost: it is carried by the
   * capability registry's keyword and table signals, which are independent of any file path.
   * "My payslip shows the wrong PF" is still DENY — via the payroll keyword, which is the
   * correct dimension for it, rather than via a cron file in a directory the sweep guessed.
   */
  const evidenceBackedPaths = candidates
    .filter((c) => c.confidence !== "low")
    .map((c) => c.path);
  const allPaths = candidates.map((c) => c.path);

  // Every candidate is still shown to the reviewer; only their weight differs.
  const impactedPaths: ImpactedPath[] = candidates.map((c) => ({
    path: c.path,
    confidence: c.confidence,
    why: c.why,
    fanIn: fanIn(c.path, index),
  }));
  impactedPaths.sort((a, b) => b.fanIn - a.fanIn);

  const protectedHits = hitsForPaths(evidenceBackedPaths, protectedPaths.rules);
  const riskTier = pathTierFor(protectedHits);

  const text = `${input.title}\n${input.text}`;
  const capabilityHits = matchCapabilities(
    { paths: evidenceBackedPaths, text, tokens: extractIdentifierTokens(text) },
    registry
  );
  const capabilityClass = capabilityClassFor(capabilityHits);

  // The whole point of the two-dimensional model: the worse of the two decides.
  const effectiveRank = Math.max(PATH_TIER_RANK[riskTier], CAPABILITY_CLASS_RANK[capabilityClass]);
  const effectiveRisk = rankToPathTier(effectiveRank);

  // Reporting surfaces use every candidate, including low-confidence ones: a reviewer
  // benefits from seeing what the sweep suspected even though it did not gate anything.
  const impactedModules = [
    ...new Set(
      allPaths
        .map((p) => /^backend\/src\/modules\/([^/]+)\//.exec(p)?.[1])
        .filter((m): m is string => Boolean(m))
    ),
  ].sort();

  const impactedRoutes = [
    ...new Set(allPaths.flatMap((p) => [...(index.apiLiterals.get(p) ?? [])])),
  ].sort();

  return {
    scannerVersion: SCANNER_VERSION,
    pathsSha: protectedPaths.sha256,
    registrySha: registry.sha256,
    impactedPaths,
    impactedRoutes,
    impactedModules,
    protectedHits,
    capabilityHits,
    reverseDepMax: impactedPaths.reduce((m, p) => Math.max(m, p.fanIn), 0),
    resolverMode: "fast",
    riskTier,
    capabilityClass,
    effectiveRisk,
    requiredApproverRoles: requiredApproverRoles(capabilityHits),
    durationMs: Date.now() - started,
    // Path reason first: it names a concrete file, which is more actionable than a category.
    blockedReason:
      effectiveRisk === "deny"
        ? explainDeny(protectedHits) ?? explainCapabilityDeny(capabilityHits)
        : null,
  };
}

export async function persistScan(
  feedbackId: string,
  scan: StaticScanResult,
  conn?: PoolConnection
): Promise<void> {
  const exec = conn ?? db;
  await exec.execute(
    `INSERT INTO uat_static_scan
       (feedback_id, scanner_version, paths_sha, registry_sha,
        impacted_paths_json, impacted_routes_json, impacted_modules_json,
        protected_hits_json, capability_hits_json,
        reverse_dep_max, resolver_mode, risk_tier, capability_class, effective_risk, duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      feedbackId,
      scan.scannerVersion,
      scan.pathsSha,
      scan.registrySha,
      JSON.stringify(scan.impactedPaths),
      JSON.stringify(scan.impactedRoutes),
      JSON.stringify(scan.impactedModules),
      JSON.stringify(scan.protectedHits),
      JSON.stringify(scan.capabilityHits),
      scan.reverseDepMax,
      scan.resolverMode,
      scan.riskTier,
      scan.capabilityClass,
      scan.effectiveRisk,
      scan.durationMs,
    ]
  );
  await exec.execute(
    "UPDATE uat_feedback SET risk_tier = ?, capability_class = ? WHERE id = ?",
    [scan.effectiveRisk, scan.capabilityClass, feedbackId]
  );
}
