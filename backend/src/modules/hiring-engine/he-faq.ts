/**
 * WhatsApp bot answers (pure): recognises the common candidate questions in Hinglish or English and builds the reply
 * from the candidate's own invitation. Only facts we hold are used; unknown questions return null and go to a human.
 */
export type FaqKind = "address" | "documents" | "timing" | "salary" | "job" | "contact";

const RULES: Array<[FaqKind, RegExp]> = [
  ["address", /\b(address|location|kaha|kahan|kidhar|where|map|direction|rasta|route|office kaha|pata)\b/i],
  ["documents", /\b(document|documents|docs|kya laana|kya lana|kya leke|carry|bring|papers|aadhaar|aadhar|pan card|resume|cv|marksheet)\b/i],
  ["timing", /\b(time|timing|kab|kitne baje|when|date|slot|kis din)\b/i],
  ["salary", /\b(salary|ctc|package|kitna milega|pay|stipend|incentive|tankhwah|paisa)\b/i],
  ["job", /\b(job|role|kaam|work|profile|position|kya kaam|which company|company ka naam|process)\b/i],
  ["contact", /\b(contact|number|call me|baat|hr ka number|kisse baat|phone)\b/i],
];

export function detectFaq(text: string | null | undefined): FaqKind | null {
  const t = String(text ?? "").trim();
  if (!t || t.length > 300) return null;
  for (const [k, re] of RULES) if (re.test(t)) return k;
  return null;
}

export interface FaqContext {
  firstName: string; role: string | null; company: string; branch: string | null; address: string | null; maps: string | null;
  dateLabel: string | null; timeLabel: string | null; docs: string; salaryText: string | null; contact: string | null; lang: "hi" | "en";
}

export function faqAnswer(kind: FaqKind, c: FaqContext): string | null {
  const hi = c.lang === "hi";
  const when = c.dateLabel && c.timeLabel ? `${c.dateLabel}, ${c.timeLabel}` : null;
  switch (kind) {
    case "address":
      if (!c.address && !c.maps) return null;
      return hi ? `${c.firstName}, interview ka address: ${c.branch ?? ""}${c.address ? `, ${c.address}` : ""}.${c.maps ? ` Map: ${c.maps}` : ""}` : `${c.firstName}, the interview venue is ${c.branch ?? ""}${c.address ? `, ${c.address}` : ""}.${c.maps ? ` Map: ${c.maps}` : ""}`;
    case "documents":
      return hi ? `Please saath laayein: ${c.docs}. Ek pen bhi rakh lein.` : `Please bring: ${c.docs}, and a pen.`;
    case "timing":
      if (!when) return null;
      return hi ? `Aapka interview ${when} par hai. Time badalna ho to "2" bhejein.` : `Your interview is on ${when}. Reply "2" to change the time.`;
    case "salary":
      if (!c.salaryText) return null;
      return hi ? `${c.role ?? "Is role"} ke liye salary ${c.salaryText} hai (interview ke baad final hoti hai).` : `The salary for ${c.role ?? "this role"} is ${c.salaryText} (final after the interview).`;
    case "job":
      if (!c.role) return null;
      return hi ? `Ye ${c.company} mein ${c.role} ki job hai${c.branch ? `, ${c.branch} branch` : ""}.` : `This is the ${c.role} role at ${c.company}${c.branch ? `, ${c.branch} branch` : ""}.`;
    case "contact":
      if (!c.contact) return null;
      return hi ? `Aap HR se baat kar sakte hain: ${c.contact}.` : `You can reach HR at ${c.contact}.`;
  }
}

export function salaryText(min: number | null, max: number | null): string | null {
  const f = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;
  if (min && max) return `${f(min)} - ${f(max)} per month`;
  if (max) return `up to ${f(max)} per month`;
  if (min) return `from ${f(min)} per month`;
  return null;
}
