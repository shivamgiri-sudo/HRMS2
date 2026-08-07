/**
 * Typed wrapper over uat/protected-paths.json — dimension one of the risk model.
 *
 * This file deliberately holds NO rule data. Every pattern lives in the JSON so that the
 * backend and the CI diff gate read the same bytes; a TypeScript copy would be a second
 * source of truth that drifts silently, and the thing it would drift about is which files
 * the AI is allowed to edit. protected-paths.contract.test.ts asserts that this wrapper
 * and the JSON agree, and that every non-glob path still exists on disk so a rename cannot
 * quietly void a rule.
 */
import { matchGlob, normalisePath, readControlPlaneFile } from "./control-plane.js";
import type {
  PathTier,
  ProtectedHit,
  ProtectedPathRule,
  ProtectedPathsFile,
} from "./uat-pipeline.types.js";

export const PROTECTED_PATHS_FILE = "protected-paths.json";

export interface LoadedProtectedPaths {
  rules: ProtectedPathRule[];
  sha256: string;
}

export function loadProtectedPaths(): LoadedProtectedPaths {
  const { data, sha256 } = readControlPlaneFile<ProtectedPathsFile>(PROTECTED_PATHS_FILE);
  if (!Array.isArray(data.rules) || data.rules.length === 0) {
    // An empty rule set would classify a payroll edit as safe. Refuse rather than degrade.
    throw new Error("[uat] protected-paths.json contains no rules; refusing to classify risk.");
  }
  if (!data.rules.some((r) => r.tier === "deny")) {
    throw new Error("[uat] protected-paths.json has no deny-tier rules; refusing to classify risk.");
  }
  return { rules: data.rules, sha256 };
}

/**
 * Every rule a given file trips. Returns all matches rather than the first, because the
 * triage console shows the reviewer *why* something was blocked and one file commonly
 * matches both a business-critical rule and a control-plane one.
 */
export function hitsForPath(path: string, rules: ProtectedPathRule[]): ProtectedHit[] {
  const p = normalisePath(path);
  const out: ProtectedHit[] = [];
  for (const rule of rules) {
    if (matchGlob(rule.pattern, p)) {
      out.push({
        path: p,
        pattern: rule.pattern,
        tier: rule.tier,
        category: rule.category,
        reason: rule.reason,
      });
    }
  }
  return out;
}

export function hitsForPaths(paths: string[], rules: ProtectedPathRule[]): ProtectedHit[] {
  const out: ProtectedHit[] = [];
  for (const p of paths) out.push(...hitsForPath(p, rules));
  return out;
}

/**
 * Path-floor verdict for a set of candidate files.
 *
 * "standard" for an empty candidate set is intentional and safe: a request whose impact
 * could not be resolved to any file still has to clear the capability dimension, and an
 * unresolvable request is not automatically trivial.
 */
export function pathTierFor(hits: ProtectedHit[]): PathTier {
  if (hits.some((h) => h.tier === "deny")) return "deny";
  if (hits.some((h) => h.tier === "review")) return "review";
  return "standard";
}

/** The single sentence shown to a submitter whose request was blocked by a path rule. */
export function explainDeny(hits: ProtectedHit[]): string | null {
  const deny = hits.filter((h) => h.tier === "deny");
  if (deny.length === 0) return null;
  const first = deny[0];
  const more = deny.length > 1 ? ` (and ${deny.length - 1} other protected path${deny.length > 2 ? "s" : ""})` : "";
  return `This request would touch ${first.path}${more}, which is protected: ${first.reason}`;
}
