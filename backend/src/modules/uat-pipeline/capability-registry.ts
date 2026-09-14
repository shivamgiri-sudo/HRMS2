/**
 * Typed wrapper over uat/capability-registry.json — dimension two of the risk model.
 *
 * WHY THIS DIMENSION EXISTS
 *   A path-only model misses the most common real failure in this codebase: an apparently
 *   harmless file edit that nevertheless changes an HR policy outcome. Leave accrual,
 *   attendance classification, roster and week-off rules, OT, F&F inputs, ATS stage logic
 *   and report calculations are all business-critical and are NOT all under modules/payroll.
 *   "Leave balance shows wrong carry-forward" trips no protected path at all, and must
 *   still land on an HR policy owner's desk.
 *
 * DETECTION IS A UNION, NOT A PRIORITY LIST
 *   A capability fires if ANY of its three signals matches — a file path, a table or column
 *   name appearing in the request, or a keyword. Deliberately over-broad: a false positive
 *   costs one human review, a false negative costs a wrong salary.
 */
import { matchGlob, matchTablePattern, normalisePath, readControlPlaneFile } from "./control-plane.js";
import type {
  CapabilityClass,
  CapabilityDefinition,
  CapabilityHit,
  CapabilityRegistryFile,
} from "./uat-pipeline.types.js";

export const CAPABILITY_REGISTRY_FILE = "capability-registry.json";

export interface LoadedCapabilityRegistry {
  capabilities: CapabilityDefinition[];
  sha256: string;
}

export function loadCapabilityRegistry(): LoadedCapabilityRegistry {
  const { data, sha256 } = readControlPlaneFile<CapabilityRegistryFile>(CAPABILITY_REGISTRY_FILE);
  if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) {
    throw new Error("[uat] capability-registry.json contains no capabilities; refusing to classify risk.");
  }
  if (!data.capabilities.some((c) => c.class === "DENY")) {
    throw new Error("[uat] capability-registry.json has no DENY capability; refusing to classify risk.");
  }
  return { capabilities: data.capabilities, sha256 };
}

const CLASS_RANK: Record<CapabilityClass, number> = {
  TRIVIAL: 0,
  STANDARD: 1,
  REVIEW: 2,
  HIGH_REVIEW: 3,
  DENY: 4,
};

/**
 * Compiled keyword matchers, cached per registry sha so an edited registry recompiles but a
 * stable one does not pay the RegExp construction cost on every scan.
 */
const keywordCache = new Map<string, Map<string, RegExp[]>>();

function keywordMatchers(reg: LoadedCapabilityRegistry): Map<string, RegExp[]> {
  const cached = keywordCache.get(reg.sha256);
  if (cached) return cached;
  const map = new Map<string, RegExp[]>();
  for (const cap of reg.capabilities) {
    const res: RegExp[] = [];
    for (const k of cap.keywords ?? []) {
      try {
        res.push(new RegExp(k, "i"));
      } catch {
        // A malformed pattern must not take the scanner down, but it must be visible:
        // the contract test compiles every keyword, so this can only fire if the file was
        // edited past that gate.
        console.error(`[uat] capability "${cap.key}" has an invalid keyword regex: ${k}`);
      }
    }
    map.set(cap.key, res);
  }
  keywordCache.set(reg.sha256, map);
  return map;
}

export interface CapabilityMatchInput {
  /** Candidate file paths from the impact scan. */
  paths: string[];
  /** Free text: title + redacted body. Never the raw body. */
  text: string;
  /** Table/identifier tokens extracted from the text. */
  tokens: string[];
}

/**
 * All capabilities the input trips, one hit per (capability, signal) so the console can show
 * which signal fired and on what. A capability matching by all three signals produces three
 * hits; the class is the same, but "why" differs and a reviewer needs the why.
 */
export function matchCapabilities(
  input: CapabilityMatchInput,
  reg: LoadedCapabilityRegistry
): CapabilityHit[] {
  const hits: CapabilityHit[] = [];
  const matchers = keywordMatchers(reg);
  const paths = input.paths.map(normalisePath);

  for (const cap of reg.capabilities) {
    const base = {
      capabilityKey: cap.key,
      capabilityName: cap.name,
      class: cap.class,
      requiredApproverRoles: cap.requiredApproverRoles ?? [],
      mandatoryTests: cap.mandatoryTests ?? [],
      reason: cap.reason,
    };

    for (const pattern of cap.paths ?? []) {
      const hit = paths.find((p) => matchGlob(pattern, p));
      if (hit) {
        hits.push({ ...base, signal: "path", matchedToken: hit });
        break; // one path hit per capability is enough to establish the signal
      }
    }

    for (const pattern of cap.tables ?? []) {
      const hit = input.tokens.find((t) => matchTablePattern(pattern, t));
      if (hit) {
        hits.push({ ...base, signal: "table", matchedToken: hit });
        break;
      }
    }

    const res = matchers.get(cap.key) ?? [];
    for (const re of res) {
      const m = re.exec(input.text);
      if (m) {
        hits.push({ ...base, signal: "keyword", matchedToken: m[0] });
        break;
      }
    }
  }

  return hits;
}

/**
 * Worst class among the hits. STANDARD when nothing matched — an unmatched request is not
 * automatically TRIVIAL, because "no capability recognised it" and "it is harmless" are
 * different statements and only the second justifies the lowest scrutiny.
 */
export function capabilityClassFor(hits: CapabilityHit[]): CapabilityClass {
  let worst: CapabilityClass = "STANDARD";
  for (const h of hits) {
    if (CLASS_RANK[h.class] > CLASS_RANK[worst]) worst = h.class;
  }
  return worst;
}

/** Union of approver roles demanded by every REVIEW-or-worse capability that matched. */
export function requiredApproverRoles(hits: CapabilityHit[]): string[] {
  const out = new Set<string>();
  for (const h of hits) {
    if (CLASS_RANK[h.class] >= CLASS_RANK.REVIEW) {
      for (const r of h.requiredApproverRoles) out.add(r);
    }
  }
  return [...out].sort();
}

/** Union of test suites every matched capability requires the change to keep green. */
export function mandatoryTests(hits: CapabilityHit[]): string[] {
  const out = new Set<string>();
  for (const h of hits) for (const t of h.mandatoryTests) out.add(t);
  return [...out].sort();
}

export function explainCapabilityDeny(hits: CapabilityHit[]): string | null {
  const deny = hits.filter((h) => h.class === "DENY");
  if (deny.length === 0) return null;
  const h = deny[0];
  return (
    `This request involves ${h.capabilityName} (matched on ${h.signal} "${h.matchedToken}"), ` +
    `which is human-engineering only: ${h.reason}`
  );
}

/**
 * Tokens that could plausibly be table or column names, pulled from free text. Used as the
 * "table" detection signal. Intentionally generous — snake_case words and quoted
 * identifiers — because the cost of an extra candidate is one wasted comparison.
 */
export function extractIdentifierTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z0-9_]+)`|\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/gi)) {
    const t = m[1] ?? m[2];
    if (t && t.length >= 3) out.add(t.toLowerCase());
  }
  return [...out];
}
