// Pure form <-> payload mapping for the requisition create/edit modal (NativeJobRequisition).
// Kept out of the page so the save payload and the edit-load behaviour can be pinned in node tests.

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'trainee';
export type RequisitionPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface MetaScreeningConfig {
  auto_notify?: boolean;
  gender?: 'any' | 'male' | 'female';
  certifications?: string[];
  language_requirements?: Array<{ language: string; skills: Array<'speak' | 'read' | 'write'> }>;
  min_typing_speed_wpm?: number | null;
  written_english_level?: 'basic' | 'intermediate' | 'advanced' | null;
  custom_field_rules?: Array<{ field: string; op: string; value: string; label?: string }>;
}

export const emptyForm = {
  designation_name: '',
  department_name: '',
  branch_name: '',
  process_name: '',
  process_id: '',
  requested_headcount: 1,
  employment_type: 'full_time' as EmploymentType,
  salary_min: '',
  salary_max: '',
  experience_min_years: '',
  experience_max_years: '',
  priority: 'normal' as RequisitionPriority,
  requisition_type: 'new_position',
  business_justification: '',
  skills_required: '',
  job_description: '',
  // Selection criteria (S1). education_level is a ladder label, '' (no requirement given) or 'other'
  // (free text in education_other); both collapse into the education_requirement column on save.
  education_level: '',
  education_other: '',
  shift_requirement: '',
  night_shift_required: false,
  rotational_shift: false,
  planned_batch_no: '',
  training_start_date: '',
  target_joining_date: '',
  requisition_validity: '',
  // META campaign targeting (migration 1810). These are read by the campaign brief email sent to
  // marketing on approval, and the age band is also what lead-screener.service.ts screens incoming
  // Lead Gen leads against — so leaving the band blank means age is not screened at all, not that
  // every age is rejected.
  meta_campaign_enabled: true,   // saved as ad_required; if false, META fields are hidden and the marketing brief says NO AD NEEDED
  bmi_assessment_url: '',
  meta_target_age_min: '',
  meta_target_age_max: '',
  meta_target_locations: '',
  meta_target_radius_km: '',
  // META screening config (migration 1829)
  meta_screening_auto_notify: true,
  meta_screening_gender: 'any' as 'any' | 'male' | 'female',
  meta_screening_certifications: [] as string[],
  meta_screening_language_requirements: [] as Array<{ language: string; skills: string[] }>,
  meta_screening_min_typing_wpm: '',
  meta_screening_written_english: '' as '' | 'basic' | 'intermediate' | 'advanced',
  meta_screening_custom_rules: [] as Array<{ field: string; op: string; value: string; label: string }>,
};

export type RequisitionForm = typeof emptyForm;

/** The stored requisition fields the edit modal reads (a subset of the list row, `jr.*`). */
export interface StoredRequisition {
  designation_name: string;
  department_name: string | null;
  branch_name: string;
  process_name: string | null;
  process_id?: string | null;
  requested_headcount: number;
  employment_type: EmploymentType;
  salary_min: number | null;
  salary_max: number | null;
  priority: RequisitionPriority;
  requisition_type: string;
  business_justification: string | null;
  planned_batch_no?: string | null;
  training_start_date?: string | null;
  target_joining_date: string | null;
  requisition_validity: string | null;
  bmi_assessment_url?: string | null;
  meta_target_age_min?: number | null;
  meta_target_age_max?: number | null;
  meta_target_locations?: string[] | null;
  meta_target_radius_km?: number | null;
  ad_required?: number | boolean | null;
  meta_screening_config?: MetaScreeningConfig | null;
  // Criteria columns; DECIMAL arrives as a string from mysql2, TINYINT as 0/1.
  experience_min_years?: number | string | null;
  experience_max_years?: number | string | null;
  education_requirement?: string | null;
  skills_required?: string | null;
  job_description?: string | null;
  shift_requirement?: string | null;
  night_shift_required?: number | boolean | null;
  rotational_shift?: number | boolean | null;
}

// Labels match the keys lead-screener eduRank reads, so a stored label ranks exactly as picked.
export const EDUCATION_LADDER = ['Below 10th', '10th', '12th', 'Diploma', 'Graduate', 'Post Graduate'] as const;

export function educationFromStored(stored: string | null | undefined): { level: string; other: string } {
  const text = (stored ?? '').trim();
  if (!text) return { level: '', other: '' };
  const hit = EDUCATION_LADDER.find((l) => l.toLowerCase() === text.toLowerCase());
  return hit ? { level: hit, other: '' } : { level: 'other', other: text };
}

export function educationToStored(level: string, other: string): string | null {
  if (level === 'other') return other.trim() || null;
  return level || null;
}

// The keys the modal edits. Anything else in the stored object belongs to another writer and is kept.
const FORM_OWNED_SCREENING_KEYS = [
  'auto_notify', 'gender', 'certifications', 'language_requirements', 'min_typing_speed_wpm', 'written_english_level', 'custom_field_rules',
] as const;

export function mergeScreeningConfig(stored: unknown, edited: Record<string, unknown>): Record<string, unknown> {
  let base: unknown = stored;
  if (typeof base === 'string') {
    try { base = JSON.parse(base); } catch { base = null; }
  }
  const out: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};
  for (const k of FORM_OWNED_SCREENING_KEYS) delete out[k];
  for (const [k, v] of Object.entries(edited)) if (v !== undefined) out[k] = v;
  return out;
}

/** The legacy modal never changes the criteria of an approved or closed requisition (the backend 409s it too). */
export function criteriaReadOnly(approvalStatus: string): boolean {
  return approvalStatus === 'approved' || approvalStatus === 'closed';
}

export function buildRequisitionPayload(formData: RequisitionForm, storedScreeningConfig: unknown = null) {
  return {
    ...formData,
    salary_min: formData.salary_min ? Number(formData.salary_min) : null,
    salary_max: formData.salary_max ? Number(formData.salary_max) : null,
    experience_min_years: formData.experience_min_years ? Number(formData.experience_min_years) : null,
    experience_max_years: formData.experience_max_years ? Number(formData.experience_max_years) : null,
    planned_batch_no: formData.planned_batch_no || null,
    training_start_date: formData.training_start_date || null,
    target_joining_date: formData.target_joining_date || null,
    requisition_validity: formData.requisition_validity || null,
    process_id: formData.process_id || null,
    // META campaign targeting. Locations are sent as a real array — the column is JSON, and
    // the backend stringifies it; sending the raw comma string would store a JSON string
    // rather than a JSON array and every reader that expects to iterate it would get characters.
    ad_required: formData.meta_campaign_enabled,
    bmi_assessment_url: formData.bmi_assessment_url || null,
    meta_target_age_min: formData.meta_target_age_min ? Number(formData.meta_target_age_min) : null,
    meta_target_age_max: formData.meta_target_age_max ? Number(formData.meta_target_age_max) : null,
    meta_target_locations: formData.meta_target_locations
      ? formData.meta_target_locations.split(',').map((s) => s.trim()).filter(Boolean)
      : null,
    meta_target_radius_km: formData.meta_target_radius_km ? Number(formData.meta_target_radius_km) : null,
    education_requirement: educationToStored(formData.education_level, formData.education_other),
    shift_requirement: formData.shift_requirement.trim() || null,
    night_shift_required: formData.night_shift_required,
    rotational_shift: formData.rotational_shift,
    education_level: undefined,
    education_other: undefined,
    // META screening config — the form's keys merged over the stored object
    meta_screening_config: mergeScreeningConfig(storedScreeningConfig, {
      auto_notify: formData.meta_screening_auto_notify,
      gender: formData.meta_screening_gender !== 'any' ? formData.meta_screening_gender : undefined,
      certifications: formData.meta_screening_certifications.length > 0 ? formData.meta_screening_certifications : undefined,
      language_requirements: formData.meta_screening_language_requirements.length > 0
        ? formData.meta_screening_language_requirements
        : undefined,
      min_typing_speed_wpm: formData.meta_screening_min_typing_wpm ? Number(formData.meta_screening_min_typing_wpm) : undefined,
      written_english_level: formData.meta_screening_written_english || undefined,
      custom_field_rules: formData.meta_screening_custom_rules.length > 0
        ? formData.meta_screening_custom_rules
        : undefined,
    }),
    // Strip UI-only keys from payload spread
    meta_screening_auto_notify: undefined,
    meta_screening_gender: undefined,
    meta_screening_certifications: undefined,
    meta_screening_language_requirements: undefined,
    meta_screening_min_typing_wpm: undefined,
    meta_screening_written_english: undefined,
    meta_screening_custom_rules: undefined,
  };
}

export function formFromRequisition(req: StoredRequisition): RequisitionForm {
  return {
    designation_name: req.designation_name,
    department_name: req.department_name || '',
    branch_name: req.branch_name,
    process_name: req.process_name || '',
    process_id: req.process_id || '',
    requested_headcount: req.requested_headcount,
    employment_type: req.employment_type,
    salary_min: req.salary_min?.toString() || '',
    salary_max: req.salary_max?.toString() || '',
    experience_min_years: req.experience_min_years != null ? String(req.experience_min_years) : '',
    experience_max_years: req.experience_max_years != null ? String(req.experience_max_years) : '',
    priority: req.priority,
    requisition_type: req.requisition_type,
    business_justification: req.business_justification || '',
    skills_required: req.skills_required || '',
    job_description: req.job_description || '',
    education_level: educationFromStored(req.education_requirement).level,
    education_other: educationFromStored(req.education_requirement).other,
    shift_requirement: req.shift_requirement || '',
    night_shift_required: Number(req.night_shift_required ?? 0) === 1,
    rotational_shift: Number(req.rotational_shift ?? 0) === 1,
    planned_batch_no: req.planned_batch_no || '',
    training_start_date: req.training_start_date ? req.training_start_date.substring(0, 10) : '',
    target_joining_date: req.target_joining_date ? req.target_joining_date.substring(0, 10) : '',
    requisition_validity: req.requisition_validity ? req.requisition_validity.substring(0, 10) : '',
    bmi_assessment_url: req.bmi_assessment_url || '',
    meta_target_age_min: req.meta_target_age_min?.toString() || '',
    meta_target_age_max: req.meta_target_age_max?.toString() || '',
    meta_target_locations: Array.isArray(req.meta_target_locations) ? req.meta_target_locations.join(', ') : '',
    meta_target_radius_km: req.meta_target_radius_km?.toString() || '',
    meta_campaign_enabled: req.ad_required != null ? Number(req.ad_required) !== 0 : !!(req.meta_target_age_min || req.meta_target_age_max || req.bmi_assessment_url || req.meta_screening_config),
    meta_screening_auto_notify: req.meta_screening_config?.auto_notify !== false,
    meta_screening_gender: (req.meta_screening_config?.gender as 'any' | 'male' | 'female') || 'any',
    meta_screening_certifications: req.meta_screening_config?.certifications ?? [],
    meta_screening_language_requirements: (req.meta_screening_config?.language_requirements ?? []).map(lr => ({
      language: lr.language,
      skills: lr.skills as string[],
    })),
    meta_screening_min_typing_wpm: req.meta_screening_config?.min_typing_speed_wpm?.toString() || '',
    meta_screening_written_english: (req.meta_screening_config?.written_english_level as '' | 'basic' | 'intermediate' | 'advanced') || '',
    meta_screening_custom_rules: (req.meta_screening_config?.custom_field_rules ?? []).map(r => ({
      field: r.field, op: r.op, value: r.value, label: r.label || '',
    })),
  };
}
