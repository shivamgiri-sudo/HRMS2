// The requisition lists of the Command Center section and the campaign drawer (S20), as pure functions.
import { labelOf } from "./ruleInfo";
import { versionLine } from "./completenessModel";
import type { RequisitionItem } from "./selectionTypes";

export interface ListRow { id: string; code: string; where: string; status: string; defaulted: string | null; version: string; incomplete: boolean }

export function listRows(items: RequisitionItem[], now: Date): ListRow[] {
  return items.map((i) => ({
    id: i.id, code: i.code, where: [i.branch, i.process, i.designation].filter(Boolean).join(" · "), status: i.approvalStatus ?? "unknown",
    defaulted: i.defaultedMust.length ? `${i.defaultedMust.length} not decided, acting as MUST: ${i.defaultedMust.map(labelOf).join(", ")}` : null,
    version: versionLine(i.version, now), incomplete: i.completeness.label !== "complete",
  }));
}

export function listCounts(items: RequisitionItem[]): string {
  const inc = items.filter((i) => i.completeness.label !== "complete").length;
  return `${items.length} requisitions, ${inc} with criteria incomplete`;
}

/** Roles that see the Command Center section at all (mirror of the server's read roles; the server refuses the rest). */
export const CRITERIA_READ_ROLES = ["super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management", "manager", "assistant_manager", "admin", "hr_admin", "ceo"] as const;
