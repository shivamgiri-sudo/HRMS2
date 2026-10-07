import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  excludeEmployeeShapedCandidatesSql,
  excludeOtherEntityCandidatesSql,
} from "./ats-reporting-scope.js";
import {
  SOURCE_LABEL,
  branchNameVariants,
  canonicalSourceSql,
  canonicalBranch,
  canonicalRole,
  canonicalSource,
  normalizeRecruiterName,
  preferredRecruiterName,
  recruiterKey,
} from "./ats-vocabulary.js";

/**
 * Single place where the ATS dashboards decide "which ats_candidate rows count" and "what is this value called".
 * Everything here delegates to the repo's canonical helpers so these pages agree with the Command Center,
 * the Hiring Dashboard and the daily branch report.
 */

/** Genuine MAS candidates only: no legacy employee rows, no IDC (other entity), no test rows. `alias` is the table alias or name. */
export const reportingScope = (alias: string) =>
  `${excludeEmployeeShapedCandidatesSql(alias)} AND ${excludeOtherEntityCandidatesSql(alias)}`;

/** Display label for a stored sourcing_channel (merges WALKIN / Walk-In / walk in). */
export function sourceDisplay(raw: unknown): string {
  const code = canonicalSource(raw);
  return SOURCE_LABEL[code] ?? (String(raw ?? "").trim() || "Unspecified");
}

/** Inverse of sourceDisplay for filters: a display label back to the canonical code used by canonicalSourceSql(). */
export function sourceCode(label: string): string {
  if (label === "Unspecified") return "UNSPECIFIED";
  const hit = Object.entries(SOURCE_LABEL).find(([, l]) => l === label);
  return hit ? hit[0] : label.toUpperCase();
}

export const branchDisplay = (raw: unknown): string => canonicalBranch(raw);
export const processDisplay = (raw: unknown): string => {
  const t = String(raw ?? "").trim();
  if (!t) return "Unspecified";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t) ? "Unmapped" : canonicalRole(t);
};

/** Groups recruiter spellings (case, "· MAS12345" suffix, aliases) and picks one display name per person. */
export function recruiterNamer(
  rawNames: readonly string[],
): (raw: unknown) => string {
  const groups = new Map<string, string[]>();
  for (const n of rawNames) {
    const k = recruiterKey(null, n);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(
      normalizeRecruiterName(n),
    );
  }
  const display = new Map(
    [...groups.entries()].map(([k, names]) => [
      k,
      k === "unassigned" ? "Unassigned" : preferredRecruiterName(names),
    ]),
  );
  return (raw) =>
    display.get(recruiterKey(null, raw)) ??
    (normalizeRecruiterName(raw) || "Unassigned");
}

/* Distinct raw spellings, one scan, cached: lets a display label (bucket) be mapped back to a SQL IN list. */
let rawCache: {
  at: number;
  experience: string[];
  education: string[];
  recruiter: string[];
  process: string[];
} | null = null;
export async function rawValues() {
  if (rawCache && Date.now() - rawCache.at < 3_600_000) return rawCache;
  const [raw] = await db.execute<RowDataPacket[]>(
    `SELECT experience ex, education ed, recruiter_name rc, applied_for_process pr FROM ats_candidate WHERE ${reportingScope("ats_candidate")} GROUP BY ex, ed, rc, pr`,
  );
  const rows = raw as unknown as {
    ex: string | null;
    ed: string | null;
    rc: string | null;
    pr: string | null;
  }[];
  const uniq = (k: "ex" | "ed" | "rc" | "pr") => [
    ...new Set(rows.map((r) => r[k]).filter((v): v is string => !!v)),
  ];
  rawCache = {
    at: Date.now(),
    experience: uniq("ex"),
    education: uniq("ed"),
    recruiter: uniq("rc"),
    process: uniq("pr"),
  };
  return rawCache;
}

/** Branch filter for a canonical branch name: matches every stored spelling in both branch columns. */
export function branchFilter(
  canonicalName: string,
  alias = "",
): { sql: string; params: string[] } {
  const p = alias ? `${alias}.` : "";
  const names = branchNameVariants(canonicalName);
  const list = names.map(() => "?").join(",");
  return {
    sql: `(${p}branch_display_name IN (${list}) OR ${p}applied_for_branch IN (${list}))`,
    params: [...names, ...names],
  };
}

export { canonicalSourceSql };

/** Display label for a recruiter call-log source (hiring_source): canonical label when known, else tidy title case. */
export function leadSourceDisplay(raw: unknown): string {
  const code = canonicalSource(raw);
  if (SOURCE_LABEL[code]) return SOURCE_LABEL[code];
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase()) || "Unspecified";
}
