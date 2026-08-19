/**
 * Subject line for the D-1 Daily Manager Intelligence Briefing email.
 *
 * No PII or sensitive detail — no employee names, no descriptions, nothing that could
 * identify a specific person or issue on a shared/locked-screen inbox preview. Spec §32
 * examples do ask for a critical-count / action-count in the subject (a bare number,
 * not what the count is about), which is safe under the same rule the MVP subject
 * already followed — this integration pass widens the subject to include those counts
 * while keeping the same "no PII/sensitive content" guarantee. `attention`/`actions`
 * are only present on a brief built by the integration pass's buildManagerDailyBrief;
 * a brief missing them (e.g. an older/partial payload) falls back to the original
 * MVP-only subject line unchanged.
 */
import type { ManagerDailyBrief } from "./daily-brief.types.js";
import type { ExecutiveDailyBrief } from "./daily-brief-aggregator.service.js";

export function buildDailyBriefSubject(
  brief: Pick<ManagerDailyBrief, "businessDate" | "attention" | "actions">,
): string {
  const criticalCount = (brief.attention ?? []).filter((s) => s.priority === "critical").length;
  const actionCount = brief.actions?.length ?? 0;

  const parts: string[] = [];
  if (criticalCount > 0) parts.push(`${criticalCount} critical`);
  if (actionCount > 0) parts.push(`${actionCount} action${actionCount === 1 ? "" : "s"}`);

  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Your Daily Team Briefing — ${brief.businessDate}${suffix}`;
}

/**
 * Subject line for the executive-rollup shaped brief (Gap 2 — see
 * daily-brief-executive-rollup.module.ts). Same no-PII rule as buildDailyBriefSubject:
 * bare counts only, sourced from the rollup's top-N business actions
 * (business_action_queue) — never a branch/employee name.
 */
export function buildExecutiveDailyBriefSubject(brief: Pick<ExecutiveDailyBrief, "businessDate" | "rollup">): string {
  const criticalCount = brief.rollup.topActions.filter((a) => a.severity === "critical").length;
  const actionCount = brief.rollup.topActions.length;

  const parts: string[] = [];
  if (criticalCount > 0) parts.push(`${criticalCount} critical`);
  if (actionCount > 0) parts.push(`${actionCount} org-wide action${actionCount === 1 ? "" : "s"}`);

  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `Your Executive Daily Briefing — ${brief.businessDate}${suffix}`;
}
