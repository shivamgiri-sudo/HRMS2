import type { DecideAction } from "./useDecide";
import type { Impact } from "./useImpact";
import type { RequestKind, RosterRequest } from "./types";

export interface ActionDef { action: DecideAction; label: string; needsReason: boolean }

const A = (action: DecideAction, label: string, needsReason: boolean): ActionDef => ({ action, label, needsReason });

/** Allowed actions per kind, mirroring backend decide.ts. */
export function actionsForKind(kind: RequestKind): ActionDef[] {
  switch (kind) {
    case "swap": return [A("approve", "Approve", false), A("reject", "Reject", true)];
    case "weekoff_rejection": return [A("approve", "Approve", true), A("reject", "Reject", true), A("realign", "Realign", true), A("escalate", "Escalate", true)];
    case "dispute": return [A("approve", "Approve", true), A("reject", "Reject", true)];
    case "conflict": return [A("approve", "Resolve", true)];
  }
}

export function counterpartNotAccepted(request: RosterRequest): boolean {
  if (request.kind !== "swap") return false;
  const s = (request.raw as { counterpart_status?: string } | null)?.counterpart_status;
  return s === "pending" || s === "declined";
}

/** Why Approve is unavailable (null = available). */
export function approveDisabledReason(request: RosterRequest, impact: Impact | undefined, forceWithoutCounterpart = false): string | null {
  if (!impact) return "Roster impact not loaded yet";
  if (impact.blockers.length) return `Blocked: ${impact.blockers[0]}${impact.blockers.length > 1 ? ` (+${impact.blockers.length - 1} more)` : ""}`;
  if (counterpartNotAccepted(request) && !forceWithoutCounterpart) return "Counterpart has not accepted";
  return null;
}

/** One-key approve is only for approve actions needing no reason and with no blockers. */
export function canQuickApprove(request: RosterRequest, impact: Impact | undefined): boolean {
  const def = actionsForKind(request.kind).find((a) => a.action === "approve");
  return !!def && !def.needsReason && approveDisabledReason(request, impact) === null;
}

export const BULK_KINDS: RequestKind[] = ["swap", "weekoff_rejection", "dispute"];
