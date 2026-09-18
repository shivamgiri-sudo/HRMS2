/**
 * Screens a parsed META lead against its requisition's stated requirements.
 *
 * Design rule that governs every check below: **an unknown value never disqualifies.** If the
 * lead form did not ask for age, or the answer could not be parsed, the age gate is skipped
 * rather than failed. The cost of the two error directions is not symmetric — wrongly qualifying
 * a lead costs a recruiter one phone call, wrongly disqualifying one loses a candidate silently
 * and permanently, with an automated rejection already sent. Likewise a requisition that has not
 * set an age band is not asserting "any age is wrong", it is asserting nothing.
 *
 * Education is the one comparison that needs ordering rather than equality, so it uses a rank
 * ladder. A rank of 0 means "unrecognised on either side", which again skips the check.
 */

export interface ScreeningInput {
  parsedAge: number | null;
  parsedEducation: string | null;
  parsedExperienceYr: number | null;
}

export interface ScreeningRequirements {
  metaTargetAgeMin: number | null;
  metaTargetAgeMax: number | null;
  educationRequirement: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
}

export interface ScreeningResult {
  qualified: boolean;
  reason: string | null;
  /** Checks that could not be evaluated, surfaced so a recruiter knows what was NOT verified. */
  skipped: string[];
}

/**
 * Education ladder, lowest to highest.
 *
 * Ordered longest-key-first at match time so "post graduate" is tested before "graduate" —
 * otherwise a post-graduate answer would match the `graduate` substring and rank one step too low,
 * which would wrongly disqualify the most qualified applicants against a PG requirement.
 */
const EDU_RANK: Record<string, number> = {
  'below 10th': 1,
  'under 10th': 1,
  '8th': 1,
  '10th': 2,
  sslc: 2,
  matric: 2,
  '12th': 3,
  hsc: 3,
  'higher secondary': 3,
  intermediate: 3,
  diploma: 4,
  iti: 4,
  graduate: 5,
  bachelor: 5,
  'b.a': 5,
  'b.com': 5,
  'b.sc': 5,
  'b.tech': 5,
  be: 5,
  'post graduate': 6,
  postgraduate: 6,
  master: 6,
  'm.a': 6,
  'm.com': 6,
  'm.sc': 6,
  mba: 6,
  'm.tech': 6,
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

/**
 * Is this requirement worded as a PREFERENCE rather than a hard bar?
 *
 * education_requirement is free text, and recruiters write things like "Any graduate preferred" or
 * "Graduate desirable". Ranking that as Graduate and rejecting a 12th-pass applicant enforces as a
 * gate something the requisition explicitly called optional — and the applicant gets an automated
 * rejection for it. A soft requirement is treated as not-checked instead, which leaves the lead
 * visible for a recruiter to judge.
 */
const SOFT_REQUIREMENT = /\b(preferred|preferable|preferrable|desirable|desired|nice to have|not mandatory|optional|any)\b/i;

export function isSoftRequirement(value: string | null): boolean {
  return Boolean(value && SOFT_REQUIREMENT.test(value));
}

export function screenLead(input: ScreeningInput, req: ScreeningRequirements): ScreeningResult {
  const skipped: string[] = [];

  // --- Age ---
  const hasAgeBand = req.metaTargetAgeMin !== null || req.metaTargetAgeMax !== null;
  if (!hasAgeBand) {
    skipped.push('age (requisition has no target age band)');
  } else if (input.parsedAge === null) {
    skipped.push('age (lead did not provide a parseable age)');
  } else {
    if (req.metaTargetAgeMin !== null && input.parsedAge < req.metaTargetAgeMin) {
      return {
        qualified: false,
        reason: `Age ${input.parsedAge} is below the required minimum of ${req.metaTargetAgeMin}`,
        skipped,
      };
    }
    if (req.metaTargetAgeMax !== null && input.parsedAge > req.metaTargetAgeMax) {
      return {
        qualified: false,
        reason: `Age ${input.parsedAge} is above the required maximum of ${req.metaTargetAgeMax}`,
        skipped,
      };
    }
  }

  // --- Education ---
  const requiredEdu = eduRank(req.educationRequirement);
  const providedEdu = eduRank(input.parsedEducation);
  if (!req.educationRequirement) {
    skipped.push('education (requisition states no requirement)');
  } else if (isSoftRequirement(req.educationRequirement)) {
    skipped.push(
      `education (requirement "${req.educationRequirement}" is worded as a preference, not a bar, so it is not enforced)`
    );
  } else if (requiredEdu === 0) {
    // The requisition's requirement is free text we cannot rank ("Any graduate preferred").
    // Ranking it as 0 and comparing would pass everyone; saying so is more honest.
    skipped.push(`education (requirement "${req.educationRequirement}" is not on the known ladder)`);
  } else if (providedEdu === 0) {
    skipped.push('education (lead answer not recognised)');
  } else if (providedEdu < requiredEdu) {
    return {
      qualified: false,
      reason: `Education "${input.parsedEducation}" is below the required "${req.educationRequirement}"`,
      skipped,
    };
  }

  // --- Experience ---
  // Only the MINIMUM is enforced. experience_max_years is an advertising preference, not a
  // disqualifier: rejecting an applicant for being too experienced is a decision for a recruiter,
  // not for an automated screen that would send them an instant rejection.
  if (req.experienceMinYears === null) {
    skipped.push('experience (requisition states no minimum)');
  } else if (input.parsedExperienceYr === null) {
    skipped.push('experience (lead did not provide a parseable value)');
  } else if (input.parsedExperienceYr < req.experienceMinYears) {
    return {
      qualified: false,
      reason: `Experience ${input.parsedExperienceYr} years is below the required minimum of ${req.experienceMinYears} years`,
      skipped,
    };
  }

  return { qualified: true, reason: null, skipped };
}
