// Pure view model of the criteria summary and the completeness badge (S15).
import { GROUP_ORDER, GROUP_TITLE, RULE_INFO, labelOf, type RuleGroup } from "./ruleInfo";
import type { CompiledRuleView, Completeness, MissingPolicy, VersionInfo } from "./selectionTypes";

export interface Badge { word: string; icon: "check" | "half" | "alert"; text: string; aria: string; tone: "good" | "warn" | "bad" }
export function badgeOf(c: Completeness): Badge {
  const word = c.label === "complete" ? "Complete" : c.label === "partial" ? "Partial" : "Incomplete";
  return { word, icon: c.label === "complete" ? "check" : c.label === "partial" ? "half" : "alert", text: `${word} · ${c.score}`, aria: `Criteria completeness: ${word}, ${c.score} of 100`,
    tone: c.label === "complete" ? "good" : c.label === "partial" ? "warn" : "bad" };
}

export function unknownText(m: MissingPolicy): string {
  return m === "review" ? "If unknown: ask HR" : m === "fail" ? "If unknown: treat as not meeting it" : "If unknown: treat as meeting it";
}
const scopeOf = (only?: string[]): string | null => (!only ? null : only.includes("he") ? "drive line-up only" : "Meta forms only");

export interface SummaryLine { key: string; text: string; mode: string; unknown: string | null; scope: string | null; defaulted: boolean }
export function summaryGroups(rules: CompiledRuleView[]): Array<{ group: RuleGroup; title: string; lines: SummaryLine[] }> {
  const by = new Map<RuleGroup, SummaryLine[]>();
  for (const r of rules) {
    const g = RULE_INFO[r.key]?.group ?? "who";
    const line: SummaryLine = { key: r.key, text: `${r.label}: ${r.requiredText}`, mode: r.mode === "must" ? "MUST" : `PREFER +${r.weight}`,
      unknown: r.mode === "must" ? unknownText(r.missing) : null, scope: scopeOf(r.only), defaulted: !!r.defaulted };
    by.set(g, [...(by.get(g) ?? []), line]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ group: g, title: GROUP_TITLE[g], lines: by.get(g)! }));
}

export const missingLinks = (c: Completeness) => c.missing.map((key) => ({ key, label: labelOf(key) }));
export const enrolmentNote = (c: Completeness): string | null => (c.enrolmentReady ? null : "Enrolment blocked: criteria incomplete");

/** DB text is IST wall clock ("YYYY-MM-DD HH:MM:SS"); ISO strings carry their own zone. */
export function parseWhen(at: string): number {
  if (typeof at !== "string" || !at) return Number.NaN;
  if (at.includes("T")) return Date.parse(at);
  return Date.parse(`${at.replace(" ", "T")}+05:30`);
}
export function relativeAgo(at: string, now: Date): string {
  const t = parseWhen(at);
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((now.getTime() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / (24 * 60))} days ago`;
}
const SOURCE_WORD: Record<string, string> = { criteria_panel: "in the criteria editor", form: "in the requisition form", bulk: "by a bulk edit", copy: "by a copy", template: "from a template", backfill: "when versions started" };
export function versionLine(v: VersionInfo | null, now: Date): string {
  if (!v) return "Not versioned yet";
  const ago = relativeAgo(v.at, now);
  return `Version ${v.versionNo}${ago ? `, changed ${ago}` : ""} ${SOURCE_WORD[v.source] ?? ""}`.trim();
}
