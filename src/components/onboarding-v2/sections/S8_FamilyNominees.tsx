import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { useAutoSave } from '../useAutoSave';

interface FamilyMember {
  id?: string;
  name: string;
  relation: string;
  date_of_birth: string;
  occupation: string;
}

interface S8Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
}

export function S8_FamilyNominees({ token: _token, initialData, saveSection }: S8Props) {
  const blank = (): FamilyMember => ({ name: '', relation: '', date_of_birth: '', occupation: '' });
  const [form, setForm] = useState({
    annual_income: '', count_of_dependents: '',
  });
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (initialData && !initializedRef.current) {
      initializedRef.current = true;
      setForm(prev => ({
        ...prev,
        annual_income: String(initialData.annual_income ?? ''),
        count_of_dependents: String(initialData.count_of_dependents ?? ''),
      }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const setMember = (idx: number, k: keyof FamilyMember, v: string) =>
    setFamilyMembers(prev => prev.map((m, i) => i === idx ? { ...m, [k]: v } : m));

  useAutoSave(payload => saveSection('family', payload), form);

  const lbl = 'block text-sm font-semibold text-slate-900 mb-1.5';
  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="space-y-6 font-lexend">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Family & Nominees</h2>
        <p className="text-sm text-slate-600 mt-1">Record family members and income details</p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex gap-3">
        <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-700">Nominee information (name, relation, DOB) was captured in Section 1 — Personal Information. Please verify it there.</p>
      </div>

      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Family Income Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Annual Family Income (₹)</label>
            <input className={inp} value={form.annual_income} onChange={set('annual_income')} type="number" placeholder="e.g. 250000" />
            <p className="text-xs text-slate-500 mt-1">Required for ESI and benefits eligibility assessment</p>
          </div>
          <div>
            <label className={lbl}>Number of Dependents</label>
            <input className={inp} value={form.count_of_dependents} onChange={set('count_of_dependents')} type="number" min="0" placeholder="e.g. 3" />
          </div>
        </div>
      </div>

      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Family Members (Optional)</h3>
        {familyMembers.length > 0 && (
          <div className="space-y-3 mb-4">
            {familyMembers.map((member, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3 flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900">{member.name || '(No name)'}</p>
                  <p className="text-xs text-slate-600">{member.relation} • {member.date_of_birth || '(No DOB)'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFamilyMembers(prev => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setFamilyMembers(prev => [...prev, blank()])}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 mb-4"
        >
          <Plus size={14} /> Add Family Member
        </button>

        {familyMembers.length > 0 && (
          <div className="space-y-3">
            {familyMembers.map((member, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-sm text-slate-900">Family Member {idx + 1}</p>
                  <button
                    type="button"
                    onClick={() => setFamilyMembers(prev => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>Full Name</label>
                    <input className={inp} value={member.name} onChange={e => setMember(idx, 'name', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Relation to You</label>
                    <input className={inp} value={member.relation} onChange={e => setMember(idx, 'relation', e.target.value)} placeholder="e.g. Father, Mother, Sibling" />
                  </div>
                  <div>
                    <label className={lbl}>Date of Birth</label>
                    <input type="date" className={inp} value={member.date_of_birth} onChange={e => setMember(idx, 'date_of_birth', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Occupation</label>
                    <input className={inp} value={member.occupation} onChange={e => setMember(idx, 'occupation', e.target.value)} placeholder="e.g. Self-employed, Retired" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
