// The approve-shortlist bar, the why-not lookup and the override dialog as pure functions (S19).
import { parseWhen, relativeAgo } from "./completenessModel";
import type { ApprovalState, WhyNotPerson } from "./selectionTypes";

export interface RunPerson { id: string; maskedMobile: string; subSource: string; verdict: string; score: number; status: string; reasons: string[] }

export function approveView(s: ApprovalState, people: RunPerson[], unticked: ReadonlySet<string>, reviewOk: ReadonlySet<string>, now: Date) {
  const c = s.lastRun?.counts ?? {};
  const picked = people.filter((p) => p.status === "picked");
  const approveCount = picked.filter((p) => !unticked.has(p.id)).length + people.filter((p) => p.status === "review" && reviewOk.has(p.id)).length;
  const why = !s.permissions.approve ? "Only HR can approve shortlists" : s.blocker ? blockerText(s.blocker) : !s.lastRun ? "Run the shortlist first"
    : approveCount === 0 ? "Nobody is ticked" : null;
  return {
    runText: s.lastRun ? `Last run ${relativeAgo(s.lastRun.at, now)}: ${c.picked ?? 0} shortlisted, ${c.review ?? 0} for review, ${c.approved ?? 0} approved, ${c.unticked ?? 0} unticked${c.capped ? `; ${c.capped} more pass but are over today's seat cap` : ""}` : "No shortlist run yet",
    versionText: s.currentVersion ? `Criteria version ${s.currentVersion.versionNo}${s.drift ? " (changed since the last run)" : ""}` : "Criteria not saved yet",
    approveCount, canApprove: why === null, why,
    standing: s.standing.filter((x) => parseWhen(x.validUntil) > now.getTime()).map((x) => ({ id: x.id, text: `Standing approval for Live Meta until ${x.validUntil}` })),
  };
}

export function blockerText(b: string): string {
  if (b.startsWith("criteria_incomplete")) return "Criteria incomplete: decide location, education, shift and age first";
  if (b.startsWith("Not open: ")) return `The requisition is not open: ${b.slice("Not open: ".length)}`;
  if (b.startsWith("Enrolment is off")) return "Enrolment is off for this requisition: turn on HR approves shortlists in the criteria";
  return b.charAt(0).toUpperCase() + b.slice(1);
}

const VERDICT_WORD: Record<string, string> = { pass: "Would be shortlisted", review: "Held for HR review", fail: "Not shortlisted" };
export function whyNotView(p: WhyNotPerson) {
  return p.perRequisition.map((r) => ({
    requisitionId: r.requisitionId, code: r.code,
    headline: r.systemBlock ? `Never contacted: ${r.systemBlock}` : VERDICT_WORD[r.verdict] ?? r.verdict,
    explanation: r.explanation,
    lines: [...r.failed.map((f) => `Fails ${f.label}: has ${f.actualText || "nothing"}, needs ${f.requiredText}`), ...r.unknown.map((u) => `Unknown ${u.label}: ${u.effect}`)],
    override: r.override ? `HR ${r.override.kind === "include" ? "included" : "left out"} this person: ${r.override.reason}` : null,
    lastDecision: r.lastDecision ? `Last run: ${r.lastDecision.status}${r.lastDecision.versionNo ? ` under version ${r.lastDecision.versionNo}` : ""}` : null,
    journey: r.journey ? `In follow-up: ${r.journey.state.replaceAll("_", " ")}` : null,
  }));
}

export function overrideCheck(reason: string): { ok: boolean; why: string | null } {
  const t = reason.trim();
  if (!t) return { ok: false, why: "A reason is required" };
  if (t.length > 300) return { ok: false, why: "The reason is longer than 300 characters" };
  return { ok: true, why: null };
}
