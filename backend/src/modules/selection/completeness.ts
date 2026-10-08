// Criteria completeness (plan 2026-10-09, Design 4.1 + S-O6). Pure.
// Weights come from the catalogue (sum 100). The certificate item (4) counts only when the requisition's template asks for a
// certificate; then the total is 104 and the score is rescaled to 100.
import { RULE_CATALOGUE } from "./rule-catalogue.js";
import { TEMPLATE_ASKS_CERTIFICATE } from "./templates.js";
import type { CompiledCriteria, Completeness, RuleKey } from "./selection-types.js";

export const CERTIFICATE_WEIGHT = 4;
/** Keys that carry completeness weight (certificate included for templates that ask for it). */
export const WEIGHTED_DECIDABLE: RuleKey[] = [...RULE_CATALOGUE.filter((e) => e.completenessWeight > 0).map((e) => e.key), "certificate"];
/** S-O6: enrolment needs location, education, shift and age decided (a value or an explicit "No requirement"). */
export const ENROLMENT_KEYS: RuleKey[] = ["location_cities", "education_min", "night_shift", "age"];

export function completeness(c: Pick<CompiledCriteria, "decided" | "templateId">): Completeness {
  const decided = new Set(c.decided);
  const asksCert = !!c.templateId && TEMPLATE_ASKS_CERTIFICATE.has(c.templateId);
  const weights = new Map<RuleKey, number>(RULE_CATALOGUE.filter((e) => e.completenessWeight > 0).map((e) => [e.key, e.completenessWeight]));
  if (asksCert) weights.set("certificate", CERTIFICATE_WEIGHT);
  let total = 0, got = 0;
  const missing: RuleKey[] = [];
  for (const [k, w] of weights) {
    total += w;
    if (decided.has(k)) got += w; else missing.push(k);
  }
  const score = total === 100 ? got : Math.round((got / total) * 100);
  const enrolmentReady = ENROLMENT_KEYS.every((k) => decided.has(k));
  const label = score >= 80 && enrolmentReady ? "complete" : score >= 40 ? "partial" : "incomplete";
  return { score, label, missing, enrolmentReady };
}
