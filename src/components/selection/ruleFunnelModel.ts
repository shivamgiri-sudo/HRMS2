// One adapter for the preview's funnel bars and their text table (S18), plus the outcome tiles, the partial banner and sample cells.
import { labelOf } from "./ruleInfo";
import type { PreviewResult } from "./selectionTypes";

export interface TextTable { caption: string; columns: string[]; rows: string[][] }
export interface FunnelBar { label: string; still: number; left: number; review: number }

/** "Willing to work night shift: willing to work night shift" reads as the label alone. */
export function stepLabel(label: string): string {
  const i = label.indexOf(": ");
  if (i < 0) return label;
  const a = label.slice(0, i), b = label.slice(i + 2);
  return a.toLowerCase() === b.toLowerCase() ? a : label;
}
const nf = new Intl.NumberFormat("en-IN");

export function funnelView(p: PreviewResult): { bars: FunnelBar[]; table: TextTable; aria: string; empty: boolean } {
  const steps = p.steps;
  const bars: FunnelBar[] = [{ label: "Everyone in the source", still: p.start, left: 0, review: 0 }, ...steps.map((s) => ({ label: stepLabel(s.label), still: s.remaining, left: s.failedHere, review: s.reviewHere }))];
  const rows = [["Everyone in the source", String(p.start), "0", "0", "–", "–"],
    ...steps.map((s) => [stepLabel(s.label), String(s.remaining), String(s.failedHere), String(s.reviewHere), s.kind === "system" ? "–" : String(s.onlyThisRuleFails), s.kind === "must" ? String(s.ifRemovedGain) : "–"])];
  const end = steps.length ? steps[steps.length - 1].remaining : p.start;
  const o = p.outcome;
  return {
    bars, empty: p.start === 0,
    table: { caption: "Rule funnel: people left after each rule, and why they left", columns: ["Step", "Still in", "Left at this step", "Sent to review here", "Fail only this rule", "Would pass if removed"], rows },
    aria: `Rule funnel: ${p.start} people start, ${end} remain after every rule; ${o.shortlist} shortlisted, ${o.review} for review, ${o.rejected} rejected, ${o.systemExcluded} never contacted.`,
  };
}

export function outcomeTiles(p: PreviewResult): Array<{ label: string; value: string; note: string }> {
  return [
    { label: "Shortlist", value: nf.format(p.outcome.shortlist), note: "meet every MUST rule" },
    { label: "Review", value: nf.format(p.outcome.review), note: "a MUST rule is unknown: HR decides" },
    { label: "Rejected", value: nf.format(p.outcome.rejected), note: "fail a MUST rule" },
    { label: "Never contacted", value: nf.format(p.outcome.systemExcluded), note: "system rules" },
    { label: "Seats left", value: nf.format(p.capPreview.seatsLeft), note: "on the requisition" },
  ];
}

export function partialText(p: PreviewResult): string | null {
  if (!p.partial.length) return null;
  const capped = p.partial.find((x) => x.startsWith("capped_at_"));
  if (capped) return `Only the first ${nf.format(Number(capped.slice("capped_at_".length)))} people were evaluated: the counts are partial.`;
  const live = p.partial.find((x) => x.startsWith("facts_cache_empty_live_read_capped_at_"));
  if (live) return `The facts cache was empty, so the first ${nf.format(Number(live.split("_").pop()))} records were read live: the counts are partial.`;
  if (p.partial.includes("facts_cache_empty_live_read")) return "The facts cache was empty for this source, so the records were read live.";
  return `Partial result: ${p.partial.join(", ")}`;
}

export function cellView(c: { key: string; outcome: "pass" | "fail" | "unknown"; text: string }): { icon: "check" | "x" | "help"; word: string; aria: string } {
  const word = c.outcome === "pass" ? "Yes" : c.outcome === "fail" ? "No" : "Unknown";
  return { icon: c.outcome === "pass" ? "check" : c.outcome === "fail" ? "x" : "help", word, aria: `${labelOf(c.key)}: ${word.toLowerCase()}, ${c.text}` };
}

export const SOURCE_TABS = [{ id: "meta_live", label: "Live Meta" }, { id: "meta_old", label: "Old Meta data" }, { id: "he", label: "Hiring Engine" }] as const;
export const SUB_SOURCES_FOR: Record<"meta_live" | "meta_old" | "he", ReadonlyArray<{ id: string; label: string }>> = {
  meta_live: [{ id: "all", label: "All" }],
  meta_old: [{ id: "all", label: "All" }],
  he: [{ id: "all", label: "All pool sources" }, { id: "candidate", label: "ATS candidates" }, { id: "naukri_import", label: "Naukri upload" }, { id: "workindia_import", label: "WorkIndia upload" },
    { id: "walk_in", label: "Walk-ins" }, { id: "intake_upload", label: "Other uploads" }, { id: "pool_other", label: "Pool, no ATS record" }],
};
