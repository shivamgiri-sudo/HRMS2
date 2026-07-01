import React, { useState, useEffect, useRef } from 'react';
import { InlineDocUpload } from '../InlineDocUpload';
import { useAutoSave } from '../useAutoSave';

interface S7Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
}

export function S7_WorkExperience({ token, initialData, saveSection }: S7Props) {
  const [employmentTypes, setEmploymentTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({
    working_experience: 'fresher' as 'fresher' | 'experienced',
    employment_type: '',
    experience_year: '',
    employer_name: '',
    last_designation: '',
    last_ctc: '',
    reporting_manager_name: '',
    reporting_manager_mobile: '',
  });

  // Only seed from server on first truthy initialData per mount.
  // Without this, every autosave → fetchStatus → initialData change would reset user edits.
  const initializedRef = useRef(false);

  useEffect(() => {
    const fetchEmploymentTypes = async () => {
      try {
        const url = `${import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055'}/api/onboarding/data/employment-types`;
        const resp = await fetch(url);
        const data = await resp.json();
        setEmploymentTypes(Array.isArray(data) ? data : []);
      } catch {
        setEmploymentTypes([]);
      }
    };
    fetchEmploymentTypes();
  }, []);

  useEffect(() => {
    if (initialData && !initializedRef.current) {
      initializedRef.current = true;
      setForm(prev => ({
        ...prev,
        working_experience: String(initialData.working_experience ?? 'fresher') as 'fresher' | 'experienced',
        employment_type: String(initialData.employment_type ?? ''),
        experience_year: String(initialData.experience_year ?? ''),
        employer_name: String(initialData.employer_name ?? ''),
        last_designation: String(initialData.last_designation ?? ''),
        last_ctc: String(initialData.last_ctc ?? ''),
        reporting_manager_name: String(initialData.reporting_manager_name ?? ''),
        reporting_manager_mobile: String(initialData.reporting_manager_mobile ?? ''),
      }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  useAutoSave(payload => saveSection('experience', payload), form);

  const lbl = 'block text-sm font-semibold text-slate-900 mb-1.5';
  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  const isFresher = form.working_experience === 'fresher';

  return (
    <div className="space-y-6 font-lexend">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Work Experience</h2>
        <p className="text-sm text-slate-600 mt-1">Share your employment status and experience details</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className={lbl}>Employment Status *</label>
        <div className="flex gap-4 mt-3">
          {(['fresher', 'experienced'] as const).map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={v} checked={form.working_experience === v} onChange={set('working_experience')} className="w-4 h-4 accent-blue-600" />
              <span className="text-sm text-slate-700 capitalize font-medium">{v === 'fresher' ? 'Fresher' : 'Experienced'}</span>
            </label>
          ))}
        </div>
      </div>

      {!isFresher && (
        <div className="space-y-4 border-t pt-6">
          <h3 className="text-lg font-semibold text-slate-900">Experience Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={lbl}>Years of Experience *</label><input className={inp} value={form.experience_year} onChange={set('experience_year')} type="number" min="0" step="0.5" placeholder="e.g. 2.5" /></div>
            <div>
              <label className={lbl}>Employment Type</label>
              <select className={`${inp} appearance-none bg-white`} value={form.employment_type} onChange={set('employment_type')}>
                <option value="">Select</option>
                {employmentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Last Employer Name</label><input className={inp} value={form.employer_name} onChange={set('employer_name')} /></div>
            <div><label className={lbl}>Last Designation</label><input className={inp} value={form.last_designation} onChange={set('last_designation')} /></div>
            <div><label className={lbl}>Last CTC (₹ per month)</label><input className={inp} value={form.last_ctc} onChange={set('last_ctc')} type="number" /></div>
            <div><label className={lbl}>Reporting Manager Name</label><input className={inp} value={form.reporting_manager_name} onChange={set('reporting_manager_name')} /></div>
            <div><label className={lbl}>Reporting Manager Mobile</label><input className={inp} value={form.reporting_manager_mobile} onChange={set('reporting_manager_mobile')} type="tel" /></div>
          </div>
          <InlineDocUpload token={token} docType="experience_doc" label="Upload Relieving Letter / Offer Letter / Payslip" />
        </div>
      )}
    </div>
  );
}
