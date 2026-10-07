/** Requisition readiness rules (pure): what must be true before a source stream may be opened on a requisition. */
import type { SourceType } from "./qualified-followup.types.js";

export type ReadinessCode = "requisition_not_open" | "no_headcount" | "no_branch_address" | "address_multiline" | "no_bmi_link" | "no_slot_window" | "no_invite_template" | "no_template";
export interface ReadinessProblem { code: ReadinessCode; severity: "blocking" | "warning"; message: string }
export interface RequisitionFacts {
  approvalStatus: string | null; activeStatus: number | boolean | null; requested: number; fulfilled: number;
  branchAddress: string | null; bmiLink: string | null; slotStart: string; slotEnd: string; slotMinutes: number;
  t1Approved: number; t8Approved: number; sourceType?: SourceType | null;
}

/** An admin override never lifts these. */
export const NEVER_OVERRIDE: ReadonlySet<ReadinessCode> = new Set<ReadinessCode>(["requisition_not_open", "no_headcount"]);

const TIME = /^\d{2}:\d{2}/;

export function evaluateRequisitionReadiness(f: RequisitionFacts): ReadinessProblem[] {
  const out: ReadinessProblem[] = [];
  const add = (code: ReadinessCode, severity: ReadinessProblem["severity"], message: string) => out.push({ code, severity, message });
  if (f.approvalStatus !== "approved" || !f.activeStatus) add("requisition_not_open", "blocking", "Requisition is not approved and active");
  if (!(Number(f.fulfilled) < Number(f.requested))) add("no_headcount", "blocking", "No open positions left on this requisition");
  const addr = f.branchAddress;
  if (addr == null || !String(addr).trim()) add("no_branch_address", "blocking", "Add the branch address in Branch master");
  else if (/[\r\n]/.test(String(addr).trim())) add("address_multiline", "warning", "Branch address has line breaks; they are sent as one line");
  if ((f.bmiLink == null || !String(f.bmiLink).trim()) && f.sourceType !== "he") add("no_bmi_link", "warning", "No BookMyInterview link: the WhatsApp step sends T8 (tap to book a slot) instead of T1");
  const slotOk = TIME.test(f.slotStart) && TIME.test(f.slotEnd) && f.slotStart.slice(0, 5) < f.slotEnd.slice(0, 5) && Number(f.slotMinutes) > 0;
  if (!slotOk) add("no_slot_window", "blocking", "The daily plan has no valid slot window");
  if (!(Number(f.t1Approved) > 0) && !(Number(f.t8Approved) > 0)) add("no_template", "blocking", "No approved WhatsApp invite template (T1 or T8)");
  else if (!(Number(f.t1Approved) > 0)) add("no_invite_template", "warning", "T1 is not approved; T8 is used");
  return out;
}

export const isBlocking = (p: ReadinessProblem[]): boolean => p.some((x) => x.severity === "blocking");
