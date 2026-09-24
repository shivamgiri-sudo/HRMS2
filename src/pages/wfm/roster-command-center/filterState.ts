/**
 * Pure helpers for the Roster Command Center shared filters (no React) so the shell
 * behaviour — presets, reset, LOB reset on process change, "never send all" — is unit-testable.
 */
import type { RosterConsoleFilters } from "./RosterConsoleFilterContext";

export type FilterKey = "branch" | "process" | "lob" | "dates";

/** Which shared filters each tab honours — drives the "This tab uses" line. */
export const TAB_FILTER_SUPPORT: Record<string, FilterKey[]> = {
  live: ["branch", "process", "lob"],
  "team-roster": ["branch", "process", "lob"],
  analytics: ["branch", "process", "lob"],
  trends: ["branch", "process", "lob", "dates"],
  compliance: ["branch", "process", "lob"],
  shifts: ["branch", "process", "lob"],
  interventions: ["branch", "process", "lob"],
  audit: ["branch", "process", "lob", "dates"],
};

const KEY_LABEL: Record<FilterKey, string> = { branch: "Branch", process: "Process", lob: "LOB", dates: "Dates" };

export function describeTabFilters(tabKey: string): string {
  const keys = TAB_FILTER_SUPPORT[tabKey] ?? [];
  return keys.length ? `This tab uses: ${keys.map((k) => KEY_LABEL[k]).join(" · ")}` : "This tab has its own controls";
}

export function isoDate(offsetDays = 0, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type PresetKey = "today" | "yesterday" | "last7" | "last14" | "month";

export const DATE_PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last14", label: "Last 14 days" },
  { key: "month", label: "This month" },
];

export function presetRange(key: PresetKey, now: Date = new Date()): { from: string; to: string } {
  switch (key) {
    case "today": return { from: isoDate(0, now), to: isoDate(0, now) };
    case "yesterday": return { from: isoDate(-1, now), to: isoDate(-1, now) };
    case "last7": return { from: isoDate(-6, now), to: isoDate(0, now) };
    case "last14": return { from: isoDate(-13, now), to: isoDate(0, now) };
    case "month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: isoDate(0, first), to: isoDate(0, now) };
    }
  }
}

export const DEFAULT_PRESET: PresetKey = "last14";

export function defaultFilters(now: Date = new Date()): RosterConsoleFilters {
  const r = presetRange(DEFAULT_PRESET, now);
  return { branchId: "", processId: "", lobId: "", ...r };
}

/** Which preset (if any) the current range equals, for highlighting the active button. */
export function activePreset(from: string, to: string, now: Date = new Date()): PresetKey | null {
  const hit = DATE_PRESETS.find((p) => {
    const r = presetRange(p.key, now);
    return r.from === from && r.to === to;
  });
  return hit ? hit.key : null;
}

/** Changing the process invalidates the LOB (LOBs are process-scoped) — reset it. */
export function nextParamsForProcess(prev: URLSearchParams, processId: string): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (processId) next.set("processId", processId); else next.delete("processId");
  next.delete("lob");
  return next;
}

export function nextParamsForReset(prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const k of ["branchId", "processId", "lob", "from", "to"]) next.delete(k);
  return next;
}

const isAll = (v: string | undefined | null) => !v || v === "all" || v === "ALL" || v === "__all__";

/** Append the shared scope filters to a query, omitting unset / "all" values. */
export function scopeParams(
  filters: Pick<RosterConsoleFilters, "branchId" | "processId" | "lobId">,
  base: Record<string, string> = {},
): URLSearchParams {
  const p = new URLSearchParams(base);
  if (!isAll(filters.branchId)) p.set("branchId", filters.branchId);
  if (!isAll(filters.processId)) p.set("processId", filters.processId);
  if (!isAll(filters.lobId)) p.set("lobId", filters.lobId);
  return p;
}

export interface FilterChipModel { key: "branchId" | "processId" | "lob" | "dates"; label: string; value: string }

export function buildChips(
  filters: RosterConsoleFilters,
  names: { branch?: string; process?: string; lob?: string },
  now: Date = new Date(),
): FilterChipModel[] {
  const chips: FilterChipModel[] = [];
  if (filters.branchId) chips.push({ key: "branchId", label: "Branch", value: names.branch ?? filters.branchId });
  if (filters.processId) chips.push({ key: "processId", label: "Process", value: names.process ?? filters.processId });
  if (filters.lobId) chips.push({ key: "lob", label: "LOB", value: filters.lobId === "__none__" ? "Unassigned" : (names.lob ?? filters.lobId) });
  const d = defaultFilters(now);
  if (filters.from !== d.from || filters.to !== d.to) chips.push({ key: "dates", label: "Dates", value: `${filters.from} → ${filters.to}` });
  return chips;
}
