import React, { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { apiUrl } from '@/lib/apiBase';

const QUAL_API = apiUrl('/api/ats/onboarding-full');
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
  const [saveError, setSaveError] = useState<{ idx: number; msg: string } | null>(null);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (Array.isArray(initialData) && initialData.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setRows(initialData.map(r => ({ ...blank(), ...(r as Partial<QualRow>) })));
    }
  }, [initialData]);

  const setRow = (idx: number, k: keyof QualRow, v: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [k]: v } : r));

  const saveRow = async (idx: number) => {
    const row = rows[idx];
    if (!row.qualification || !row.passed_out_year) {
      setSaveError({ idx, msg: 'Qualification type and year of passing are required.' });
      return;
    }
    setSaveError(null);
    setSaving(idx);
    try {
      await fetch(`${QUAL_API}/qualification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...row }),
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

  const lbl = 'block text-sm font-semibold text-slate-900 mb-1.5';
  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="space-y-6 font-lexend">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Qualifications</h2>
          <p className="text-sm text-slate-600 mt-1">Add your educational qualifications and certifications</p>
        </div>
        {eduCheck && <VerificationBadge status={eduCheck.status} summary={eduCheck.result_summary} />}
      </div>

      {rows.map((row, idx) => (
        <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm text-slate-900">Qualification {idx + 1}</p>
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded">
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Qualification *</label>
              <select className={`${inp} appearance-none bg-white`} value={row.qualification} onChange={e => setRow(idx, 'qualification', e.target.value)}>
                <option value="">Select</option>
                {['10th','12th','Diploma','Graduate','Post Graduate','Professional'].map(q => <option key={q}>{q}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Board / University Type</label>
              <select className={`${inp} appearance-none bg-white`} value={row.board_type} onChange={e => setRow(idx, 'board_type', e.target.value)}>
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
          {saveError?.idx === idx && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {saveError.msg}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={saving === idx}
              onClick={() => saveRow(idx)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {saving === idx ? <Loader2 size={13} className="animate-spin" /> : null}
              Save Entry
            </button>
            <button
              type="button"
              disabled={!row.passed_out_year || verifying === idx}
              onClick={() => doVerify(idx)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
            >
              {verifying === idx ? <Loader2 size={13} className="animate-spin" /> : null}
              Verify
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows(prev => [...prev, blank()])}
        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
      >
        <Plus size={14} /> Add Qualification
      </button>
    </div>
  );
}
