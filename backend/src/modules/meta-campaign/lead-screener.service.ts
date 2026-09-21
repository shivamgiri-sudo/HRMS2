/**
 * Screens a parsed META lead against its requisition's stated requirements.
 *
 * Design rule: **an unknown value never disqualifies.** If the lead form did not ask for age,
 * or the answer could not be parsed, that gate is skipped rather than failed. The cost of the
 * two error directions is not symmetric — wrongly qualifying a lead costs a recruiter one phone
 * call, wrongly disqualifying one loses a candidate silently and permanently.
 *
 * Screening dimensions (in order):
 *   1. Age band (meta_target_age_min / meta_target_age_max)
 *   2. Education minimum (education_requirement)
 *   3. Experience minimum (experience_min_years)
 *   4. Gender (meta_screening_config.gender)
 *   5. Certifications (meta_screening_config.certifications) — DRA, IRDA, NCFM, etc.
 *   6. Language requirements (meta_screening_config.language_requirements)
 *   7. Minimum typing speed in WPM (meta_screening_config.min_typing_speed_wpm)
 *   8. Written English level (meta_screening_config.written_english_level)
 *   9. Custom field rules (meta_screening_config.custom_field_rules)
 */

import type { MetaScreeningConfig } from '../job-requisition/job-requisition.types.js';

export interface ScreeningInput {
  parsedAge: number | null;
  parsedEducation: string | null;
  parsedExperienceYr: number | null;
  parsedGender: string | null;
  /** Raw form field answers: field_name → answer string (lowercased by caller for comparison) */
  rawFields: Record<string, string>;
}

export interface ScreeningRequirements {
  metaTargetAgeMin: number | null;
  metaTargetAgeMax: number | null;
  educationRequirement: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  screeningConfig: MetaScreeningConfig | null;
}

export interface ScreeningResult {
  qualified: boolean;
  reason: string | null;
  /** Checks that could not be evaluated — surfaced so a recruiter knows what was NOT verified. */
  skipped: string[];
}

// ── Education ladder ──────────────────────────────────────────────────────────────────────────
const EDU_RANK: Record<string, number> = {
  'below 10th': 1, 'under 10th': 1, '8th': 1,
  '10th': 2, sslc: 2, matric: 2,
  '12th': 3, hsc: 3, 'higher secondary': 3, intermediate: 3,
  diploma: 4, iti: 4,
  graduate: 5, bachelor: 5, 'b.a': 5, 'b.com': 5, 'b.sc': 5, 'b.tech': 5, be: 5,
  'post graduate': 6, postgraduate: 6, master: 6, 'm.a': 6, 'm.com': 6,
  'm.sc': 6, mba: 6, 'm.tech': 6,
};
const EDU_KEYS_BY_SPECIFICITY = Object.keys(EDU_RANK).sort((a, b) => b.length - a.length);

export function eduRank(value: string | null): number {
  if (!value) return 0;
  const lower = value.toLowerCase();
  for (const key of EDU_KEYS_BY_SPECIFICITY) {
    if (lower.includes(key)) return EDU_RANK[key] ?? 0;
  }
  return 0;
}

const SOFT_REQUIREMENT = /\b(preferred|preferable|preferrable|desirable|desired|nice to have|not mandatory|optional|any)\b/i;

export function isSoftRequirement(value: string | null): boolean {
  return Boolean(value && SOFT_REQUIREMENT.test(value));
}

// ── Affirmative answer detection ──────────────────────────────────────────────────────────────
// Handles the messy real-world answers META forms produce when free-text is used.
// "Yas", "I m DRA certified", "Yes DRA certificate", etc.
const AFFIRMATIVE = /\b(yes|y|yep|ya|yah|yas|yea|yeah|have|hold|got|possess|certified|done|ok|okay|sure|confirmed|available|willing)\b/i;
const NEGATIVE = /\b(no|nope|nahi|nahin|not|don't have|dont have|non|naan|without|fresher|na|n\/a)\b/i;

function isAffirmative(answer: string): boolean | null {
  const pos = AFFIRMATIVE.test(answer);
  const neg = NEGATIVE.test(answer);
  if (pos && !neg) return true;
  if (neg && !pos) return false;
  return null; // ambiguous — skip rather than disqualify
}

// ── Certification field detection ─────────────────────────────────────────────────────────────
// Maps a certification code to patterns that appear in META form field names.
const CERT_FIELD_PATTERNS: Record<string, RegExp> = {
  DRA:  /dra/i,
  IRDA: /irda|insurance.*certif|certif.*insurance/i,
  NCFM: /ncfm/i,
  NSE:  /nse/i,
  AMFI: /amfi|mutual.*fund.*certif|arn/i,
  NISM: /nism/i,
};

// ── Language field detection ──────────────────────────────────────────────────────────────────
// Maps a skill type to patterns in form field names that capture that skill.
const LANG_SKILL_PATTERNS: Record<string, RegExp> = {
  speak: /speak|spoken|verbal|voice|converse|talk/i,
  read:  /read|reading/i,
  write: /write|writing|written|type/i,
};

function findRawFieldValue(rawFields: Record<string, string>, pattern: RegExp): string | null {
  for (const [key, val] of Object.entries(rawFields)) {
    if (pattern.test(key)) return val;
  }
  return null;
}

// ── Typing speed extraction ───────────────────────────────────────────────────────────────────
function extractWpm(answer: string): number | null {
  // Handles "35 wpm", "35-40", "40+", "40 words per minute", etc.
  const m = answer.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Written English level ─────────────────────────────────────────────────────────────────────
const ENGLISH_RANK: Record<string, number> = { basic: 1, intermediate: 2, advanced: 3, fluent: 3 };

function englishRank(answer: string): number {
  const lower = answer.toLowerCase();
  for (const [key, rank] of Object.entries(ENGLISH_RANK)) {
    if (lower.includes(key)) return rank;
  }
  return 0;
}

// ── Custom rule evaluation ────────────────────────────────────────────────────────────────────
function evaluateCustomRule(
  rule: NonNullable<MetaScreeningConfig['custom_field_rules']>[number],
  rawFields: Record<string, string>
): boolean | null {
  const raw = rawFields[rule.field] ?? rawFields[rule.field.toLowerCase()];
  if (raw === undefined) return null; // field not present — skip

  const val = raw.toLowerCase();
  const expected = rule.value.toLowerCase();

  switch (rule.op) {
    case 'eq':           return val === expected;
    case 'neq':          return val !== expected;
    case 'contains':     return val.includes(expected);
    case 'not_contains': return !val.includes(expected);
    case 'gte': {
      const n = parseFloat(val);
      const e = parseFloat(expected);
      if (Number.isNaN(n) || Number.isNaN(e)) return null;
      return n >= e;
    }
    default: return null;
  }
}

// ── Main screener ─────────────────────────────────────────────────────────────────────────────

export function screenLead(input: ScreeningInput, req: ScreeningRequirements): ScreeningResult {
  const skipped: string[] = [];
  const cfg = req.screeningConfig;

  // ── 1. Age ────────────────────────────────────────────────────────────────────────────────
  const hasAgeBand = req.metaTargetAgeMin !== null || req.metaTargetAgeMax !== null;
  if (!hasAgeBand) {
    skipped.push('age (no target band set)');
  } else if (input.parsedAge === null) {
    skipped.push('age (lead did not provide a parseable age)');
  } else {
    if (req.metaTargetAgeMin !== null && input.parsedAge < req.metaTargetAgeMin) {
      return { qualified: false, reason: `Age ${input.parsedAge} below minimum ${req.metaTargetAgeMin}`, skipped };
    }
    if (req.metaTargetAgeMax !== null && input.parsedAge > req.metaTargetAgeMax) {
      return { qualified: false, reason: `Age ${input.parsedAge} above maximum ${req.metaTargetAgeMax}`, skipped };
    }
  }

  // ── 2. Education ──────────────────────────────────────────────────────────────────────────
  const requiredEdu = eduRank(req.educationRequirement);
  const providedEdu = eduRank(input.parsedEducation);
  if (!req.educationRequirement) {
    skipped.push('education (no requirement set)');
  } else if (isSoftRequirement(req.educationRequirement)) {
    skipped.push(`education ("${req.educationRequirement}" is a preference, not enforced)`);
  } else if (requiredEdu === 0) {
    skipped.push(`education ("${req.educationRequirement}" not on known ladder)`);
  } else if (providedEdu === 0) {
    skipped.push('education (lead answer unrecognised)');
  } else if (providedEdu < requiredEdu) {
    return {
      qualified: false,
      reason: `Education "${input.parsedEducation}" is below required "${req.educationRequirement}"`,
      skipped,
    };
  }

  // ── 3. Experience ─────────────────────────────────────────────────────────────────────────
  if (req.experienceMinYears === null) {
    skipped.push('experience (no minimum set)');
  } else if (input.parsedExperienceYr === null) {
    skipped.push('experience (lead did not provide a parseable value)');
  } else if (input.parsedExperienceYr < req.experienceMinYears) {
    return {
      qualified: false,
      reason: `Experience ${input.parsedExperienceYr} yrs below minimum ${req.experienceMinYears} yrs`,
      skipped,
    };
  }

  if (!cfg) {
    // No advanced config — stop here, qualified on basic gates.
    return { qualified: true, reason: null, skipped };
  }

  // ── 4. Gender ─────────────────────────────────────────────────────────────────────────────
  const requiredGender = cfg.gender ?? 'any';
  if (requiredGender !== 'any') {
    if (!input.parsedGender) {
      skipped.push(`gender (lead did not provide; required: ${requiredGender})`);
    } else {
      const g = input.parsedGender.toLowerCase();
      const isMale   = /male|man|boy|m\b/i.test(g);
      const isFemale = /female|woman|girl|f\b/i.test(g);
      if (requiredGender === 'male'   && !isMale)   return { qualified: false, reason: 'Gender: male required', skipped };
      if (requiredGender === 'female' && !isFemale) return { qualified: false, reason: 'Gender: female required', skipped };
    }
  }

  // ── 5. Certifications ─────────────────────────────────────────────────────────────────────
  for (const cert of (cfg.certifications ?? [])) {
    const pattern = CERT_FIELD_PATTERNS[cert.toUpperCase()];
    if (!pattern) {
      // Cert type not in our known set — fall back to custom_field_rules approach, skip here
      skipped.push(`certification "${cert}" (unknown type, add a custom field rule for it)`);
      continue;
    }
    const answer = findRawFieldValue(input.rawFields, pattern);
    if (answer === null) {
      skipped.push(`certification "${cert}" (form field not found — add the question to the META form)`);
      continue;
    }
    const affirm = isAffirmative(answer);
    if (affirm === false) {
      return {
        qualified: false,
        reason: `${cert} certification required but candidate answered: "${answer}"`,
        skipped,
      };
    }
    if (affirm === null) {
      skipped.push(`certification "${cert}" answer "${answer}" is ambiguous — recruiter should verify`);
    }
    // affirm === true → passes
  }

  // ── 6. Language requirements ──────────────────────────────────────────────────────────────
  for (const lr of (cfg.language_requirements ?? [])) {
    for (const skill of lr.skills) {
      const pattern = LANG_SKILL_PATTERNS[skill];
      if (!pattern) continue;

      // Look for a field whose name mentions both the language and the skill
      const langPattern = new RegExp(lr.language, 'i');
      let answer: string | null = null;

      for (const [key, val] of Object.entries(input.rawFields)) {
        if (langPattern.test(key) && pattern.test(key)) { answer = val; break; }
      }
      if (!answer) {
        // Fallback: field mentioning the skill generally (e.g. "language_speak")
        for (const [key, val] of Object.entries(input.rawFields)) {
          if (pattern.test(key)) {
            // Check if this multi-language answer mentions our required language
            if (langPattern.test(val)) { answer = val; break; }
          }
        }
      }

      if (answer === null) {
        skipped.push(`language "${lr.language}" ${skill} (form field not found)`);
        continue;
      }

      // For multi-value fields (comma-separated checkboxes), check if the language appears
      const langInAnswer = langPattern.test(answer);
      if (!langInAnswer) {
        return {
          qualified: false,
          reason: `${lr.language} (${skill}) required but not in candidate's answer: "${answer}"`,
          skipped,
        };
      }
    }
  }

  // ── 7. Minimum typing speed ───────────────────────────────────────────────────────────────
  if (cfg.min_typing_speed_wpm) {
    const wpmAnswer = findRawFieldValue(input.rawFields, /typing.*speed|wpm|words.*per.*min/i);
    if (!wpmAnswer) {
      skipped.push(`typing speed (form field not found; required: ≥${cfg.min_typing_speed_wpm} WPM)`);
    } else {
      const wpm = extractWpm(wpmAnswer);
      if (wpm === null) {
        skipped.push(`typing speed (could not parse "${wpmAnswer}")`);
      } else if (wpm < cfg.min_typing_speed_wpm) {
        return {
          qualified: false,
          reason: `Typing speed ${wpm} WPM below required ${cfg.min_typing_speed_wpm} WPM`,
          skipped,
        };
      }
    }
  }

  // ── 8. Written English level ──────────────────────────────────────────────────────────────
  if (cfg.written_english_level) {
    const requiredRank = ENGLISH_RANK[cfg.written_english_level] ?? 0;
    const answer = findRawFieldValue(input.rawFields, /written.*english|english.*written|english.*level|english.*proficien/i);
    if (!answer) {
      skipped.push(`written English level (form field not found; required: ${cfg.written_english_level})`);
    } else {
      const rank = englishRank(answer);
      if (rank === 0) {
        skipped.push(`written English level (could not parse "${answer}")`);
      } else if (rank < requiredRank) {
        return {
          qualified: false,
          reason: `Written English "${answer}" below required "${cfg.written_english_level}"`,
          skipped,
        };
      }
    }
  }

  // ── 9. Custom field rules ─────────────────────────────────────────────────────────────────
  for (const rule of (cfg.custom_field_rules ?? [])) {
    const result = evaluateCustomRule(rule, input.rawFields);
    if (result === null) {
      skipped.push(`custom rule "${rule.label ?? rule.field}" (field not present in form)`);
      continue;
    }
    if (!result) {
      return {
        qualified: false,
        reason: `Custom rule failed: ${rule.label ?? rule.field} (expected ${rule.value})`,
        skipped,
      };
    }
  }

  return { qualified: true, reason: null, skipped };
}
