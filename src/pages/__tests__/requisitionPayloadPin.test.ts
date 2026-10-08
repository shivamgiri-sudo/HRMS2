import { describe, expect, it } from 'vitest';
import { buildRequisitionPayload, emptyForm, formFromRequisition, type StoredRequisition } from '../requisition/criteriaFormModel';

// Pins of the requisition modal (NativeJobRequisition) as it behaved before the criteria fix (S1).
// Wire-level: JSON round-trip drops undefined keys exactly like the HTTP body does.
const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

const draftForm = {
  ...emptyForm,
  designation_name: 'Customer Support Executive',
  department_name: 'Operations',
  branch_name: 'NOIDA-2',
  process_name: 'Onfido',
  process_id: 'p-1',
  requested_headcount: 10,
  salary_min: '15000',
  salary_max: '18000',
  business_justification: 'Ramp up',
  training_start_date: '2026-10-20',
  requisition_validity: '2026-10-19',
  meta_target_age_min: '18',
  meta_target_age_max: '35',
  meta_target_locations: 'Noida, Ghaziabad ',
  meta_screening_written_english: 'intermediate' as const,
  meta_screening_custom_rules: [{ field: 'night_shift', op: 'is_yes', value: '', label: 'Night shift' }],
};

const PINNED_NEW_DRAFT_PAYLOAD = {
  designation_name: 'Customer Support Executive',
  department_name: 'Operations',
  branch_name: 'NOIDA-2',
  process_name: 'Onfido',
  process_id: 'p-1',
  requested_headcount: 10,
  employment_type: 'full_time',
  salary_min: 15000,
  salary_max: 18000,
  experience_min_years: null,
  experience_max_years: null,
  priority: 'normal',
  requisition_type: 'new_position',
  business_justification: 'Ramp up',
  skills_required: '',
  job_description: '',
  planned_batch_no: null,
  training_start_date: '2026-10-20',
  target_joining_date: null,
  requisition_validity: '2026-10-19',
  meta_campaign_enabled: true,
  bmi_assessment_url: null,
  meta_target_age_min: 18,
  meta_target_age_max: 35,
  meta_target_locations: ['Noida', 'Ghaziabad'],
  meta_target_radius_km: null,
  ad_required: true,
  meta_screening_config: {
    auto_notify: true,
    written_english_level: 'intermediate',
    custom_field_rules: [{ field: 'night_shift', op: 'is_yes', value: '', label: 'Night shift' }],
  },
};

const storedDraft: StoredRequisition = {
  designation_name: 'Customer Support Executive', department_name: null, branch_name: 'NOIDA-2', process_name: 'Onfido', process_id: 'p-1',
  requested_headcount: 10, employment_type: 'full_time', salary_min: 15000, salary_max: null, priority: 'high', requisition_type: 'replacement',
  business_justification: null, planned_batch_no: 'B-7', training_start_date: '2026-10-20T00:00:00.000Z', target_joining_date: null,
  requisition_validity: '2026-10-19T00:00:00.000Z', bmi_assessment_url: 'https://bmi.example.com/a', meta_target_age_min: 18, meta_target_age_max: null,
  meta_target_locations: ['Noida', 'Ghaziabad'], meta_target_radius_km: 15, ad_required: 1,
  meta_screening_config: { auto_notify: false, gender: 'female', certifications: ['DRA'], min_typing_speed_wpm: 25 },
};

// Every non-criteria field of the edit form; the criteria fields are covered by criteriaFormModel.test.ts.
const PINNED_EDIT_FORM_NON_CRITERIA = {
  designation_name: 'Customer Support Executive', department_name: '', branch_name: 'NOIDA-2', process_name: 'Onfido', process_id: 'p-1',
  requested_headcount: 10, employment_type: 'full_time', salary_min: '15000', salary_max: '', priority: 'high', requisition_type: 'replacement',
  business_justification: '', planned_batch_no: 'B-7', training_start_date: '2026-10-20', target_joining_date: '', requisition_validity: '2026-10-19',
  bmi_assessment_url: 'https://bmi.example.com/a', meta_target_age_min: '18', meta_target_age_max: '', meta_target_locations: 'Noida, Ghaziabad',
  meta_target_radius_km: '15', meta_campaign_enabled: true, meta_screening_auto_notify: false, meta_screening_gender: 'female',
  meta_screening_certifications: ['DRA'], meta_screening_language_requirements: [], meta_screening_min_typing_wpm: '25',
  meta_screening_written_english: '', meta_screening_custom_rules: [],
};

describe('requisition form pin', () => {
  it('new draft payload on the wire', () => {
    expect(wire(buildRequisitionPayload(draftForm))).toEqual(PINNED_NEW_DRAFT_PAYLOAD);
  });

  it('edit form loads every non-criteria field as before', () => {
    const form = formFromRequisition(storedDraft) as Record<string, unknown>;
    for (const [k, v] of Object.entries(PINNED_EDIT_FORM_NON_CRITERIA)) expect([k, form[k]]).toEqual([k, v]);
  });
});
