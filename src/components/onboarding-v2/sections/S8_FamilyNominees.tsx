import React, { useState, useEffect } from 'react';
import { useAutoSave } from '../useAutoSave';

interface S8Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
}

export function S8_FamilyNominees({ token: _token, initialData, saveSection }: S8Props) {
  const [form, setForm] = useState({
    annual_income: '', count_of_dependents: '',
  });

  useEffect(() => {
    if (initialData) {
      setForm(prev => ({
        ...prev,
        annual_income: String(initialData.annual_income ?? ''),
        count_of_dependents: String(initialData.count_of_dependents ?? ''),
      }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  useAutoSave(payload => saveSection('family', payload), form);

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">Family & Nominees</h2>
      <p className="text-sm text-gray-500">Nominee details were captured in Section 1 (Personal Info). Complete the family income details below for HR records.</p>

      <div className="bg-gray-50 rounded-xl p-4 space-y-4">
        <h3 className="font-semibold text-sm text-gray-700">Family Income Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Annual Family Income (₹)</label>
            <input className={inp} value={form.annual_income} onChange={set('annual_income')} type="number" placeholder="e.g. 250000" />
            <p className="text-xs text-gray-400 mt-1">Required for ESI and benefits eligibility assessment.</p>
          </div>
          <div>
            <label className={lbl}>Number of Dependents</label>
            <input className={inp} value={form.count_of_dependents} onChange={set('count_of_dependents')} type="number" min="0" placeholder="e.g. 3" />
          </div>
        </div>
      </div>

      <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
        <strong>Note:</strong> Nominee information (name, relation, date of birth) was captured in Section 1 — Personal Information. Please ensure it is filled correctly there.
      </div>
    </div>
  );
}
