/** Pure view-model for the pipeline health strip: what to render for an API payload and which chip is open. */
export type HealthLevel = "ok" | "warn" | "critical";
export interface HealthCheck { key: string; label: string; level: HealthLevel; detail: string }
export interface HealthPayload { generatedAt: string; level: HealthLevel; checks: HealthCheck[] }
export type IconKey = "check" | "alert" | "x";
export type LevelWord = "OK" | "Warning" | "Critical";
export type OverallLabel = "All healthy" | "Needs attention" | "Critical";

export interface ChipView { key: string; label: string; level: HealthLevel; levelWord: LevelWord; icon: IconKey; detail: string; expanded: boolean }
export interface StripView {
  overallLabel: OverallLabel | null;
  overallLevel: HealthLevel | null;
  overallIcon: IconKey | null;
  chips: ChipView[];
  expandedDetail: string | null;
  generatedAt: string | null;
}

const WORD: Record<HealthLevel, LevelWord> = { ok: "OK", warn: "Warning", critical: "Critical" };
const ICON: Record<HealthLevel, IconKey> = { ok: "check", warn: "alert", critical: "x" };
const OVERALL: Record<HealthLevel, OverallLabel> = { ok: "All healthy", warn: "Needs attention", critical: "Critical" };

export function buildStripView(payload: HealthPayload | null, expandedKey: string | null): StripView {
  if (!payload) return { overallLabel: null, overallLevel: null, overallIcon: null, chips: [], expandedDetail: null, generatedAt: null };
  const chips = payload.checks.map((c): ChipView => ({
    key: c.key, label: c.label, level: c.level, levelWord: WORD[c.level], icon: ICON[c.level], detail: c.detail, expanded: c.key === expandedKey,
  }));
  return {
    overallLabel: OVERALL[payload.level], overallLevel: payload.level, overallIcon: ICON[payload.level], chips,
    expandedDetail: chips.find((c) => c.expanded)?.detail ?? null, generatedAt: payload.generatedAt,
  };
}

/** Open one chip; pressing the open chip again closes it. */
export function toggleExpanded(current: string | null, key: string): string | null {
  return current === key ? null : key;
}
