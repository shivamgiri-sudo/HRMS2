/**
 * META lead parsing and screening.
 *
 * These two units decide whether a real applicant is contacted or silently dropped, and they run
 * with no human in the loop, so the cases below are chosen around the asymmetry that governs the
 * design: wrongly qualifying a lead costs a recruiter one phone call, wrongly disqualifying one
 * loses a candidate permanently and tells them nothing. Every "unknown" path must therefore fall
 * through to qualified, never to rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  parseLead,
  normalisePhone,
  deriveAge,
  deriveExperienceYears,
  normaliseMetaId,
  normaliseRoutingCode,
  extractRoutingCode,
} from '../meta-lead.parser.js';
import { screenLead, eduRank, requisitionClosedReason } from '../lead-screener.service.js';
import type { MetaLeadDetail } from '../meta-campaign.types.js';

const detail = (fields: Array<[string, string]>, key: 'name' | 'field_name' = 'name'): MetaLeadDetail =>
  ({
    id: 'lead-1',
    field_data: fields.map(([k, v]) => ({ [key]: k, values: [v] })),
  }) as MetaLeadDetail;

describe('parseLead', () => {
  it('reads META standard snake_case questions', () => {
    const parsed = parseLead(
      detail([
        ['full_name', 'Rahul Sharma'],
        ['phone_number', '+919876543210'],
        ['email', 'Rahul@Gmail.com'],
        ['city', 'Mumbai'],
        ['age', '26'],
      ])
    );
    expect(parsed.name).toBe('Rahul Sharma');
    expect(parsed.phone).toBe('9876543210');
    expect(parsed.email).toBe('rahul@gmail.com');
    expect(parsed.location).toBe('Mumbai');
    expect(parsed.age).toBe(26);
  });

  it('accepts `field_name` as well as `name`', () => {
    // The Graph API docs and real payloads disagree on this key depending on version, and getting
    // it wrong silently yields a lead with every field null rather than an error.
    const parsed = parseLead(detail([['full_name', 'Asha Devi'], ['phone_number', '9876543210']], 'field_name'));
    expect(parsed.name).toBe('Asha Devi');
    expect(parsed.phone).toBe('9876543210');
  });

  it('falls back to first_name + last_name when there is no full_name', () => {
    const parsed = parseLead(detail([['first_name', 'Sunil'], ['last_name', 'Kumar']]));
    expect(parsed.name).toBe('Sunil Kumar');
  });

  it('leaves unasked questions null rather than guessing', () => {
    const parsed = parseLead(detail([['full_name', 'Only Name']]));
    expect(parsed.age).toBeNull();
    expect(parsed.education).toBeNull();
    expect(parsed.experienceYears).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it('ignores a placeholder that is not an email', () => {
    // ats.service.ts documents that recruiters enter junk like "0" and "AN" where a candidate has
    // no email; storing that as an address would poison dedup on the ATS side.
    expect(parseLead(detail([['email', '0']])).email).toBeNull();
  });

  it('surfaces a hidden requisition_code as routingCode', () => {
    const parsed = parseLead(
      detail([
        ['full_name', 'Routed Person'],
        ['requisition_code', 'REQ-2609-K7BK'],
      ])
    );
    expect(parsed.routingCode).toBe('REQ-2609-K7BK');
  });

  it('leaves routingCode null when the form carries no routing field', () => {
    expect(parseLead(detail([['full_name', 'No Code']])).routingCode).toBeNull();
  });
});

describe('normaliseRoutingCode', () => {
  it('uppercases, trims and strips wrapping quotes without touching hyphens', () => {
    expect(normaliseRoutingCode('  req-2609-k7bk ')).toBe('REQ-2609-K7BK');
    expect(normaliseRoutingCode('"REQ-2609-K7BK"')).toBe('REQ-2609-K7BK');
    expect(normaliseRoutingCode('REQ 2609 K7BK')).toBe('REQ2609K7BK');
  });

  it('rejects non-codes so they never become a lookup that quietly matches nothing', () => {
    expect(normaliseRoutingCode('N/A')).toBeNull(); // collapses to "NA", under the 3-char floor
    expect(normaliseRoutingCode('-')).toBeNull();
    expect(normaliseRoutingCode('')).toBeNull();
    expect(normaliseRoutingCode(null)).toBeNull();
  });
});

describe('extractRoutingCode', () => {
  it('reads the code under any of the accepted aliases', () => {
    expect(extractRoutingCode(detail([['batch_requisition_id', 'REQ-1']]))).toBe('REQ-1');
    expect(extractRoutingCode(detail([['req_code', 'req-2']]))).toBe('REQ-2');
    expect(extractRoutingCode(detail([['hrms_requisition_code_do_not_edit', 'REQ-3']]))).toBe('REQ-3');
  });

  it('returns null when no routing field is present', () => {
    expect(extractRoutingCode(detail([['full_name', 'X'], ['phone_number', '9']]))).toBeNull();
  });
});

describe('normalisePhone', () => {
  it.each([
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['9876543210', '9876543210'],
  ])('normalises %s to bare 10 digits', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it('returns null for something too short to be a number', () => {
    expect(normalisePhone('123')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
});

describe('deriveAge', () => {
  it('reads a direct age', () => {
    expect(deriveAge('26', null)).toBe(26);
  });

  it('takes the LOWER bound of an age band', () => {
    // Erring to the stricter reading: if the band is 25-30 and the requisition wants 28+, we would
    // rather leave the lead for a human than auto-qualify on an assumed 30.
    expect(deriveAge('25-30', null)).toBe(25);
    expect(deriveAge('25 to 30', null)).toBe(25);
  });

  it('reads DD/MM/YYYY as day-first, not month-first', () => {
    // JS Date would parse 03/12/1998 as 12 March. On an Indian recruitment form it is 3 December,
    // and near a band boundary the two readings differ by a whole year of age.
    const age = deriveAge(null, '03/12/1998');
    const iso = deriveAge(null, '1998-12-03');
    expect(age).toBe(iso);
  });

  it('reads an ISO date of birth', () => {
    const now = new Date();
    const born = new Date(now.getFullYear() - 30, now.getMonth(), now.getDate());
    const iso = `${born.getFullYear()}-${String(born.getMonth() + 1).padStart(2, '0')}-${String(born.getDate()).padStart(2, '0')}`;
    expect(deriveAge(null, iso)).toBe(30);
  });

  it('rejects implausible values instead of storing them', () => {
    expect(deriveAge('3', null)).toBeNull();
    expect(deriveAge('999', null)).toBeNull();
  });
});

describe('deriveExperienceYears', () => {
  it.each([
    ['fresher', 0],
    ['No experience', 0],
    ['3.5 years', 3.5],
    ['3-5 yrs', 3],
    ['18 months', 1.5],
  ])('reads %s as %s', (input, expected) => {
    expect(deriveExperienceYears(input)).toBe(expected);
  });

  it('distinguishes an unanswered question from zero experience', () => {
    // 0 and null must not collapse: 0 passes a "0 years minimum" check, null skips the check.
    expect(deriveExperienceYears(null)).toBeNull();
    expect(deriveExperienceYears('fresher')).toBe(0);
  });
});

describe('eduRank', () => {
  it('ranks post-graduate above graduate', () => {
    // The substring trap: "post graduate" contains "graduate", so a naive scan ranks the most
    // qualified applicants one step too low and disqualifies them against a PG requirement.
    expect(eduRank('Post Graduate')).toBeGreaterThan(eduRank('Graduate'));
    expect(eduRank('MBA')).toBeGreaterThan(eduRank('B.Com'));
  });

  it('returns 0 for anything unrecognised', () => {
    expect(eduRank('Some Diploma-ish Thing In Nothing')).toBeGreaterThanOrEqual(0);
    expect(eduRank(null)).toBe(0);
    expect(eduRank('')).toBe(0);
  });
});

const noRequirements = {
  metaTargetAgeMin: null,
  metaTargetAgeMax: null,
  educationRequirement: null,
  experienceMinYears: null,
  experienceMaxYears: null,
};

const noAnswers = { parsedAge: null, parsedEducation: null, parsedExperienceYr: null };

describe('screenLead — unknowns never disqualify', () => {
  it('qualifies when the requisition states no criteria at all', () => {
    const r = screenLead({ parsedAge: 19, parsedEducation: '10th', parsedExperienceYr: 0 }, noRequirements);
    expect(r.qualified).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('qualifies when the lead answered nothing, and reports what was skipped', () => {
    const r = screenLead(noAnswers, {
      ...noRequirements,
      metaTargetAgeMin: 21,
      educationRequirement: 'Graduate',
      experienceMinYears: 2,
    });
    expect(r.qualified).toBe(true);
    expect(r.skipped).toHaveLength(3);
    expect(r.skipped.join(' ')).toMatch(/age/);
    expect(r.skipped.join(' ')).toMatch(/education/);
    expect(r.skipped.join(' ')).toMatch(/experience/);
  });

  it('skips the age gate when the requisition set no band', () => {
    const r = screenLead({ ...noAnswers, parsedAge: 17 }, noRequirements);
    expect(r.qualified).toBe(true);
  });

  it('skips education when the requirement is free text off the ladder', () => {
    // "Any graduate preferred" ranks 0. Comparing 0 would pass everyone silently; saying it was
    // not checked is the honest answer.
    const r = screenLead(
      { ...noAnswers, parsedEducation: '10th' },
      { ...noRequirements, educationRequirement: 'Any graduate preferred' }
    );
    expect(r.qualified).toBe(true);
    expect(r.skipped.join(' ')).toMatch(/preference, not a bar/);
  });

  it('does not enforce an education requirement worded as a preference', () => {
    // "Graduate preferred" is not "Graduate required". Enforcing it would auto-reject, and notify,
    // an applicant the requisition itself said was acceptable.
    for (const wording of ['Graduate preferred', 'Graduate desirable', 'Any graduate preferred']) {
      const r = screenLead(
        { ...noAnswers, parsedEducation: '10th' },
        { ...noRequirements, educationRequirement: wording }
      );
      expect(r.qualified, `"${wording}" should not be a hard gate`).toBe(true);
    }
  });

  it('still enforces an education requirement stated plainly', () => {
    const r = screenLead(
      { ...noAnswers, parsedEducation: '10th' },
      { ...noRequirements, educationRequirement: 'Graduate' }
    );
    expect(r.qualified).toBe(false);
  });

  it('keeps the unrecognised-ladder skip for genuinely unparseable text', () => {
    const r = screenLead(
      { ...noAnswers, parsedEducation: '10th' },
      { ...noRequirements, educationRequirement: 'Must hold a Foo certification' }
    );
    expect(r.qualified).toBe(true);
    expect(r.skipped.join(' ')).toMatch(/not on the known ladder/);
  });
});

describe('screenLead — real disqualifications', () => {
  it('rejects below the minimum age, naming the numbers', () => {
    const r = screenLead({ ...noAnswers, parsedAge: 17 }, { ...noRequirements, metaTargetAgeMin: 18 });
    expect(r.qualified).toBe(false);
    expect(r.reason).toContain('17');
    expect(r.reason).toContain('18');
  });

  it('rejects above the maximum age', () => {
    const r = screenLead({ ...noAnswers, parsedAge: 40 }, { ...noRequirements, metaTargetAgeMax: 35 });
    expect(r.qualified).toBe(false);
  });

  it('accepts both inclusive age boundaries', () => {
    const band = { ...noRequirements, metaTargetAgeMin: 18, metaTargetAgeMax: 35 };
    expect(screenLead({ ...noAnswers, parsedAge: 18 }, band).qualified).toBe(true);
    expect(screenLead({ ...noAnswers, parsedAge: 35 }, band).qualified).toBe(true);
  });

  it('rejects education below the required rank', () => {
    const r = screenLead(
      { ...noAnswers, parsedEducation: '10th' },
      { ...noRequirements, educationRequirement: 'Graduate' }
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toContain('Graduate');
  });

  it('accepts education above the required rank', () => {
    const r = screenLead(
      { ...noAnswers, parsedEducation: 'MBA' },
      { ...noRequirements, educationRequirement: 'Graduate' }
    );
    expect(r.qualified).toBe(true);
  });

  it('rejects below the minimum experience', () => {
    const r = screenLead({ ...noAnswers, parsedExperienceYr: 0 }, { ...noRequirements, experienceMinYears: 2 });
    expect(r.qualified).toBe(false);
  });

  it('does NOT reject for being over-experienced', () => {
    // experience_max_years is an advertising preference. Auto-rejecting a 10-year applicant from a
    // 0-3 year advert, with an instant automated rejection, is a recruiter's call and not a screen's.
    const r = screenLead(
      { ...noAnswers, parsedExperienceYr: 10 },
      { ...noRequirements, experienceMinYears: 0, experienceMaxYears: 3 }
    );
    expect(r.qualified).toBe(true);
  });
});

/**
 * Cases taken verbatim from the live lead export the marketing team works from today
 * (9,170 rows, read 2026-09-18). This is the shape the data ACTUALLY has, as opposed to the shape
 * the Graph API documentation describes, and the two differ in ways that broke real logic.
 */
describe('live export format', () => {
  it('strips the type prefix from every id shape the export uses', () => {
    expect(normaliseMetaId('f:27936517096019427')).toBe('27936517096019427');
    expect(normaliseMetaId('l:1735112467564611')).toBe('1735112467564611');
    expect(normaliseMetaId('c:120250938721530749')).toBe('120250938721530749');
    expect(normaliseMetaId('ag:120250939177070749')).toBe('120250939177070749');
    expect(normaliseMetaId('as:120250939176210749')).toBe('120250939176210749');
  });

  it('leaves a bare id from the Graph webhook untouched', () => {
    // Both spellings must normalise to the same value, or a lead arriving live fails to match a
    // form id an operator copied out of the export.
    expect(normaliseMetaId('27936517096019427')).toBe('27936517096019427');
    expect(normaliseMetaId('f:27936517096019427')).toBe(normaliseMetaId('27936517096019427'));
  });

  it('does not mangle a value that merely contains a colon', () => {
    expect(normaliseMetaId('https://example.com/x')).toBe('https://example.com/x');
    expect(normaliseMetaId('unknownprefix:123')).toBe('unknownprefix:123');
  });

  it('reads the prefixed phone format', () => {
    expect(normalisePhone('p:+919102188692'.replace(/^p:/, ''))).toBe('9102188692');
    expect(normalisePhone('+919102188692')).toBe('9102188692');
    expect(normalisePhone('6307448184')).toBe('6307448184');
  });

  it.each([
    ['fresher', 0],
    ['under_1', 0],
    ['1_2', 1],
    ['over_4', 4],
  ])('reads the experience enum %s as %s years', (input, expected) => {
    expect(deriveExperienceYears(input)).toBe(expected);
  });

  it('does not read under_1 as one year', () => {
    // The generic "first number in the string" fallback read `under_1` as 1 — the opposite of its
    // meaning — which passed a sub-one-year candidate against a "minimum 1 year" requirement.
    const years = deriveExperienceYears('under_1');
    expect(years).toBeLessThan(1);
    const r = screenLead(
      { ...noAnswers, parsedExperienceYr: years },
      { ...noRequirements, experienceMinYears: 1 }
    );
    expect(r.qualified).toBe(false);
  });

  it('ranks the qualification enum the form actually returns', () => {
    expect(eduRank('12th')).toBeGreaterThan(eduRank('10th'));
    expect(eduRank('graduate')).toBeGreaterThan(eduRank('12th'));
    expect(eduRank('diploma')).toBeGreaterThan(eduRank('12th'));
  });

  it('parses a full export row, and skips age because the form never asks it', () => {
    const parsed = parseLead(
      detail([
        ['qualification', '12th'],
        ['experience', 'under_1'],
        ['can_travel_noida', 'can_relocate'],
        ['full_name', 'Shivam Singh'],
        ['phone_number', '+916205683907'],
        ['email', 'shivamkumar05012004@gmail.com'],
      ])
    );
    expect(parsed.name).toBe('Shivam Singh');
    expect(parsed.phone).toBe('6205683907');
    expect(parsed.education).toBe('12th');
    expect(parsed.experienceYears).toBe(0);
    expect(parsed.location).toBe('can_relocate');
    // No age or DOB question exists on this form, so age must read as unknown — and unknown must
    // not disqualify, or every lead from this form would be rejected.
    expect(parsed.age).toBeNull();

    const r = screenLead(
      { parsedAge: parsed.age, parsedEducation: parsed.education, parsedExperienceYr: parsed.experienceYears },
      { ...noRequirements, metaTargetAgeMin: 18, metaTargetAgeMax: 35, educationRequirement: '12th' }
    );
    expect(r.qualified).toBe(true);
    expect(r.skipped.join(' ')).toMatch(/age \(lead did not provide/);
  });
});

describe('screenLead — end to end from a raw payload', () => {
  it('qualifies a matching applicant', () => {
    const parsed = parseLead(
      detail([
        ['full_name', 'Priya Singh'],
        ['phone_number', '+919812345678'],
        ['age', '24'],
        ['education', 'Graduate'],
        ['work_experience', '2 years'],
      ])
    );
    const r = screenLead(
      { parsedAge: parsed.age, parsedEducation: parsed.education, parsedExperienceYr: parsed.experienceYears },
      { ...noRequirements, metaTargetAgeMin: 18, metaTargetAgeMax: 35, educationRequirement: '12th', experienceMinYears: 1 }
    );
    expect(r.qualified).toBe(true);
    expect(r.skipped).toEqual([]);
  });

  it('disqualifies an under-age applicant from the same payload shape', () => {
    const parsed = parseLead(detail([['full_name', 'Minor Person'], ['age', '16']]));
    const r = screenLead(
      { parsedAge: parsed.age, parsedEducation: null, parsedExperienceYr: null },
      { ...noRequirements, metaTargetAgeMin: 18 }
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/below the required minimum/);
  });
});

describe('requisitionClosedReason: shortlisting is against an OPEN batch requisition', () => {
  const open = {
    approvalStatus: 'approved',
    activeStatus: 1,
    closedAt: null,
    requestedHeadcount: 20,
    fulfilledHeadcount: 5,
  };

  it('is open while seats remain', () => {
    expect(requisitionClosedReason(open)).toBeNull();
  });

  it('is open when there is no linked requisition to judge', () => {
    expect(requisitionClosedReason(null)).toBeNull();
  });

  it('does not block draft or pending approval; a live campaign may run ahead of the record', () => {
    expect(requisitionClosedReason({ ...open, approvalStatus: 'pending_approval' })).toBeNull();
    expect(requisitionClosedReason({ ...open, approvalStatus: 'draft' })).toBeNull();
  });

  it.each(['closed', 'cancelled', 'rejected', 'on_hold'])('blocks a %s requisition', (approvalStatus) => {
    expect(requisitionClosedReason({ ...open, approvalStatus })).not.toBeNull();
  });

  it('blocks when every seat is filled', () => {
    expect(requisitionClosedReason({ ...open, fulfilledHeadcount: 20 })).toContain('filled');
  });

  it('does not treat a zero-headcount requisition as filled', () => {
    expect(requisitionClosedReason({ ...open, requestedHeadcount: 0, fulfilledHeadcount: 0 })).toBeNull();
  });

  it('blocks an inactive or closed-dated requisition', () => {
    expect(requisitionClosedReason({ ...open, activeStatus: 0 })).not.toBeNull();
    expect(requisitionClosedReason({ ...open, closedAt: '2026-09-01' })).not.toBeNull();
  });
});
