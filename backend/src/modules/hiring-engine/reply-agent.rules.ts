/**
 * Candidate email reply agent: the pure parts. What the agent may say comes only from one candidate's fact sheet (their requisition,
 * branch and slot); the process / client name is never in the fact sheet and is scrubbed from anything that reaches a candidate.
 * Every drafted reply passes `validateReply` before it can be sent; a failure holds it for HR. No I/O here.
 */
export type ReplyIntent =
  | "confirm" | "decline" | "reschedule" | "ask_address" | "ask_time" | "ask_documents" | "ask_job" | "ask_salary" | "ask_shift"
  | "ask_eligibility" | "ask_selection" | "assessment_link" | "already_joined" | "opt_out" | "complaint" | "other";

/** Intents the agent may answer without a person, once the facts it needs are present. */
export const AUTO_INTENTS: ReadonlySet<ReplyIntent> = new Set<ReplyIntent>([
  "confirm", "decline", "reschedule", "ask_address", "ask_time", "ask_documents", "ask_job", "ask_salary", "ask_shift", "ask_eligibility", "assessment_link", "already_joined",
]);
/** Never answered by the agent: a person decides (opt_out is handled by the STOP path with its own acknowledgement). */
export const HUMAN_INTENTS: ReadonlySet<ReplyIntent> = new Set<ReplyIntent>(["complaint", "ask_selection", "other", "opt_out"]);

export interface FactSheet {
  name: string;
  role: string;
  branch: string;
  address: string | null;
  mapsLink: string | null;
  slotDate: string | null;   // "Monday, 12 Oct 2026"
  slotTime: string | null;   // "11:00 AM"
  documents: string;
  assessmentLink: string | null;
  hrContact: string | null;  // "name and number"
  company: string;
  jobDescription: string | null;
  skills: string | null;
  education: string | null;
  experience: string | null; // "0 to 2 years"
  salary: string | null;     // "Rs 15,000 to Rs 20,000 a month"
  employmentType: string | null;
  shift: string | null;
}

/** Terms that must never reach a candidate (process, client and department names, requisition codes). */
export function scrub(text: string, deny: readonly string[]): string {
  // Requisition codes (they carry the process name) go first, then every process / client term.
  let out = text.replace(/\b[A-Z0-9]{2,}-[A-Za-z][A-Za-z0-9]*-\d+\b/g, "").replace(/\bREQ-\d+-[A-Z0-9]+\b/g, "");
  for (const term of deny) {
    const t = term.trim();
    if (t.length < 3) continue;
    out = out.replace(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "the process");
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

const FORBIDDEN = /\b(you (are|have been|were) selected|selection (is )?confirmed|offer letter|guarantee[d]?|assured (job|placement)|100% (job|placement)|appointment letter|joining letter|pay (us|a fee)|registration fee|security deposit)\b/i;
const MAX_LEN = 1400;

export interface ValidateInput { text: string; facts: FactSheet; deny: readonly string[] }
export function validateReply(i: ValidateInput): { ok: true } | { ok: false; reason: string } {
  const t = i.text;
  if (!t.trim()) return { ok: false, reason: "empty" };
  if (t.length > MAX_LEN) return { ok: false, reason: "too_long" };
  for (const term of i.deny) if (term.trim().length >= 3 && new RegExp(`\\b${term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) return { ok: false, reason: "process_name_exposed" };
  if (FORBIDDEN.test(t)) return { ok: false, reason: "forbidden_promise" };
  // Only the branch's own contact number may appear.
  const allowed = new Set<string>((i.facts.hrContact ?? "").match(/\d{10}/g) ?? []);
  for (const n of t.replace(/[\s-]/g, "").match(/\d{10,}/g) ?? []) if (!allowed.has(n.slice(-10))) return { ok: false, reason: "unknown_phone_number" };
  // Only our own links.
  const okUrls = [i.facts.assessmentLink, i.facts.mapsLink].filter((x): x is string => !!x);
  for (const u of t.match(/https?:\/\/[^\s)>"']+/g) ?? []) if (!okUrls.some((a) => u.startsWith(a.replace(/[?#].*$/, "")))) return { ok: false, reason: "unknown_link" };
  // A money figure must be the requisition's own range.
  if (/(?:rs\.?|₹|inr)\s?\d/i.test(t) && !i.facts.salary) return { ok: false, reason: "salary_not_in_requisition" };
  return { ok: true };
}

export interface Draft { intent: ReplyIntent; language: "en" | "hi" | "hinglish"; confidence: number; needsHuman: boolean; reply: string; reasons: string[] }

export type Disposition = { action: "send" | "queue" | "hold"; reason: string };
/** Whether a validated draft goes out by itself. mode: 0 off, 1 draft only (HR sends), 2 automatic. */
export function disposition(d: Draft, v: { ok: boolean }, mode: number, ctx: { inWindow: boolean; matched: boolean; optedOut: boolean }): Disposition {
  if (mode <= 0) return { action: "hold", reason: "agent_off" };
  if (!ctx.matched) return { action: "hold", reason: "unknown_sender" };
  if (ctx.optedOut) return { action: "hold", reason: "opted_out" };
  if (!v.ok) return { action: "hold", reason: "validation_failed" };
  if (d.needsHuman || HUMAN_INTENTS.has(d.intent)) return { action: "hold", reason: "needs_human" };
  if (!AUTO_INTENTS.has(d.intent)) return { action: "hold", reason: "intent_not_automatic" };
  if (d.confidence < 0.8) return { action: "hold", reason: "low_confidence" };
  if (mode < 2) return { action: "hold", reason: "draft_mode" };
  return ctx.inWindow ? { action: "send", reason: "auto" } : { action: "queue", reason: "outside_window" };
}

const sig = (f: FactSheet) => `Regards,\nHR Team, ${f.company}${f.hrContact ? `\n${f.hrContact}` : ""}`;
/** "Monday, 12 October 2026 at 10:30 AM" from "2026-10-12" and "10:30"; the raw text when it is not in that shape. */
export function prettySlot(date: string, time: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const t = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!d || !t) return `${date} at ${time}`;
  const day = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
  if (Number.isNaN(day.getTime())) return `${date} at ${time}`;
  const text = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const h = Number(t[1]);
  return `${text} at ${h % 12 === 0 ? 12 : h % 12}:${t[2]} ${h < 12 ? "AM" : "PM"}`;
}
const slotLine = (f: FactSheet) => (f.slotDate && f.slotTime ? prettySlot(f.slotDate, f.slotTime) : null);

/** Safe wording used when no model is configured, and as the base the model must stay consistent with. Pure. */
export function ruleReply(intent: ReplyIntent, f: FactSheet): string | null {
  const hi = `Dear ${f.name},`;
  const where = f.address ? `${f.branch}, ${f.address}` : f.branch;
  const slot = slotLine(f);
  switch (intent) {
    case "confirm":
      return `${hi}\n\nThank you for confirming. We look forward to meeting you${slot ? ` on ${slot}` : ""} at ${where}.${f.mapsLink ? `\nLocation: ${f.mapsLink}` : ""}\nPlease carry: ${f.documents}.\n\n${sig(f)}`;
    case "ask_address":
      return `${hi}\n\nThe walk-in for the ${f.role} role is at ${where}.${f.mapsLink ? `\nLocation: ${f.mapsLink}` : ""}${slot ? `\nYour slot: ${slot}.` : ""}\n\n${sig(f)}`;
    case "ask_time":
      return slot ? `${hi}\n\nYour walk-in slot is ${slot} at ${where}. Please arrive 10 minutes early.\n\n${sig(f)}` : null;
    case "ask_documents":
      return `${hi}\n\nPlease carry the following: ${f.documents}.\n\n${sig(f)}`;
    case "ask_job":
      return f.jobDescription
        ? `${hi}\n\nThe role is ${f.role} at ${f.company}, ${f.branch}. ${f.jobDescription}\n\n${sig(f)}`
        : `${hi}\n\nThis is for the ${f.role} role at ${f.company}, ${f.branch}. Our team will explain the job in detail at the walk-in.\n\n${sig(f)}`;
    case "ask_salary":
      return f.salary ? `${hi}\n\nFor the ${f.role} role, the salary range is ${f.salary}. The exact offer is discussed after your interview.\n\n${sig(f)}` : null;
    case "ask_shift":
      return f.shift ? `${hi}\n\nThe role works in ${f.shift}.\n\n${sig(f)}` : null;
    case "ask_eligibility":
      return f.education || f.experience
        ? `${hi}\n\nFor the ${f.role} role we look for: ${[f.education && `education: ${f.education}`, f.experience && `experience: ${f.experience}`].filter(Boolean).join("; ")}. Our team will confirm your eligibility at the walk-in.\n\n${sig(f)}`
        : `${hi}\n\nOur team will check your eligibility for the ${f.role} role at the walk-in. Please carry: ${f.documents}.\n\n${sig(f)}`;
    case "assessment_link":
      return f.assessmentLink ? `${hi}\n\nHere is your assessment link: ${f.assessmentLink}\nPlease complete it before your walk-in.\n\n${sig(f)}` : null;
    case "reschedule":
      return `${hi}\n\nThank you for letting us know. We have noted your request for another day. You will receive a new invitation with your updated slot shortly.\n\n${sig(f)}`;
    case "decline":
      return `${hi}\n\nThank you for letting us know. We will not contact you further for this role. We wish you the best.\n\n${sig(f)}`;
    case "already_joined":
      return `${hi}\n\nThank you for letting us know, and congratulations. We have updated our records.\n\n${sig(f)}`;
    default:
      return null;
  }
}

/** Keyword classification used when no model is configured (and as a cross-check). Pure; null = not sure. */
export function ruleIntent(text: string): { intent: ReplyIntent; confidence: number } | null {
  const t = text.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const has = (re: RegExp) => re.test(t);
  if (has(/\b(stop|unsubscribe|do not (message|contact|call)|dont (message|contact|call))\b/)) return { intent: "opt_out", confidence: 0.95 };
  if (has(/\b(scam|fraud|cheat|complain|police|legal|harass|spam|why are you)\b/)) return { intent: "complaint", confidence: 0.9 };
  if (has(/\b(already (joined|working)|got (a )?job|joined (another|somewhere))\b/)) return { intent: "already_joined", confidence: 0.85 };
  // Asking for another chance or another day, in the many ways people write it ("give me again 1 chance", "late seen this message",
  // "schedule my interview to Monday"): a new slot, not a question for a person.
  if (has(/\b(again|another|one more|1 more|second|new|next)\s+(1\s+|one\s+)?(chance|opportunity|slot|time|date)\b/)
    || has(/\b(give|giv|allow|provide)\s+me\b.{0,25}\b(chance|time|slot|date)\b/)
    || has(/\blate\s+(seen|saw|noticed|read|checked)\b/)
    || has(/\bmissed\b.{0,25}\b(message|mail|email|interview|slot|call)\b/)
    || has(/\b(schedule|reschedule|shift|move|change)\s+(my\s+|the\s+)?(interview|slot|walk ?in|appointment)\b/)
    || has(/\bcan i come\s+(tomorrow|today|on|next|monday|tuesday|wednesday|thursday|friday|saturday)\b/)) return { intent: "reschedule", confidence: 0.9 };
  // "I can come now" / "you can come now" / "on my way": they are coming.
  if (has(/\b(i|we|u|you)\s+can\s+come\s+(now|today|tomorrow|right now)\b/) || has(/\b(coming|reaching|leaving)\s+(now|shortly|soon)\b/) || has(/\bon (my|the) way\b/)) return { intent: "confirm", confidence: 0.9 };
  if (has(/\b(selected|selection|offer letter|result)\b/)) return { intent: "ask_selection", confidence: 0.8 };
  if (has(/\b(salary|ctc|package|pay|income|stipend)\b/)) return { intent: "ask_salary", confidence: 0.85 };
  if (has(/\b(shift|night|timing of job|work from home|wfh|rotational|week ?off|sunday)\b/)) return { intent: "ask_shift", confidence: 0.8 };
  if (has(/\b(address|location|where|map|landmark|route|kaha|kahan)\b/)) return { intent: "ask_address", confidence: 0.85 };
  if (has(/\b(what time|timing|reporting time|kab|when should)\b/)) return { intent: "ask_time", confidence: 0.8 };
  if (has(/\b(document|documents|bring|carry|certificate|aadhaar|pan)\b/)) return { intent: "ask_documents", confidence: 0.85 };
  if (has(/\b(link|assessment|test|bmi)\b/)) return { intent: "assessment_link", confidence: 0.75 };
  if (has(/\b(eligible|eligibility|fresher|12th|graduate|graduation|experience|qualification|age limit)\b/)) return { intent: "ask_eligibility", confidence: 0.8 };
  if (has(/\b(job description|about the job|role|profile|what is the job|jd|which process|what process|process|details|tell me more|kya kaam|what work|kaam)\b/)) return { intent: "ask_job", confidence: 0.8 };
  if (has(/\b(reschedule|another day|other day|next week|postpone|different day|cannot come|can t come|cannot attend|can t attend|unable to attend|unable to come|not able to attend|not able to come|not available|some other time|dusre din)\b/)) return { intent: "reschedule", confidence: 0.85 };
  if (has(/\b(not interested|no thanks|not looking|nahi aa|will not come|won t come|will not attend|won t attend|not attending|not coming|remove my)\b/)) return { intent: "decline", confidence: 0.85 };
  if (has(/\b(yes|ok|okay|confirm|confirmed|will come|will be there|coming|sure|haan|aa jaunga|aa jaungi|aunga|aungi|theek hai|thik hai|will attend|attend|attending|will visit|visit|will join|will reach|i will be present|present)\b/)) return { intent: "confirm", confidence: 0.8 };
  return null;
}

const CITIES = ["ahmedabad", "mumbai", "pune", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "lucknow", "jaipur", "surat", "vadodara", "baroda", "rajkot",
  "indore", "bhopal", "patna", "ranchi", "nagpur", "chandigarh", "kanpur", "varanasi", "gandhinagar", "agra", "meerut", "dehradun", "raipur", "bhubaneswar", "guwahati",
  "coimbatore", "kochi", "visakhapatnam", "ludhiana", "amritsar", "jodhpur", "udaipur", "nashik", "thane", "mysore", "bareilly", "gorakhpur", "prayagraj", "allahabad"];
/** The city a candidate says they live in, when it is not the branch's own: "I am in Ahmedabad", "staying at Surat". null otherwise. Pure. */
export function detectOtherCity(text: string, branchCity: string | null | undefined): string | null {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const own = String(branchCity ?? "").toLowerCase().trim();
  const cue = /\b(i am|i m|im|i live|living|live in|stay|staying|based|currently|resident|from|belong|reside|residing)\b/;
  if (!cue.test(t)) return null;
  for (const c of CITIES) {
    if (c === own) continue;
    if (new RegExp(`\\b${c}\\b`).test(t)) return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return null;
}
export const elsewhereReply = (f: FactSheet, city: string): string =>
  `Dear ${f.name},\n\nThank you for letting us know that you are in ${city}. This walk-in is at ${f.branch}, so we have taken you off this list. We will contact you if a walk-in opens in your city.\n\n${sig(f)}`;
