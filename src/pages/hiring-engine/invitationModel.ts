/**
 * Pure decisions of the candidate invitation page (/w/:token), for match tokens and invite tokens (people invited without a match).
 */
import type { PageAnswer } from "./InvitationParts";

export interface PageCtx { kind?: "match" | "invite"; rsvpOpen?: boolean; closedReason?: string | null; state?: string; open: boolean }

/** The email's ?a= value, when it is one of the page's answers. */
export function preAnswer(a: string | null): PageAnswer | null {
  return a === "yes" || a === "later" || a === "no" || a === "stop" ? a : null;
}

/** After an answer on an invite token the server returns the booked match's token: the page continues on it (location on the day). */
export function nextTokenAfterAnswer(current: string, data: { matchToken?: string | null } | null | undefined): string | null {
  const t = data?.matchToken;
  return t && /^[a-f0-9]{32}$/.test(t) && t !== current ? t : null;
}

/** Which body the page shows before the location card logic. */
export function pageMode(ctx: PageCtx, stopped: boolean): "stopped" | "closed_opening" | "answer" | "booked" {
  if (stopped || ctx.state === "stopped") return "stopped";
  if (ctx.kind === "invite" && ctx.closedReason) return "closed_opening";
  return ctx.rsvpOpen ? "answer" : "booked";
}

export function answerErrorText(status: number): string {
  if (status === 403) return "Your slot time has passed, so this can no longer be changed here.";
  if (status === 404) return "This link is not valid any more. Please use the latest message we sent you.";
  return "That did not work. Please try again.";
}
