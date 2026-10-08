import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  buildRequisitionPayload, criteriaReadOnly, educationFromStored, educationToStored, emptyForm, formFromRequisition,
  mergeScreeningConfig, type StoredRequisition,
} from '../requisition/criteriaFormModel';
import RequisitionCriteriaFields from '../requisition/RequisitionCriteriaFields';

const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

const stored: StoredRequisition = {
  designation_name: 'CSE', department_name: null, branch_name: 'NOIDA-2', process_name: 'Onfido', process_id: 'p-1',
  requested_headcount: 10, employment_type: 'full_time', salary_min: null, salary_max: null, priority: 'normal', requisition_type: 'new_position',
  business_justification: null, target_joining_date: null, requisition_validity: null,
  experience_min_years: '1.0', experience_max_years: 3, skills_required: 'Excel', job_description: 'Inbound support for a KYC process',
  education_requirement: 'Graduate', shift_requirement: 'Night 9pm-6am', night_shift_required: 1, rotational_shift: 0,
  meta_screening_config: { auto_notify: false, gender: 'female', x: 'kept', nested: { a: 1 } } as never,
};

describe('edit keeps stored criteria (was blanked)', () => {
  it('loads experience, skills, JD, education and shift from the stored row', () => {
    const f = formFromRequisition(stored);
    expect(f.experience_min_years).toBe('1.0');
    expect(f.experience_max_years).toBe('3');
    expect(f.skills_required).toBe('Excel');
    expect(f.job_description).toBe('Inbound support for a KYC process');
    expect(f.education_level).toBe('Graduate');
    expect(f.education_other).toBe('');
    expect(f.shift_requirement).toBe('Night 9pm-6am');
    expect(f.night_shift_required).toBe(true);
    expect(f.rotational_shift).toBe(false);
  });

  it('an untouched edit sends the stored criteria back unchanged', () => {
    const p = wire(buildRequisitionPayload(formFromRequisition(stored), stored.meta_screening_config));
    expect(p).toMatchObject({
      experience_min_years: 1, experience_max_years: 3, skills_required: 'Excel', job_description: 'Inbound support for a KYC process',
      education_requirement: 'Graduate', shift_requirement: 'Night 9pm-6am', night_shift_required: true, rotational_shift: false,
    });
    expect(p).not.toHaveProperty('education_level');
    expect(p).not.toHaveProperty('education_other');
  });
});

describe('meta_screening_config merge', () => {
  it('an unknown stored key survives a save; form-owned keys follow the form', () => {
    const f = { ...formFromRequisition(stored), meta_screening_gender: 'any' as const, meta_screening_auto_notify: true };
    const p = wire(buildRequisitionPayload(f, stored.meta_screening_config));
    expect(p.meta_screening_config).toEqual({ auto_notify: true, x: 'kept', nested: { a: 1 } });
  });
  it('accepts a JSON string or null as the stored value', () => {
    expect(mergeScreeningConfig('{"x":1,"gender":"male"}', { auto_notify: true })).toEqual({ x: 1, auto_notify: true });
    expect(mergeScreeningConfig(null, { auto_notify: true, gender: undefined })).toEqual({ auto_notify: true });
    expect(mergeScreeningConfig('not json', { auto_notify: false })).toEqual({ auto_notify: false });
  });
});

describe('new draft sends the criteria inputs', () => {
  it('education Graduate and night shift true', () => {
    const p = wire(buildRequisitionPayload({ ...emptyForm, designation_name: 'CSE', branch_name: 'NOIDA-2', education_level: 'Graduate', night_shift_required: true }));
    expect(p.education_requirement).toBe('Graduate');
    expect(p.night_shift_required).toBe(true);
    expect(p.rotational_shift).toBe(false);
    expect(p.shift_requirement).toBeNull();
  });
  it('blank education sends null; Other sends the typed text', () => {
    expect(wire(buildRequisitionPayload({ ...emptyForm })).education_requirement).toBeNull();
    expect(wire(buildRequisitionPayload({ ...emptyForm, education_level: 'other', education_other: '  B.Com (Commerce) ' })).education_requirement).toBe('B.Com (Commerce)');
  });
});

describe('education ladder <-> stored text', () => {
  it.each([
    ['Graduate', 'Graduate', ''], ['graduate', 'Graduate', ''], ['12th', '12th', ''], ['Post Graduate', 'Post Graduate', ''],
    ['B.Com preferred', 'other', 'B.Com preferred'], [null, '', ''], ['', '', ''],
  ])('%s -> level %s', (s, level, other) => {
    expect(educationFromStored(s)).toEqual({ level, other });
  });
  it('round-trips every ladder value', () => {
    for (const l of ['Below 10th', '10th', '12th', 'Diploma', 'Graduate', 'Post Graduate']) expect(educationToStored(l, '')).toBe(l);
  });
});

describe('approved requisitions stay locked in the legacy modal', () => {
  it.each([['draft', false], ['pending_approval', false], ['rejected', false], ['approved', true], ['closed', true]])('%s read-only=%s', (s, ro) => {
    expect(criteriaReadOnly(s)).toBe(ro);
  });
  it('read-only render disables every criteria input and says where to edit', () => {
    const html = renderToStaticMarkup(createElement(RequisitionCriteriaFields, { form: formFromRequisition(stored), onChange: () => {}, readOnly: true }));
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('Edit criteria');
  });
  it('editable render has labelled inputs for every criteria field with 44px targets', () => {
    const html = renderToStaticMarkup(createElement(RequisitionCriteriaFields, { form: { ...emptyForm }, onChange: () => {}, readOnly: false }));
    expect(html).not.toContain('disabled');
    for (const id of ['req-education', 'req-exp-min', 'req-exp-max', 'req-shift', 'req-night-shift', 'req-rotational-shift']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
    expect(html).not.toContain('id="req-education-other"');
    expect(html.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
  it('Other shows the free-text education input', () => {
    const html = renderToStaticMarkup(createElement(RequisitionCriteriaFields, { form: { ...emptyForm, education_level: 'other' }, onChange: () => {}, readOnly: false }));
    expect(html).toContain('id="req-education-other"');
  });
});
