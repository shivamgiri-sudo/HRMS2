/**
 * Pure view-model of the insights panel: ranking, per-session dismissal, counts and the mapping from an engine action to a control.
 * The engine delivers insights already ranked (critical > warn > info); grouping here is a stable sort by severity so a re-sorted or
 * hand-built list still reads the same way. Nothing here touches the DOM, storage or the clock.
 */
import type { DriveAnalytics, DriveInsight, InsightAction, InsightSeverity, SourceType } from "./driveCommandTypes";
import { SECTIONS, TYPE_LABEL, commandHash, type Filters, type SectionId } from "./driveCommandModel";

export type ActionIntent = "open_plan" | "plan_now" | "extend" | "create_stream" | "open_section" | "followup";
export interface ActionTarget {
  /** Section to navigate to; null for a dialog intent (the dialog opens over the current section). */
  section: SectionId | null;
  /** The real dialog this action opens (Task 14): the stream's Extend menu or the create-stream dialog for the requisition. */
  dialog?: "extend_stream" | "create_stream";
  /** Plan now (Task 15): the Plan section opens for the requisition and runs the dry-run preview of Plan now, focusing its result. */
  preview?: boolean;
  requisitionId?: string;
  streamId?: string;
  sourceType?: SourceType;
  date?: string;
  intent: ActionIntent;
  /** Button text. */
  label: string;
}

const SECTION_BY_KEY: Record<string, SectionId> = { live: "live", old: "old", he: "he" };
const CREATE_LABEL: Record<SourceType, string> = { meta_live: "Open a live Meta stream", meta_old: "Add an old-data re-run", he: "Open a pool stream" };
const sectionLabel = (s: SectionId): string => SECTIONS.find((x) => x.id === s)?.label ?? s;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/**
 * Maps an engine action to the control that serves it. Total: an unknown type, a missing field or a non-object gives null (no button).
 * Extend and create stream open their real dialogs for the requisition (no navigation). Open plan opens the Plan section for the
 * requisition; Plan now opens it with the dry-run preview of Plan now for that requisition and day. The follow-up panel lives on Summary.
 */
export function insightActionTarget(action: unknown): ActionTarget | null {
  if (!action || typeof action !== "object") return null;
  const a = action as Record<string, unknown>;
  const req = str(a.requisitionId);
  switch (a.type) {
    case "open_plan": return req ? { section: "plan", requisitionId: req, date: str(a.date), intent: "open_plan", label: "Open the plan" } : null;
    case "plan_now": return req ? { section: "plan", requisitionId: req, date: str(a.date), intent: "plan_now", label: "Preview Plan now", preview: true } : null;
    case "extend_stream": {
      const streamId = str(a.streamId);
      return req && streamId ? { section: null, dialog: "extend_stream", requisitionId: req, streamId, intent: "extend", label: "Extend the stream" } : null;
    }
    case "create_stream": {
      const t = str(a.sourceType);
      return req && t && t in TYPE_LABEL ? { section: null, dialog: "create_stream", requisitionId: req, sourceType: t as SourceType, intent: "create_stream", label: CREATE_LABEL[t as SourceType] } : null;
    }
    case "open_section": {
      const s = typeof a.section === "string" ? SECTION_BY_KEY[a.section] : undefined;
      return s ? { section: s, intent: "open_section", label: `Open ${sectionLabel(s)}` } : null;
    }
    case "open_followup": return { section: "summary", intent: "followup", label: "Open follow-up issues" };
    default: return null;
  }
}

// ---- severity -----------------------------------------------------------------------------------------------------------------------------
const RANK: Record<InsightSeverity, number> = { critical: 0, warn: 1, info: 2 };
export const SEVERITY_LABEL: Record<InsightSeverity, string> = { critical: "Critical", warn: "Warning", info: "Tip" };
const PLURAL: Record<InsightSeverity, string> = { critical: "critical", warn: "warnings", info: "tips" };
const SINGULAR: Record<InsightSeverity, string> = { critical: "critical", warn: "warning", info: "tip" };
const SEVERITIES: readonly InsightSeverity[] = ["critical", "warn", "info"];
const severityOf = (s: unknown): InsightSeverity => (s === "critical" || s === "warn" || s === "info" ? s : "info");

export interface InsightCard {
  id: string;
  severity: InsightSeverity;
  severityLabel: string;
  title: string;
  sourceType: SourceType | null;
  typeLabel: string | null;
  evidence: Array<{ label: string; value: string }>;
  suggestion: string;
  /** Estimated effect text, or null when the engine had no estimate. */
  effect: string | null;
  action: ActionTarget | null;
  actionAriaLabel: string | null;
  dismissAriaLabel: string;
}

const text = (v: unknown, fallback: string): string => {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : fallback;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
};

/** One card from one insight; never emits "undefined" or "NaN" whatever the payload holds. */
export function toCard(i: DriveInsight): InsightCard {
  const title = text(i.title, "Suggestion");
  const severity = severityOf(i.severity);
  const type = i.sourceType && i.sourceType in TYPE_LABEL ? i.sourceType : null;
  const action = insightActionTarget(i.action as InsightAction);
  return {
    id: String(i.id),
    severity,
    severityLabel: SEVERITY_LABEL[severity],
    title,
    sourceType: type,
    typeLabel: type ? TYPE_LABEL[type] : null,
    evidence: (Array.isArray(i.evidence) ? i.evidence : []).filter((e) => e && typeof e === "object").map((e) => ({ label: text(e.label, "Value"), value: text(e.value, "–") })),
    suggestion: text(i.suggestion, ""),
    effect: i.effect && typeof i.effect === "object" ? (typeof i.effect.text === "string" && i.effect.text.trim() !== "" ? i.effect.text.trim() : null) : null,
    action,
    actionAriaLabel: action ? `${action.label}: ${title}` : null,
    dismissAriaLabel: `Dismiss: ${title}`,
  };
}

/** Stable severity grouping: the delivered order is kept inside a severity; duplicate and id-less rows are dropped. */
export function rankInsights(all: readonly DriveInsight[] | null | undefined): DriveInsight[] {
  if (!Array.isArray(all)) return [];
  const seen = new Set<string>();
  const kept = all.filter((i) => {
    if (!i || typeof i !== "object" || typeof i.id !== "string" || i.id === "" || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
  return kept.map((i, at) => ({ i, at })).sort((a, b) => RANK[severityOf(a.i.severity)] - RANK[severityOf(b.i.severity)] || a.at - b.at).map((x) => x.i);
}

export function visibleInsights(all: readonly DriveInsight[], dismissed: ReadonlySet<string>): DriveInsight[] {
  return all.filter((i) => !dismissed.has(i.id));
}

export interface SeverityCounts { critical: number; warn: number; info: number; total: number }
export function severityCounts(list: readonly DriveInsight[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warn: 0, info: 0, total: 0 };
  for (const i of list) { c[severityOf(i.severity)] += 1; c.total += 1; }
  return c;
}

/** "2 critical, 1 warning, 3 tips" (zeros left out); "None" when there is nothing. */
export function countsText(c: SeverityCounts): string {
  const parts = SEVERITIES.filter((s) => c[s] > 0).map((s) => `${c[s]} ${c[s] === 1 ? SINGULAR[s] : PLURAL[s]}`);
  return parts.length ? parts.join(", ") : "None";
}

export type PanelState = "list" | "empty" | "all_dismissed" | "unavailable";
export interface PanelView {
  state: PanelState;
  cards: InsightCard[];
  counts: SeverityCounts;
  countsText: string;
  heading: string;
  dismissedCount: number;
  /** True when analytics were partial: the list may be missing suggestions. */
  incomplete: boolean;
  message: string | null;
}

export const EMPTY_MESSAGE = "No suggestions right now: the numbers are inside the expected range";
export const INCOMPLETE_MESSAGE = "Some analytics sections failed to load, so this list may be missing suggestions. Retry to recalculate.";
export const UNAVAILABLE_MESSAGE = "Suggestions could not be calculated for this range. Retry to try again.";
export const ALL_DISMISSED_MESSAGE = "All suggestions are dismissed for this session";

export function panelView(analytics: Pick<DriveAnalytics, "insights" | "partial"> | null | undefined, dismissed: ReadonlySet<string>): PanelView {
  const incomplete = !!analytics?.partial;
  const ranked = rankInsights(analytics?.insights);
  const shown = visibleInsights(ranked, dismissed);
  const counts = severityCounts(shown);
  const dismissedCount = ranked.length - shown.length;
  const base = { cards: shown.map(toCard), counts, countsText: countsText(counts), dismissedCount, incomplete };
  const n = counts.total;
  const heading = `${n} ${n === 1 ? "suggestion" : "suggestions"}`;
  if (!analytics || !Array.isArray(analytics.insights)) return { ...base, state: "unavailable", heading, message: UNAVAILABLE_MESSAGE };
  if (shown.length > 0) return { ...base, state: "list", heading, message: incomplete ? INCOMPLETE_MESSAGE : null };
  if (dismissedCount > 0) return { ...base, state: "all_dismissed", heading, message: incomplete ? INCOMPLETE_MESSAGE : ALL_DISMISSED_MESSAGE };
  // Never claim the numbers are fine when part of the analysis failed.
  return { ...base, state: incomplete ? "unavailable" : "empty", heading, message: incomplete ? INCOMPLETE_MESSAGE : EMPTY_MESSAGE };
}

/** The hash an action button navigates to: the target section (or `current` for a dialog intent), with the requisition narrowed when named. */
export function insightNavHash(target: ActionTarget, filters: Filters, current: SectionId = "summary"): string {
  return commandHash(target.section ?? current, { ...filters, requisitionId: target.requisitionId ?? filters.requisitionId });
}
