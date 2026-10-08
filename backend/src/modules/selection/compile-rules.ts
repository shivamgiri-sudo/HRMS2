// Per-rule "required" values and plain-language required texts for the compiler (pure).
import type { MetaScreeningConfig } from "../job-requisition/job-requisition.types.js";
import type { RuleKey } from "./selection-types.js";

export const EDU_LABEL: Record<number, string> = { 1: "Below 10th", 2: "10th", 3: "12th", 4: "Diploma", 5: "Graduate", 6: "Post Graduate" };

export type CustomRule = NonNullable<MetaScreeningConfig["custom_field_rules"]>[number];
export type LangReq = NonNullable<MetaScreeningConfig["language_requirements"]>[number];

export interface Required {
  age: { min: number | null; max: number | null };
  education_min: { text: string | null; rank: number; soft: boolean };
  experience: { min: number | null; max: number | null };
  night_shift: Record<string, never>;
  rotational_shift: Record<string, never>;
  location_region: { branchName: string; branchCity: string | null; branchState: string | null; relocationOk: boolean };
  location_cities: { cities: string[]; relocationOk: boolean };
  location_radius: { km: number; lat: number | null; lng: number | null };
  gender: { gender: "male" | "female" };
  languages: { langs: LangReq[] };
  certificate: { code: string; level: "declared" | "verified"; verifiedBonus: number };
  english: { level: "basic" | "intermediate" | "advanced" };
  typing: { wpm: number };
  form_answer: { rule: CustomRule };
  notice_period: { maxDays: number };
  salary_fit: { max: number; maxRatio: number; expectationOnly: boolean };
  employer_exclude: { names: string[] };
  employer_include: { names: string[] };
  ex_employee: { value: "allow_clean" | "exclude" };
  skills: { skills: string[]; match: "any" | "all" | "at_least"; n?: number };
  education_stream: { streams: string[] };
  education_completed: { value: "completed" | "pursuing_ok" };
  rejected_other_process: Record<string, never>;
  record_age: { maxDays: number };
  contact_recent: { days: number };
  valid_email: Record<string, never>;
  sources: { include: string[]; exclude: string[] };
  relocation_ok: Record<string, never>;
}

const yrs = (n: number) => `${n} year${n === 1 ? "" : "s"}`;
const list = (a: string[]) => a.join(", ");

export function requiredText(key: RuleKey, r: unknown): string {
  switch (key) {
    case "age": {
      const v = r as Required["age"];
      if (v.min != null && v.max != null) return `${v.min} to ${v.max}`;
      return v.min != null ? `${v.min} or older` : `up to ${v.max}`;
    }
    case "education_min": {
      const v = r as Required["education_min"];
      if (v.rank > 0) return `${EDU_LABEL[v.rank]} or above${v.soft ? " (preferred)" : ""}`;
      return `"${v.text ?? ""}"`;
    }
    case "experience": {
      const v = r as Required["experience"];
      if (v.min != null && v.max != null) return `${v.min} to ${yrs(v.max)}`;
      return v.min != null ? `at least ${yrs(v.min)}` : `up to ${yrs(v.max ?? 0)}`;
    }
    case "night_shift": return "willing to work night shift";
    case "rotational_shift": return "OK with rotational shifts";
    case "location_region": {
      const v = r as Required["location_region"];
      return `lives in the ${v.branchCity ?? v.branchName} area${v.relocationOk ? " or will relocate" : ""}`;
    }
    case "location_cities": {
      const v = r as Required["location_cities"];
      return `lives in ${list(v.cities)}${v.relocationOk ? " or will relocate" : ""}`;
    }
    case "location_radius": return `within ${(r as Required["location_radius"]).km} km of the branch`;
    case "gender": return (r as Required["gender"]).gender;
    case "languages": return (r as Required["languages"]).langs.map((l) => `${l.language} (${l.skills.join("/")})`).join(", ");
    case "certificate": {
      const v = r as Required["certificate"];
      return `${v.code} certificate (${v.level})`;
    }
    case "english": return `${(r as Required["english"]).level} English or better`;
    case "typing": return `${(r as Required["typing"]).wpm} wpm or more`;
    case "form_answer": {
      const v = (r as Required["form_answer"]).rule;
      return v.label || `${v.field} ${v.op} ${v.value}`.trim();
    }
    case "notice_period": return `can join within ${(r as Required["notice_period"]).maxDays} days`;
    case "salary_fit": {
      const v = r as Required["salary_fit"];
      return `${v.expectationOnly ? "stated expectation" : "expects"} up to ${Math.round(v.max * v.maxRatio)} a month`;
    }
    case "employer_exclude": return `not from ${list((r as Required["employer_exclude"]).names)}`;
    case "employer_include": return `from ${list((r as Required["employer_include"]).names)}`;
    case "ex_employee": return (r as Required["ex_employee"]).value === "exclude" ? "not a former employee" : "former employees only if they left cleanly";
    case "skills": {
      const v = r as Required["skills"];
      const how = v.match === "all" ? "all of" : v.match === "at_least" ? `at least ${v.n} of` : "any of";
      return `${how} ${list(v.skills)}`;
    }
    case "education_stream": return `stream: ${list((r as Required["education_stream"]).streams)}`;
    case "education_completed": return (r as Required["education_completed"]).value === "completed" ? "qualification completed" : "completed or pursuing";
    case "rejected_other_process": return "not rejected in another process";
    case "record_age": return `record updated in the last ${(r as Required["record_age"]).maxDays} days`;
    case "contact_recent": return `not contacted in the last ${(r as Required["contact_recent"]).days} days`;
    case "valid_email": return "has a valid email";
    case "sources": {
      const v = r as Required["sources"];
      return [v.include.length ? `only ${list(v.include)}` : "", v.exclude.length ? `not ${list(v.exclude)}` : ""].filter(Boolean).join("; ");
    }
    default: return "";
  }
}

export const splitList = (text: string | null | undefined): string[] =>
  String(text ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
