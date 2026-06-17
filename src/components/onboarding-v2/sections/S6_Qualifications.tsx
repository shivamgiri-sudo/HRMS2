import React, { useState, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';

const QUAL_API = `${import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055'}/api/ats/onboarding-full`;
import { VerificationBadge } from '../VerificationBadge';
import { InlineDocUpload } from '../InlineDocUpload';
import type { BgvCheck } from '../useOnboardingV2';

interface QualRow {
  id?: string;
  qualification: string;
  specialization_course_name: string;
  passed_out_year: string;
  passed_out_state: string;
  passed_out_city: string;
  passed_out_percentage: string;
  institution_name: string;
  roll_number: string;
  board_type: string;
}

interface S6Props {
  token: string;
  initialData: unknown[];
  verifyBgv: (endpoint: string, payload?: Record<string, unknown>) => Promise<void>;
  eduCheck?: BgvCheck;
}

export function S6_Qualifications({ token, initialData, verifyBgv, eduCheck }: S6Props) {
  const blank = (): QualRow => ({ qualification: '', specialization_course_name: '', passed_out_year: '', passed_out_state: '', passed_out_city: '', passed_out_percentage: '', institution_name: '', roll_number: '', board_type: '' });
  const [rows, setRows] = useState<QualRow[]>([blank()]);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    if (Array.isArray(initialData) && initialData.length > 0) {
      setRows(initialData.map(r => ({ ...blank(), ...(r as Partial<QualRow>) })));
    }
  }, [initialData]);

  const setRow = (idx: number, k: keyof QualRow, v: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [k]: v } : r));

  const saveRow = async (idx: number) => {
    setSaving(idx);
    try {
      await fetch(`${QUAL_API}/qualification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...rows[idx] }),
      });
    } finally {
      setSaving(null);
    }
  };

  const doVerify = async (idx: number) => {
    const row = rows[idx];
    setVerifying(idx);
    try {
      await verifyBgv('verify/education', {
        boardType: row.board_type || 'other',
        rollNumber: row.roll_number || undefined,
        yearOfPassing: Number(row.passed_out_year),
        institutionName: row.institution_name || undefined,
      });
    } finally {
      setVerifying(null);
    }
  };

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">Qualifications</h2>
        {eduCheck && <VerificationBadge status={eduCheck.status} summary={eduCheck.result_summary} />}
      </div>

      {rows.map((row, idx) => (
        <div key={idx} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm text-gray-700">Qualification {idx + 1}</p>
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))} className="text-xs text-red-500 hover:text-red-700">Remove</button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Qualification *</label>
              <select className={inp} value={row.qualification} onChange={e => setRow(idx, 'qualification', e.target.value)}>
                <option value="">Select</option>
                {['10th','12th','Diploma','Graduate','Post Graduate','Professional'].map(q => <option key={q}>{q}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Board / University Type</label>
              <select className={inp} value={row.board_type} onChange={e => setRow(idx, 'board_type', e.target.value)}>
                <option value="">Select</option>
                <option value="cbse_10">CBSE (10th)</option>
                <option value="cbse_12">CBSE (12th)</option>
                <option value="university">University</option>
                <option value="other">Other / State Board</option>
              </select>
            </div>
            <div><label className={lbl}>Institution Name</label><input className={inp} value={row.institution_name} onChange={e => setRow(idx, 'institution_name', e.target.value)} /></div>
            <div><label className={lbl}>Course / Specialization</label><input className={inp} value={row.specialization_course_name} onChange={e => setRow(idx, 'specialization_course_name', e.target.value)} /></div>
            <div><label className={lbl}>Year of Passing *</label><input className={inp} value={row.passed_out_year} onChange={e => setRow(idx, 'passed_out_year', e.target.value)} type="number" min="1990" max="2030" /></div>
            <div><label className={lbl}>Percentage / CGPA</label><input className={inp} value={row.passed_out_percentage} onChange={e => setRow(idx, 'passed_out_percentage', e.target.value)} /></div>
            <div><label className={lbl}>Roll / Certificate Number</label><input className={inp} value={row.roll_number} onChange={e => setRow(idx, 'roll_number', e.target.value)} /></div>
            <div><label className={lbl}>State</label><input className={inp} value={row.passed_out_state} onChange={e => setRow(idx, 'passed_out_state', e.target.value)} /></div>
          </div>
          <InlineDocUpload token={token} docType={`marksheet_${idx}`} label="Upload Marksheet / Certificate *" />
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={saving === idx}
              onClick={() => saveRow(idx)}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-gray-800"
            >
              {saving === idx ? <Loader2 size={13} className="animate-spin" /> : null}
              Save Entry
            </button>
            <button
              type="button"
              disabled={!row.passed_out_year || verifying === idx}
              onClick={() => doVerify(idx)}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700"
            >
              {verifying === idx ? <Loader2 size={13} className="animate-spin" /> : null}
              Verify Certificate
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows(prev => [...prev, blank()])}
        className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-purple-400 hover:text-purple-600"
      >
        <Plus size={14} /> Add Another Qualification
      </button>
    </div>
  );
}
