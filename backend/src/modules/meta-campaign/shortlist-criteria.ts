/**
 * Shortlisting criteria supplied by recruitment for the live META campaigns (2026-09-21).
 *
 * Kept as data so the criteria can be previewed against every stored lead before anything is
 * written, and so the exact rules that were agreed are reviewable in one place. Each rule is only
 * enforceable if the campaign's Lead Gen form asks the question; a rule whose field is absent from
 * the form is recorded as "not verified", never as a rejection.
 *
 * Field names are the parser's normalised keys (lowercase, every run of non-alphanumerics -> one
 * underscore), not the raw question text.
 *
 * "Fresher and experienced both" means NO experience gate, so none is set.
 */

import type { MetaScreeningConfig } from '../job-requisition/job-requisition.types.js';

export interface RequisitionCriteria {
  /** Value for job_requisition.education_requirement (matched on the screener's education ladder). */
  education: string | null;
  config: MetaScreeningConfig;
  note: string;
}

const CAN_TRAVEL_NOIDA = {
  field: 'can_travel_noida',
  op: 'neq' as const,
  value: 'no',
  label: 'Can travel to Noida (yes or can relocate)',
};

/** By job_requisition.requisition_code. */
export const REQUISITION_CRITERIA: Record<string, RequisitionCriteria> = {
  'REQ-2609-DZCV': {
    education: '12th pass',
    config: {
      custom_field_rules: [
        CAN_TRAVEL_NOIDA,
        // The education ladder reads "below_12th" as 12th, so exclude it explicitly.
        { field: 'qualification', op: 'neq', value: 'below_12th', label: '12th pass or above' },
      ],
    },
    note: '12th pass or above; can travel to Noida = yes or can relocate; freshers and experienced both.',
  },
  'REQ-2609-K7BK': {
    education: null,
    config: {
      custom_field_rules: [
        { field: 'are_you_a_graduate', op: 'is_yes', value: '', label: 'Graduate (must)' },
        {
          field: 'this_role_includes_night_shifts_are_you_willing_and_able_to_work_night_shifts',
          op: 'is_yes',
          value: '',
          label: 'Willing to work night shifts',
        },
      ],
    },
    note: 'Graduate must; willing to work night shifts = yes.',
  },
  'REQ-2608-6GFX': {
    education: '12th pass',
    config: { custom_field_rules: [CAN_TRAVEL_NOIDA] },
    note: '12th pass or above; can travel to Noida = yes or can relocate (this form does not ask it, so it is recorded as not verified); freshers and experienced both.',
  },
};

export interface CampaignCriteriaDef {
  formId: string;
  campaignName: string;
  config: MetaScreeningConfig;
  note: string;
}

/**
 * Campaigns with no job requisition yet ("JR pending"). auto_notify is off: with no requisition
 * there is no branch, address or interview slot to put in a "you are shortlisted" message.
 * Tughlakabad Telesales (form 2524199738118576) is deliberately absent: its leads stay pending
 * until its requisition is raised.
 */
export const CAMPAIGN_CRITERIA: CampaignCriteriaDef[] = [
  {
    formId: '2856996751366206',
    campaignName: 'AHMEDABAD DRA/Collections (JR pending)',
    config: { certifications: ['DRA'], auto_notify: false },
    note: 'Valid DRA certification = yes.',
  },
];
