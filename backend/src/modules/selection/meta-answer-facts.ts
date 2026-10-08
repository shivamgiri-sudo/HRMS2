// Canonical facts from Meta form answers (plan 2026-10-09, S6). Pure. Field names are parseLead's normalised keys;
// values go through the screener's own isAffirmative / extractWpm / englishRank so a fact means what screening means.
import { CERT_FIELD_PATTERNS, englishRank, extractWpm, isAffirmative } from "../meta-campaign/lead-screener.service.js";
import type { CandidateFacts, FactValue } from "./selection-types.js";

type MetaFacts = Partial<Pick<CandidateFacts, "nightShiftOk" | "rotationalOk" | "relocationOk" | "educationRank" | "certificates" | "typingWpm" | "englishLevel" | "experienceYears">>;

const fv = <T>(value: T | null, quality: FactValue<T>["quality"], from: string): FactValue<T> => ({ value, quality, from });
const yesNo = (answer: string, from: string): FactValue<boolean> => {
  const a = isAffirmative(answer);
  return a === null ? fv<boolean>(null, "ambiguous", from) : fv(a, "ok", from);
};
const find = (answers: Record<string, string>, re: RegExp): [string, string] | null => {
  for (const [k, v] of Object.entries(answers)) if (re.test(k) && String(v ?? "").trim()) return [k, String(v)];
  return null;
};

export function metaAnswerFacts(answers: Record<string, string>): MetaFacts {
  const out: MetaFacts = {};
  const night = find(answers, /night.?shift/i);
  if (night) out.nightShiftOk = yesNo(night[1], `meta.${night[0]}`);
  const rot = find(answers, /rotational/i);
  if (rot) out.rotationalOk = yesNo(rot[1], `meta.${rot[0]}`);
  const reloc = find(answers, /relocat|travel|work_from_our/i);
  if (reloc) out.relocationOk = /relocat/i.test(reloc[1]) ? fv(true, "ok", `meta.${reloc[0]}`) : yesNo(reloc[1], `meta.${reloc[0]}`);
  const grad = find(answers, /graduat/i);
  if (grad) {
    const g = isAffirmative(grad[1]);
    // "No" to "are you a graduate" says below graduate, not which rank: unknown, never a guessed rank.
    out.educationRank = g === true ? fv(5, "ok", `meta.${grad[0]}`) : fv<number>(null, "ambiguous", `meta.${grad[0]}`);
  }
  const certs: Array<{ code: string; level: "declared" }> = [];
  let certAsked = false, certAmbiguous = false, certFrom = "";
  for (const [code, re] of Object.entries(CERT_FIELD_PATTERNS)) {
    const hit = Object.entries(answers).find(([k, v]) => re.test(k) && /certif/i.test(k) && String(v ?? "").trim());
    if (!hit) continue;
    certAsked = true; certFrom = `meta.${hit[0]}`;
    const a = isAffirmative(hit[1]);
    if (a === true) certs.push({ code, level: "declared" });
    if (a === null) certAmbiguous = true;
  }
  if (certAsked) out.certificates = certAmbiguous && !certs.length ? fv<Array<{ code: string; level: "declared" | "verified" }>>(null, "ambiguous", certFrom) : fv(certs, "ok", certFrom);
  const typing = find(answers, /typing.*speed|wpm|words.*per.*min/i);
  if (typing) {
    const w = extractWpm(typing[1]);
    out.typingWpm = w === null ? fv<number>(null, "ambiguous", `meta.${typing[0]}`) : fv(w, "ok", `meta.${typing[0]}`);
  }
  const eng = find(answers, /written.*english|english.*written|english.*level|english.*proficien/i);
  if (eng) {
    const r = englishRank(eng[1]);
    out.englishLevel = r === 0 ? fv<1 | 2 | 3>(null, "ambiguous", `meta.${eng[0]}`) : fv(r as 1 | 2 | 3, "ok", `meta.${eng[0]}`);
  }
  const months = find(answers, /month/i);
  if (months) {
    const n = Number(String(months[1]).match(/\d+(\.\d+)?/)?.[0]);
    out.experienceYears = Number.isFinite(n) ? fv(Math.round((n / 12) * 10) / 10, "ok", `meta.${months[0]}`) : fv<number>(null, "ambiguous", `meta.${months[0]}`);
  }
  return out;
}
