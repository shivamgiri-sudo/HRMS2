/**
 * Suggests a class for a free-text reply (email or WhatsApp) with a confidence, for the HR review queue. Never applied on its own
 * (owner decision O6). Base rules are the reply-intent rules (parseReplyIntent) plus a few phrases replies commonly use, negation guards
 * ("no problem" is not a decline) and question detection. Email quoting and signatures are removed first so the original invitation
 * below a reply is never read as the answer. Pure.
 */
import { parseReplyIntent } from "./he-intent.js";
import { answerFromIntent, type ResponseAnswer } from "./response-normalise.js";

export interface Classification { answer: ResponseAnswer; confidence: number; reasons: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const has = (t: string, phrases: string[]) => phrases.find((p) => new RegExp(`(^| )${p}( |$)`).test(t)) ?? null;

const GUARDS = ["no problem", "no issue", "no issues", "no worries", "koi dikkat nahi", "koi dikkat nahin", "koi problem nahi", "koi baat nahi"];
const WRONG = ["wrong number", "galat number", "wrong person", "not me"];
const UNSUB = ["do not message", "don t message", "dont message", "do not contact", "don t contact", "stop messaging", "do not call", "don t call"];
const DECLINE = ["not able", "unable", "won t be able", "wont be able", "not possible", "nahi aa", "nhi aa", "not available", "already joined", "got another job", "job mil gayi", "not looking"];
const RESCHEDULE = ["next week", "some other day", "other day", "another day", "instead", "postpone", "dusre din", "agle hafte"];
const CONFIRM = ["will come", "will be there", "i ll come", "i ll be there", "coming", "sure", "definitely", "aa jaunga", "aa jaungi", "aa raha", "aa rahi", "theek hai", "thik hai", "attend"];
const QUESTION = ["kya", "kitna", "kitni", "kab", "kahan", "kaha", "kaise", "salary", "address", "location", "when", "where", "what", "how", "which", "documents"];

/** The reply's own words: cut at the first quote header, quoted line, signature or "sent from" line. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const l = raw.trim();
    if (/^on\s.+wrote:?$/i.test(l) || /^-{2,}\s*original message\s*-{2,}$/i.test(l) || /^-- ?$/.test(raw) || /^>/.test(l) || /^sent from my\b/i.test(l)
      || /^(regards|best regards|thanks (and|&) regards|warm regards|kind regards)\b/i.test(l) || /^from:\s/i.test(l)) break;
    out.push(raw);
  }
  return out.join("\n").trim();
}

function clauseAnswer(t: string): { answer: ResponseAnswer; why: string } | null {
  let p = has(t, WRONG); if (p) return { answer: "wrong_person", why: `"${p}"` };
  p = has(t, UNSUB); if (p) return { answer: "unsubscribe", why: `"${p}"` };
  const i = parseReplyIntent(t);
  if (i !== "unknown" && i !== "skip") return { answer: answerFromIntent(i), why: `reply rule ${i}` };
  p = has(t, DECLINE); if (p) return { answer: "decline", why: `"${p}"` };
  p = has(t, RESCHEDULE); if (p) return { answer: "reschedule", why: `"${p}"` };
  p = has(t, CONFIRM); if (p) return { answer: "confirm", why: `"${p}"` };
  return null;
}

export function classifyReply(text: string, _o: { channel?: "email" | "whatsapp" } = {}): Classification {
  const top = stripQuoted(text);
  if (!top) return { answer: "other", confidence: 0, reasons: ["empty"] };
  const reasons: string[] = [];
  let t = norm(top);
  let guarded = false;
  for (const g of GUARDS) if (has(t, [g])) { t = norm(t.replace(new RegExp(`(^| )${g}( |$)`, "g"), " ")); guarded = true; reasons.push(`"${g}" is not a decline`); }
  const question = top.includes("?") || !!has(t, QUESTION);
  const clauses = top.split(/[.!?;,\n]+|\bbut\b|\blekin\b/i).map(norm).filter(Boolean)
    .map((c) => GUARDS.reduce((s, g) => norm(s.replace(new RegExp(`(^| )${g}( |$)`, "g"), " ")), c)).filter(Boolean);
  const found = clauses.map(clauseAnswer).filter((x): x is { answer: ResponseAnswer; why: string } => !!x);
  const distinct = [...new Set(found.map((f) => f.answer))];
  if (question && distinct.length) reasons.push("also asks a question");
  if (distinct.length === 1) return { answer: distinct[0], confidence: 0.9, reasons: [...reasons, found[0].why] };
  if (distinct.length > 1) {
    const whole = t ? clauseAnswer(t) : null;
    return { answer: whole?.answer ?? found[found.length - 1].answer, confidence: 0.6, reasons: [...reasons, `mixed: ${distinct.join(", ")}`] };
  }
  if (question) return { answer: "question", confidence: 0.8, reasons: [...reasons, "question"] };
  if (guarded) return { answer: "confirm", confidence: 0.6, reasons };
  return { answer: "other", confidence: 0.3, reasons: [...reasons, "no clear answer"] };
}
