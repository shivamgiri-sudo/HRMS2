import { ListChecks, Lock } from 'lucide-react';
import { EDUCATION_LADDER, type RequisitionForm } from './criteriaFormModel';

interface Props {
  form: RequisitionForm;
  onChange: (patch: Partial<RequisitionForm>) => void;
  readOnly: boolean;
}

const inputCls = 'w-full min-h-11 px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';
const checkRowCls = 'flex min-h-11 items-center gap-3 rounded-lg border px-3 dark:border-gray-700 cursor-pointer';
const checkCls = 'h-5 w-5 cursor-pointer rounded border-gray-300 text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500';

/** Selection criteria inputs of the requisition modal: education, experience and shift. */
export default function RequisitionCriteriaFields({ form, onChange, readOnly }: Props) {
  return (
    <fieldset disabled={readOnly} className={`border-t pt-4 dark:border-gray-700 ${readOnly ? 'opacity-70' : ''}`}>
      <legend className="sr-only">Selection criteria</legend>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-amber-600" aria-hidden="true" /> Selection criteria
      </h3>
      {readOnly ? (
        <p className="text-xs text-gray-600 dark:text-gray-300 mb-3 flex items-center gap-1">
          <Lock className="w-3.5 h-3.5" aria-hidden="true" /> Locked: this requisition is approved. Use Edit criteria on the requisition to change them.
        </p>
      ) : (
        <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">Leave a field blank when there is no requirement. Candidates are screened against what is set here.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="req-education" className={labelCls}>Minimum education</label>
          <select id="req-education" value={form.education_level} onChange={(e) => onChange({ education_level: e.target.value })} className={`${inputCls} cursor-pointer`}>
            <option value="">No requirement given</option>
            {EDUCATION_LADDER.map((l) => <option key={l} value={l}>{l} or above</option>)}
            <option value="other">Other (type it)</option>
          </select>
        </div>
        {form.education_level === 'other' && (
          <div>
            <label htmlFor="req-education-other" className={labelCls}>Education or stream</label>
            <input
              id="req-education-other"
              type="text"
              maxLength={255}
              value={form.education_other}
              onChange={(e) => onChange({ education_other: e.target.value })}
              className={inputCls}
              placeholder="e.g. B.Com (Commerce)"
              aria-describedby="req-education-other-hint"
            />
            <p id="req-education-other-hint" className="text-xs text-gray-600 dark:text-gray-300 mt-1">Words like preferred or optional make it a preference, not a requirement.</p>
          </div>
        )}
        <div>
          <label htmlFor="req-exp-min" className={labelCls}>Experience from (years)</label>
          <input id="req-exp-min" type="number" min={0} max={45} step={0.5} inputMode="decimal" value={form.experience_min_years}
            onChange={(e) => onChange({ experience_min_years: e.target.value })} className={inputCls} placeholder="e.g. 0" />
        </div>
        <div>
          <label htmlFor="req-exp-max" className={labelCls}>Experience up to (years)</label>
          <input id="req-exp-max" type="number" min={0} max={45} step={0.5} inputMode="decimal" value={form.experience_max_years}
            onChange={(e) => onChange({ experience_max_years: e.target.value })} className={inputCls} placeholder="e.g. 3" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="req-shift" className={labelCls}>Shift</label>
          <input id="req-shift" type="text" maxLength={100} value={form.shift_requirement}
            onChange={(e) => onChange({ shift_requirement: e.target.value })} className={inputCls} placeholder="e.g. Night 9pm to 6am" />
        </div>
        <label htmlFor="req-night-shift" className={checkRowCls}>
          <input id="req-night-shift" type="checkbox" checked={form.night_shift_required}
            onChange={(e) => onChange({ night_shift_required: e.target.checked })} className={checkCls} />
          <span className="text-sm text-gray-700 dark:text-gray-200">Night shift: candidate must be willing</span>
        </label>
        <label htmlFor="req-rotational-shift" className={checkRowCls}>
          <input id="req-rotational-shift" type="checkbox" checked={form.rotational_shift}
            onChange={(e) => onChange({ rotational_shift: e.target.checked })} className={checkCls} />
          <span className="text-sm text-gray-700 dark:text-gray-200">Rotational shifts: candidate must be OK with them</span>
        </label>
      </div>
    </fieldset>
  );
}
