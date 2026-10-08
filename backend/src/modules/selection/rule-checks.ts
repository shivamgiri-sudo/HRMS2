// One rule against one person's facts: pass / fail / unknown with the actual value in words (plan 2026-10-09, S7). Pure.
// Meta people are checked with today's screenLead, one dimension at a time, so a Meta answer means exactly what Meta
// screening has always taken it to mean (legacy parity by construction). Everyone else uses the structured facts.
import { haversineKm } from "../hiring-engine/he-eta.js";
import { matchSkills } from "../hiring-engine/he-jd-doc.js";
import { locationVerdict } from "../hiring-engine/he-location-match.js";
import { screenLead, type ScreeningInput, type ScreeningRequirements } from "../meta-campaign/lead-screener.service.js";
import { EDU_LABEL, type Required } from "./compile-rules.js";
import type { CandidateFacts, CompiledRule, FactValue } from "./selection-types.js";

export interface Check { outcome: "pass" | "fail" | "unknown"; actualText: string; bonus?: number }
const pass = (actualText: string, bonus?: number): Check => ({ outcome: "pass", actualText, ...(bonus ? { bonus } : {}) });
const fail = (actualText: string): Check => ({ outcome: "fail", actualText });
const unknown = (actualText: string): Check => ({ outcome: "unknown", actualText });

export function unknownText(f: FactValue<unknown>): string {
  if (f.quality === "source_default" && /workindia\.education/.test(f.from)) return "unknown: import sets Graduate for everyone";
  switch (f.quality) {
    case "placeholder": return "unknown: placeholder text on record";
    case "source_default": return "unknown: the source fills a default value";
    case "ambiguous": return "unknown: unclear or out-of-range value";
    case "stale": return "unknown: record too old";
    default: return "unknown: not on record";
  }
}
const known = <T>(f: FactValue<T>): f is FactValue<T> & { value: T } => f.quality === "ok" && f.value !== null;
const ENG_NAME = ["", "basic", "intermediate", "advanced"];
const ENG_RANK: Record<string, number> = { basic: 1, intermediate: 2, advanced: 3 };
const DAY = 86_400_000;
const words = (t: string) => t.toLowerCase();
const mentions = (text: string, name: string) => new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ +/g, "[^a-z0-9]+")}([^a-z0-9]|$)`).test(words(text));

const NONE: ScreeningRequirements = { metaTargetAgeMin: null, metaTargetAgeMax: null, educationRequirement: null, experienceMinYears: null, experienceMaxYears: null, screeningConfig: null };
/** screenLead with only one dimension configured: fail = its reason, a skip naming the dimension = unknown. */
function screenOne(input: ScreeningInput, req: Partial<ScreeningRequirements>, prefix: string): Check {
  const r = screenLead(input, { ...NONE, ...req });
  if (!r.qualified) return fail(r.reason ?? "does not meet the requirement");
  const skip = r.skipped.find((s) => s.startsWith(prefix) && !/\(no (target band|requirement|minimum) set\)/.test(s));
  return skip ? unknown(`unknown: ${skip}`) : pass("meets it (form answer)");
}

function metaCheck(rule: CompiledRule, input: ScreeningInput): Check | null {
  const req = rule.required as never;
  switch (rule.key) {
    case "age": { const v = req as Required["age"]; return screenOne(input, { metaTargetAgeMin: v.min, metaTargetAgeMax: v.max }, "age"); }
    case "education_min": {
      const v = req as Required["education_min"];
      return screenOne(input, { educationRequirement: v.text ?? (v.rank ? EDU_LABEL[v.rank] : null) }, "education");
    }
    case "experience": {
      const v = req as Required["experience"];
      if (v.min === null) return null;
      return screenOne(input, { experienceMinYears: v.min }, "experience");
    }
    case "gender": return screenOne(input, { screeningConfig: { gender: (req as Required["gender"]).gender } }, "gender");
    case "certificate": {
      const v = req as Required["certificate"];
      if (v.level === "verified") return null; // a form can only declare; verification needs the certificate record
      return screenOne(input, { screeningConfig: { certifications: [v.code] } }, `certification "${v.code}"`);
    }
    case "languages": return screenOne(input, { screeningConfig: { language_requirements: (req as Required["languages"]).langs as never } }, "language");
    case "typing": return screenOne(input, { screeningConfig: { min_typing_speed_wpm: (req as Required["typing"]).wpm } }, "typing speed");
    case "english": return screenOne(input, { screeningConfig: { written_english_level: (req as Required["english"]).level } }, "written English");
    case "form_answer": return screenOne(input, { screeningConfig: { custom_field_rules: [(req as Required["form_answer"]).rule] } }, "custom rule");
    default: return null;
  }
}

function contradiction(rule: CompiledRule): Check | null {
  const v = rule.required as { min?: number | null; max?: number | null };
  if ((rule.key === "age" || rule.key === "experience") && v.min != null && v.max != null && v.min > v.max) return fail(`criteria contradict: ${v.min} > ${v.max}`);
  return null;
}

export function checkRule(rule: CompiledRule, f: CandidateFacts, now: Date): Check {
  const bad = contradiction(rule);
  if (bad) return bad;
  if (f.metaInput) {
    const m = metaCheck(rule, f.metaInput);
    if (m) {
      // the Meta screener checks the experience minimum only; an HR maximum is checked on the parsed value
      const max = rule.key === "experience" ? (rule.required as Required["experience"]).max : null;
      if (m.outcome === "pass" && max != null && known(f.experienceYears) && f.experienceYears.value > max) return fail(`${f.experienceYears.value} years, more than ${max}`);
      return m;
    }
  }
  const r = rule.required as never;
  switch (rule.key) {
    case "age": {
      const v = r as Required["age"];
      if (!known(f.age)) return unknown(unknownText(f.age));
      const a = f.age.value;
      return (v.min != null && a < v.min) || (v.max != null && a > v.max) ? fail(`age ${a}`) : pass(`age ${a}`);
    }
    case "education_min": {
      const v = r as Required["education_min"];
      if (!known(f.educationRank)) return unknown(unknownText(f.educationRank));
      const label = EDU_LABEL[f.educationRank.value] ?? `rank ${f.educationRank.value}`;
      if (v.rank > 0 && f.educationRank.value < v.rank) return fail(label);
      if (v.rank > 0 && f.educationStatus.value === "dropped" && f.educationRank.value <= v.rank) return fail(`${label}, not completed`);
      return v.rank > 0 ? pass(label) : unknown(`unknown: "${v.text}" is not on the education ladder`);
    }
    case "experience": {
      const v = r as Required["experience"];
      if (!known(f.experienceYears)) return unknown(unknownText(f.experienceYears));
      const y = f.experienceYears.value;
      return (v.min != null && y < v.min) || (v.max != null && y > v.max) ? fail(`${y} years`) : pass(`${y} years`);
    }
    case "night_shift": return !known(f.nightShiftOk) ? unknown(unknownText(f.nightShiftOk)) : f.nightShiftOk.value ? pass("willing") : fail("not willing to work nights");
    case "rotational_shift": return !known(f.rotationalOk) ? unknown(unknownText(f.rotationalOk)) : f.rotationalOk.value ? pass("OK with rotation") : fail("not OK with rotational shifts");
    case "location_region": case "location_cities": {
      const reloc = (r as { relocationOk: boolean }).relocationOk && known(f.relocationOk) && f.relocationOk.value;
      if (!known(f.locationText)) return reloc ? pass("will relocate") : unknown(f.locationText.quality === "placeholder" ? `location unknown (${f.locationText.from})` : unknownText(f.locationText));
      const text = f.locationText.value;
      let ok: boolean;
      if (rule.key === "location_region") {
        const v = r as Required["location_region"];
        const verdict = locationVerdict(text, v.branchName, v.branchCity, v.branchState);
        if (verdict === "unknown") return reloc ? pass("will relocate") : unknown(`unknown: "${text.slice(0, 60)}" names no known place`);
        ok = verdict === "local";
      } else {
        const cities = (r as Required["location_cities"]).cities;
        ok = cities.some((c) => mentions(text, c));
        // not a listed city: a fail needs another known place (a different city, a neighbouring city of the region, another state);
        // a state or a neighbourhood alone says nothing about the city, so it is unknown, never a silent rejection
        if (!ok && !cities.some((c) => locationVerdict(text, c, c) !== "unknown")) {
          return reloc ? pass("will relocate") : unknown(`unknown: "${text.slice(0, 60)}" names none of ${cities.join(", ")}`);
        }
      }
      if (ok) return pass(`lives in ${text.slice(0, 60)}`);
      return reloc ? pass(`lives in ${text.slice(0, 40)}, will relocate`) : fail(`lives in ${text.slice(0, 60)} (elsewhere)`);
    }
    case "location_radius": {
      const v = r as Required["location_radius"];
      if (f.match.lat == null || f.match.lng == null || v.lat == null || v.lng == null) return unknown("unknown: no map location");
      const km = Math.round(haversineKm(f.match.lat, f.match.lng, v.lat, v.lng) * 10) / 10;
      return km <= v.km ? pass(`${km} km`) : fail(`${km} km`);
    }
    case "gender": return !known(f.gender) ? unknown(unknownText(f.gender)) : f.gender.value === (r as Required["gender"]).gender ? pass(f.gender.value) : fail(f.gender.value);
    case "languages": {
      if (!known(f.languages)) return unknown(unknownText(f.languages));
      const miss = (r as Required["languages"]).langs.filter((l) => !f.languages.value!.includes(l.language.toLowerCase()));
      return miss.length ? fail(`not confirmed: ${miss.map((l) => l.language).join(", ")}`) : pass(f.languages.value.join(", "));
    }
    case "certificate": {
      const v = r as Required["certificate"];
      if (!known(f.certificates)) return unknown(unknownText(f.certificates));
      const c = f.certificates.value.find((x) => x.code === v.code);
      if (!c) return fail(`no ${v.code}`);
      if (v.level === "verified" && c.level !== "verified") return unknown(`unknown: ${v.code} declared, not verified yet`);
      return pass(`${v.code} ${c.level}`, c.level === "verified" ? v.verifiedBonus : 0);
    }
    case "english": {
      if (!known(f.englishLevel)) return unknown(unknownText(f.englishLevel));
      return f.englishLevel.value >= ENG_RANK[(r as Required["english"]).level] ? pass(ENG_NAME[f.englishLevel.value]) : fail(`${ENG_NAME[f.englishLevel.value]} English`);
    }
    case "typing": return !known(f.typingWpm) ? unknown(unknownText(f.typingWpm)) : f.typingWpm.value >= (r as Required["typing"]).wpm ? pass(`${f.typingWpm.value} wpm`) : fail(`${f.typingWpm.value} wpm`);
    case "form_answer": return unknown("unknown: no Meta form answers");
    case "notice_period": return !known(f.noticeDays) ? unknown(unknownText(f.noticeDays)) : f.noticeDays.value <= (r as Required["notice_period"]).maxDays ? pass(`${f.noticeDays.value} days`) : fail(`${f.noticeDays.value} days notice`);
    case "salary_fit": {
      const v = r as Required["salary_fit"];
      if (!known(f.salaryMonthly)) return unknown(unknownText(f.salaryMonthly));
      if (v.expectationOnly && !f.salaryIsExpectation) return unknown("unknown: no stated expectation");
      const expects = f.salaryIsExpectation ? f.salaryMonthly.value : Math.round(f.salaryMonthly.value * 1.15);
      return expects <= v.max * v.maxRatio ? pass(`expects ${expects}`) : fail(`expects ${expects}`);
    }
    case "employer_exclude": case "employer_include": {
      if (!known(f.employers)) return unknown(unknownText(f.employers));
      const hit = (r as Required["employer_include"]).names.find((n) => f.employers.value!.some((e) => mentions(e, n)));
      const was = f.employers.value.join(", ");
      return rule.key === "employer_exclude" ? (hit ? fail(`worked at ${was}`) : pass(was)) : (hit ? pass(`worked at ${was}`) : fail(was));
    }
    case "ex_employee": {
      const ex = f.system.exEmployee;
      if (ex === null) return pass("not a former employee");
      if (ex === "not_clean") return fail("former employee, did not leave cleanly");
      return (r as Required["ex_employee"]).value === "exclude" ? fail("former employee") : pass("former employee, left cleanly");
    }
    case "skills": {
      const v = r as Required["skills"];
      if (!known(f.skillsText)) return unknown(unknownText(f.skillsText));
      const m = matchSkills(f.skillsText.value, v.skills);
      const need = v.match === "all" ? v.skills.length : v.match === "at_least" ? v.n ?? 1 : 1;
      return m.length >= need ? pass(m.join(", ")) : fail(m.length ? `only ${m.join(", ")}` : "none of them");
    }
    case "education_stream": return !known(f.stream) ? unknown(unknownText(f.stream)) : (r as Required["education_stream"]).streams.some((s) => f.stream.value!.includes(s.toLowerCase())) ? pass(f.stream.value) : fail(f.stream.value);
    case "education_completed": {
      if (!known(f.educationStatus)) return unknown(unknownText(f.educationStatus));
      const s = f.educationStatus.value;
      return s === "completed" || (s === "pursuing" && (r as Required["education_completed"]).value === "pursuing_ok") ? pass(s) : fail(s);
    }
    case "rejected_other_process": return f.system.rejectedOtherProcess ? fail("rejected in another process") : pass("no rejection elsewhere");
    case "record_age": {
      const src = f.subSource === "naukri_import" ? f.lastActiveAt : f.recordUpdatedAt;
      if (!known(src)) return unknown(unknownText(src));
      const days = Math.floor((now.getTime() - Date.parse(String(src.value).replace(" ", "T"))) / DAY);
      return Number.isFinite(days) && days <= (r as Required["record_age"]).maxDays ? pass(`${days} days old`) : fail(`${days} days old`);
    }
    case "contact_recent": {
      if (!f.lastFirstContactAt) return pass("never contacted");
      const days = Math.floor((now.getTime() - Date.parse(String(f.lastFirstContactAt).replace(" ", "T"))) / DAY);
      return days < (r as Required["contact_recent"]).days ? fail(`contacted ${days} days ago`) : pass(`last contacted ${days} days ago`);
    }
    case "valid_email": return f.email.quality === "ok" ? pass(String(f.email.value)) : f.email.quality === "ambiguous" ? fail("email on record is not valid") : unknown(unknownText(f.email));
    case "sources": {
      const v = r as Required["sources"];
      const tokens = [f.subSource, `${f.subSource}:${f.sourceDetail ?? ""}`, f.sourceKind === "he" ? "he" : f.sourceKind];
      const hit = (t: string) => tokens.some((x) => x.toLowerCase() === t.toLowerCase());
      const label = f.sourceDetail ? `${f.subSource} (${f.sourceDetail})` : f.subSource;
      if (v.exclude.some(hit)) return fail(`source ${label} is excluded`);
      if (v.include.length && !v.include.some(hit)) return fail(`source ${label} is not included`);
      return pass(label);
    }
    default: return unknown("unknown");
  }
}
