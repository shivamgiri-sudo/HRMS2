import React, { useState, useEffect } from 'react';
import { InlineDocUpload } from '../InlineDocUpload';
import { useAutoSave } from '../useAutoSave';

interface S7Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
}

export function S7_WorkExperience({ token, initialData, saveSection }: S7Props) {
  const [form, setForm] = useState({
    working_experience: 'fresher' as 'fresher' | 'experienced',
    experience_year: '',
    employer_name: '',
    last_designation: '',
    last_ctc: '',
    reporting_manager_name: '',
    reporting_manager_mobile: '',
  });

  useEffect(() => {
    if (initialData) {
      setForm(prev => ({
        ...prev,
        working_experience: String(initialData.working_experience ?? 'fresher') as 'fresher' | 'experienced',
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

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">Work Experience</h2>

      <div>
        <label className={lbl}>Employment Status *</label>
        <div className="flex gap-4">
          {(['fresher', 'experienced'] as const).map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={v} checked={form.working_experience === v} onChange={set('working_experience')} className="accent-purple-600" />
              <span className="text-sm text-gray-700 capitalize">{v}</span>
            </label>
          ))}
        </div>
      </div>

      {form.working_experience === 'experienced' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={lbl}>Years of Experience *</label><input className={inp} value={form.experience_year} onChange={set('experience_year')} type="number" min="0" step="0.5" placeholder="e.g. 2.5" /></div>
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
