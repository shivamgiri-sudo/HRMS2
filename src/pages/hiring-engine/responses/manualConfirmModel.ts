/**
 * Pure model of the "Mark confirmed" dialog (POST /api/he/responses/manual): after an off-system call or at the desk, HR records the
 * candidate's answer. The same booking path as the candidate's own tap runs on the server (no approval step). Write roles only.
 */
import { whenText } from "./responsesModel";

export type ManualAnswer = "confirm" | "decline" | "reschedule";
export type ManualVia = "phone_call" | "walk_in_desk" | "other";
export const MANUAL_ANSWERS: ReadonlyArray<{ id: ManualAnswer; label: string }> = [
  { id: "confirm", label: "Will come (confirm)" }, { id: "decline", label: "Cannot come" }, { id: "reschedule", label: "Needs another time" },
];
export const MANUAL_VIA: ReadonlyArray<{ id: ManualVia; label: string }> = [{ id: "phone_call", label: "Phone call" }, { id: "walk_in_desk", label: "At the desk" }, { id: "other", label: "Other" }];
export const MANUAL_PATH = "/api/he/responses/manual";

export interface ManualTarget { leadId?: string | null; metaLeadId?: string | null; name: string; requisitionId?: string | null; slotAt?: string | null }
export interface RequisitionChoice { id: string; label: string }
export interface ManualForm { requisitionId: string; answer: ManualAnswer; via: ManualVia; note: string }

export const initialForm = (t: ManualTarget, choices: RequisitionChoice[]): ManualForm => ({
  requisitionId: t.requisitionId ?? (choices.length === 1 ? choices[0].id : ""), answer: "confirm", via: "phone_call", note: "",
});
export function formErrors(f: ManualForm): string[] {
  const e: string[] = [];
  if (!/^[0-9a-f-]{36}$/i.test(f.requisitionId)) e.push("Pick the requisition");
  const n = f.note.trim().length;
  if (n < 3 || n > 300) e.push("Write a note of 3 to 300 characters (what the candidate said)");
  return e;
}
export function manualBody(t: ManualTarget, f: ManualForm): Record<string, string> {
  return { requisitionId: f.requisitionId, answer: f.answer, via: f.via, note: f.note.trim(), ...(t.leadId ? { leadId: t.leadId } : {}), ...(t.metaLeadId ? { metaLeadId: t.metaLeadId } : {}) };
}
/** What will happen to the booking, said before saving. */
export function slotLine(t: ManualTarget, f: ManualForm): string {
  if (f.answer === "decline") return "Nothing is booked; the person is marked as not coming.";
  if (t.slotAt) return f.answer === "confirm" ? `The slot ${whenText(t.slotAt)} is confirmed and the reminders start.` : `The slot ${whenText(t.slotAt)} is released and new times are offered.`;
  return f.answer === "confirm" ? "The nearest free slot on the next drive day is booked and the reminders start." : "A slot is booked and released so new times are offered.";
}
export const doneText = (state: string): string => (state ? `Saved. The booking is now ${state.replace(/_/g, " ")}.` : "Saved.");
