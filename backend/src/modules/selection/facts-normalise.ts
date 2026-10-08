// One CandidateFacts shape for every source, with data-quality flags (plan 2026-10-09, S6 + Design 6). Pure.
// A fact that is a placeholder, an import default, stale or ambiguous is unknown to the engine: never a pass.
import { normalizeMobile10 } from "../hiring-engine/he-phone.js";
import type { MatchLead } from "../hiring-engine/he-matcher.js";
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { deriveExperienceYears, parseLead } from "../meta-campaign/meta-lead.parser.js";
import type { MetaLeadDetail } from "../meta-campaign/meta-campaign.types.js";
import { metaAnswerFacts } from "./meta-answer-facts.js";
import type { CandidateFacts, FactValue, SourceKind, SubSource } from "./selection-types.js";

type Row = Record<string, unknown>;
export interface RawPerson {
  sourceKind: SourceKind; subSource: SubSource; mobile: string;
  ats: Row | null;        // ats_candidate columns
  lead: Row | null;       // he_lead columns
  profile: Row | null;    // he_lead_profile columns
  meta: { rawPayload: unknown; parsedEducation: string | null; parsedLocation: string | null; parsedExperienceYr: number | null; createdAt: string } | null;
  dra: { status: string } | null;
  system: CandidateFacts["system"];
  contact: { lastFirstContactAt: string | null };
}

const fv = <T>(value: T | null, quality: FactValue<T>["quality"], from: string): FactValue<T> => ({ value, quality, from });
const missing = <T>(from = ""): FactValue<T> => fv<T>(null, "missing", from);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).trim() || null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const first = <T>(...xs: Array<FactValue<T> | undefined>): FactValue<T> => xs.find((x) => x && x.quality === "ok") ?? xs.find((x) => x && x.quality !== "missing") ?? missing<T>();
const ranged = (v: number | null, lo: number, hi: number, from: string): FactValue<number> =>
  v === null ? missing(from) : v < lo || v > hi ? fv<number>(null, "ambiguous", from) : fv(v, "ok", from);
const jsonList = (v: unknown): string[] | null => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) { try { const j = JSON.parse(v); return Array.isArray(j) ? j.map(String) : v.split(/[,;]/).map((s) => s.trim()).filter(Boolean); } catch { return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean); } }
  return null;
};

/** ccc, na, n/a, -, ., xxx, test, nil, one repeated character, digits only. */
export function isPlaceholder(text: string | null): boolean {
  if (text === null || text === undefined) return false;
  const t = String(text).trim().toLowerCase();
  if (!t) return true;
  return /^(na|n\/a|nil|null|none|test|xxx+|-+|\.+)$/.test(t) || /^(.)\1*$/.test(t.replace(/\s/g, "")) || /^\d+$/.test(t.replace(/\s/g, ""));
}

/** Naukri annual salary text ("INR 3.5 L", "Rs 12 Lakhs") as monthly INR; null when unreadable. */
export function parseLakhs(text: string | null): number | null {
  const m = String(text ?? "").match(/(\d+(?:\.\d+)?)\s*(l\b|lakh|lac)/i);
  return m ? Math.round((Number(m[1]) * 100000) / 12) : null;
}

export function parseNoticeDays(text: string | null): { days: number | null; quality: FactValue<number>["quality"] } {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return { days: null, quality: "missing" };
  if (/serving/.test(t)) return { days: 30, quality: "ok" }; // counts as <= 30 (catalogue)
  if (/more than\s*3\s*month/.test(t)) return { days: 120, quality: "ok" };
  const d = t.match(/(\d+)\s*days?/);
  if (d) return { days: Number(d[1]), quality: "ok" };
  const m = t.match(/(\d+)\s*months?/);
  if (m) return { days: Number(m[1]) * 30, quality: "ok" };
  if (/immediate/.test(t)) return { days: 0, quality: "ok" };
  return { days: null, quality: "ambiguous" };
}

/** Naukri "last active" is relative to when the row was imported, not to today. Upper bound for ranges. ISO date or null. */
export function anchorLastActive(text: string | null, importedAt: string | null): string | null {
  const t = String(text ?? "").toLowerCase();
  const base = importedAt ? new Date(`${String(importedAt).slice(0, 10)}T00:00:00Z`) : null;
  if (!t.trim() || !base || Number.isNaN(base.getTime())) return null;
  let days: number | null = null;
  if (/today|just now/.test(t)) days = 0;
  else if (/yesterday/.test(t)) days = 1;
  else {
    const n = t.match(/(\d+)\s*(day|week|month)/);
    if (n) days = Number(n[1]) * (n[2] === "week" ? 7 : n[2] === "month" ? 30 : 1);
  }
  if (days === null) return null;
  return new Date(base.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

const yearsBetween = (dob: string, now: Date): number | null => {
  const d = new Date(String(dob).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a--;
  return a;
};
function atsExperience(text: string | null): number | null {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/fresher/.test(t)) return 0;
  const y = t.match(/(\d+(?:\.\d+)?)\s*y/), m = t.match(/(\d+)\s*m/);
  if (y || m) return Math.round(((y ? Number(y[1]) : 0) + (m ? Number(m[1]) / 12 : 0)) * 10) / 10;
  return deriveExperienceYears(text);
}
const gender = (v: unknown): "male" | "female" | "other" | null => {
  const g = String(v ?? "").trim().toLowerCase();
  if (!g) return null;
  if (/^f|female|woman|girl/.test(g)) return "female";
  if (/^m|male|man|boy/.test(g)) return "male";
  return /other|trans|non/.test(g) ? "other" : null;
};
const ENG: Record<string, 1 | 2 | 3> = { basic: 1, intermediate: 2, advanced: 3, fluent: 3 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const yn = (v: unknown, from: string): FactValue<boolean> | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" || /^[01]$/.test(String(v))) return fv(Number(v) === 1, "ok", from);
  const s = String(v).toLowerCase();
  if (/^(yes|y|true|ok|comfortable)/.test(s)) return fv(true, "ok", from);
  if (/^(no|n|false|not)/.test(s)) return fv(false, "ok", from);
  return fv<boolean>(null, "ambiguous", from);
};

function metaParsed(raw: unknown) {
  let d = raw;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } }
  return d && typeof d === "object" && Array.isArray((d as { field_data?: unknown }).field_data) ? parseLead(d as MetaLeadDetail) : null;
}

export function normaliseFacts(p: RawPerson, now: Date): CandidateFacts {
  const a = p.ats ?? {}, l = p.lead ?? {}, pr = p.profile ?? {};
  const isWorkIndia = p.subSource === "workindia_import" || a.record_type === "workindia_import";
  const parsed = p.meta ? metaParsed(p.meta.rawPayload) : null;
  const answers = metaAnswerFacts(parsed?.rawFields ?? {});
  const metaInput = p.meta ? {
    parsedAge: parsed?.age ?? null, parsedEducation: parsed?.education ?? p.meta.parsedEducation ?? null, parsedExperienceYr: parsed?.experienceYears ?? p.meta.parsedExperienceYr ?? null,
    parsedGender: parsed?.gender ?? null, rawFields: parsed?.rawFields ?? {},
  } : null;

  // education
  const eduText = str(a.education);
  const eduAts = eduText === null ? undefined : isWorkIndia && /^graduate$/i.test(eduText) ? fv<number>(null, "source_default", "workindia.education")
    : eduRank(eduText) > 0 ? fv(eduRank(eduText), "ok", "ats.education") : fv<number>(null, "ambiguous", "ats.education");
  const eduMeta = metaInput?.parsedEducation ? (eduRank(metaInput.parsedEducation) > 0 ? fv(eduRank(metaInput.parsedEducation), "ok", "meta.education") : fv<number>(null, "ambiguous", "meta.education")) : undefined;
  const educationRank = first(num(l.education_rank) ? fv(num(l.education_rank)!, "ok", "he_lead.education_rank") : undefined, eduAts, eduMeta, answers.educationRank);

  const age = first(num(l.age) !== null ? ranged(num(l.age), 14, 70, "he_lead.age") : undefined, str(a.date_of_birth) ? ranged(yearsBetween(String(a.date_of_birth), now), 14, 70, "ats.date_of_birth") : undefined,
    str(pr.dob) ? ranged(yearsBetween(String(pr.dob), now), 14, 70, "profile.dob") : undefined, metaInput?.parsedAge != null ? ranged(metaInput.parsedAge, 14, 70, "meta.age") : undefined);
  const experienceYears = first(num(l.experience_years) !== null ? ranged(num(l.experience_years), 0, 45, "he_lead.experience_years") : undefined,
    str(a.experience) ? ranged(atsExperience(str(a.experience)), 0, 45, "ats.experience") : undefined,
    metaInput?.parsedExperienceYr != null ? ranged(metaInput.parsedExperienceYr, 0, 45, "meta.experience") : undefined, answers.experienceYears);

  // location: every residence text; all placeholders = placeholder, none = missing
  const parts = [str(l.locality), str(a.current_address), str(a.address), str(a.permanent_address), p.meta?.parsedLocation ?? null, str(parsed?.rawFields?.city), str(pr.address), str(pr.state)].filter((x): x is string => x !== null);
  const real = parts.filter((x) => !isPlaceholder(x));
  const locationText = real.length ? fv(real.join(" ").toLowerCase(), "ok", "residence") : parts.length ? fv<string>(null, "placeholder", "residence") : missing<string>("residence");
  const pref = jsonList(a.preferred_locations);
  const preferredLocations = pref?.length ? fv(pref, "ok", "ats.preferred_locations") : missing<string[]>("ats.preferred_locations");
  const hometown = str(a.hometown) && !isPlaceholder(str(a.hometown)) ? fv(str(a.hometown)!, "ok", "ats.hometown") : missing<string>("ats.hometown");

  const nightShiftOk = first(yn(l.night_shift_ok, "he_lead.night_shift_ok"), yn(a.night_shift_ok, "ats.night_shift_ok"), yn(a.night_shift_comfortable, "ats.night_shift_comfortable"), answers.nightShiftOk);
  const rotationalOk = first(yn(a.rotational_shift, "ats.rotational_shift"), yn(a.rotational_shift_comfort, "ats.rotational_shift_comfort"), answers.rotationalOk);
  const relocationOk = first(answers.relocationOk);

  // money and availability
  const expectation = num(pr.salary_expectation);
  const salaryMonthly = expectation !== null ? ranged(expectation, 3000, 500000, "profile.salary_expectation")
    : str(a.annual_salary) ? (parseLakhs(str(a.annual_salary)) === null ? fv<number>(null, "ambiguous", "naukri.annual_salary") : ranged(parseLakhs(str(a.annual_salary)), 3000, 500000, "naukri.annual_salary"))
    : num(pr.last_salary) !== null ? ranged(num(pr.last_salary), 3000, 500000, "profile.last_salary") : missing<number>("salary");
  const nd = parseNoticeDays(str(a.notice_period));
  const noticeDays = fv(nd.days, nd.quality, "naukri.notice_period");

  // skills, languages, certificates, employers
  const english = str(pr.english_level) ? (ENG[String(pr.english_level).toLowerCase()] ? fv(ENG[String(pr.english_level).toLowerCase()], "ok", "profile.english_level") : fv<1 | 2 | 3>(null, "ambiguous", "profile.english_level")) : undefined;
  const englishLevel = first(english, answers.englishLevel);
  const typingWpm = first(num(pr.typing_wpm) ? fv(num(pr.typing_wpm)!, "ok", "profile.typing_wpm") : undefined, num(a.typing_speed) ? fv(num(a.typing_speed)!, "ok", "ats.typing_speed") : undefined, answers.typingWpm);
  const langs = jsonList(pr.languages);
  const languages = langs ? fv(langs.map((x) => x.toLowerCase()), "ok", "profile.languages") : missing<string[]>("profile.languages");
  const certMap = new Map<string, "declared" | "verified">();
  let certKnown = false;
  for (const c of jsonList(pr.certifications) ?? []) { certMap.set(c.toUpperCase(), "declared"); certKnown = true; }
  for (const c of answers.certificates?.value ?? []) { if (!certMap.has(c.code)) certMap.set(c.code, "declared"); certKnown = true; }
  if (answers.certificates?.quality === "ok") certKnown = true;
  if (p.dra) {
    certKnown = true;
    if (p.dra.status === "verified") certMap.set("DRA", "verified");
    else if (p.dra.status === "pending" && !certMap.has("DRA")) certMap.set("DRA", "declared");
  }
  const certificates = certKnown ? fv([...certMap].map(([code, level]) => ({ code, level })), "ok", "certificates")
    : answers.certificates ?? missing<Array<{ code: string; level: "declared" | "verified" }>>("certificates");
  const emps = [str(a.current_employer), str(pr.last_employer)].filter((x): x is string => !!x && !isPlaceholder(x));
  const employers = emps.length ? fv(emps, "ok", "employer") : missing<string[]>("employer");
  const skills = [str(pr.skills_text), str(a.role_applied)].filter(Boolean).join(" ");
  const skillsText = skills ? fv(skills, "ok", "skills") : missing<string>("skills");
  const g = gender(pr.gender) ?? gender(a.gender) ?? gender(metaInput?.parsedGender);
  const genderF = g ? fv(g, "ok", "gender") : missing<"male" | "female" | "other">("gender");
  const status = str(pr.education_status) as "completed" | "pursuing" | "dropped" | null;
  const educationStatus = status ? fv(status, "ok", "profile.education_status") : missing<"completed" | "pursuing" | "dropped">("profile.education_status");
  const stream = str(pr.stream) ? fv(str(pr.stream)!.toLowerCase(), "ok", "profile.stream") : missing<string>("profile.stream");

  // contact and recency
  const emailRaw = str(a.email) ?? str(l.email) ?? parsed?.email ?? null;
  const email = emailRaw === null ? missing<string>("email") : EMAIL.test(emailRaw) ? fv(emailRaw.toLowerCase(), "ok", "email") : fv<string>(null, "ambiguous", "email");
  const la = anchorLastActive(str(a.last_active_naukri), str(a.created_at));
  const lastActiveAt = la ? fv(la, "ok", "naukri.last_active_naukri") : str(a.last_active_naukri) ? fv<string>(null, "ambiguous", "naukri.last_active_naukri") : missing<string>("naukri.last_active_naukri");
  const upd = str(l.updated_at) ?? str(a.updated_at) ?? p.meta?.createdAt ?? null;
  const recordUpdatedAt = upd ? fv(upd, "ok", "record") : missing<string>("record");
  const key = normalizeMobile10(p.mobile);
  const name = str(a.full_name) ?? str(l.full_name) ?? parsed?.name ?? null;

  const ok = <T>(f: FactValue<T>) => (f.quality === "ok" ? f.value : null);
  const match: MatchLead = {
    age: ok(age), educationRank: ok(educationRank), experienceYears: ok(experienceYears), nightShiftOk: ok(nightShiftOk),
    lat: num(l.lat), lng: num(l.lng), gender: ok(genderF), languages: ok(languages), certifications: ok(certificates)?.map((c) => c.code) ?? null,
    typingWpm: ok(typingWpm), englishLevel: ok(englishLevel) ? (["basic", "intermediate", "advanced"] as const)[ok(englishLevel)! - 1] : null,
    salaryExpectation: expectation !== null && salaryMonthly.quality === "ok" ? salaryMonthly.value : null,
    lastSalary: expectation === null && salaryMonthly.quality === "ok" ? salaryMonthly.value : null,
    educationStatus: ok(educationStatus), stream: ok(stream), prevIndustry: str(pr.prev_industry), city: str(l.locality), state: str(pr.state), skillsText: ok(skillsText),
  };
  return {
    personKey: key ?? String(p.mobile).replace(/\D/g, "").slice(-10), firstName: name ? name.split(/\s+/)[0].slice(0, 40) : null, sourceKind: p.sourceKind, subSource: p.subSource, sourceDetail: str(a.source_details), recordType: str(a.record_type),
    age, educationRank, educationStatus, stream, experienceYears, skillsText, locationText, preferredLocations, hometown, relocationOk, nightShiftOk, rotationalOk,
    salaryMonthly, salaryIsExpectation: expectation !== null, noticeDays, englishLevel, typingWpm, languages, gender: genderF, certificates, employers,
    formAnswers: parsed?.rawFields ?? null, lastActiveAt, recordUpdatedAt, lastFirstContactAt: p.contact.lastFirstContactAt, email, mobileValid: key !== null,
    system: p.system, metaInput, match,
  };
}
