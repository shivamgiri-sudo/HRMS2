import { type RequestKind } from "./types";

export const AUTO_KINDS: readonly RequestKind[] = ["swap", "weekoff_rejection"];

export interface AutoRuleRow {
  process_id: string; kind: string; enabled: number | boolean;
  max_coverage_drop: number | string; require_counterpart_accept: number | boolean;
}
export interface AutoRuleDraft { enabled: boolean; maxCoverageDrop: string; requireCounterpartAccept: boolean }

/** Default is OFF, matching the server when no row exists. */
export const DEFAULT_RULE: AutoRuleDraft = { enabled: false, maxCoverageDrop: "0", requireCounterpartAccept: true };

export function ruleFor(rows: readonly AutoRuleRow[], processId: string, kind: RequestKind): AutoRuleDraft {
  const r = rows.find((x) => x.process_id === processId && x.kind === kind);
  if (!r) return { ...DEFAULT_RULE };
  return { enabled: !!Number(r.enabled), maxCoverageDrop: String(Number(r.max_coverage_drop)), requireCounterpartAccept: !!Number(r.require_counterpart_accept) };
}

export type AutoRuleValidation =
  | { ok: true; body: { processId: string; kind: RequestKind; enabled: boolean; maxCoverageDrop: number; requireCounterpartAccept: boolean } }
  | { ok: false; error: string };

export function validateAutoRule(processId: string, kind: string, d: AutoRuleDraft): AutoRuleValidation {
  if (!processId.trim()) return { ok: false, error: "Choose a process." };
  if (!(AUTO_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Only shift swaps and week-off rejections can be auto-approved." };
  const raw = d.maxCoverageDrop.trim();
  if (!/^\d+$/.test(raw)) return { ok: false, error: "Max coverage drop must be a whole number, 0 or more." };
  return { ok: true, body: { processId: processId.trim(), kind: kind as RequestKind, enabled: d.enabled, maxCoverageDrop: Number(raw), requireCounterpartAccept: d.requireCounterpartAccept } };
}
