import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, Info } from 'lucide-react';
import { useAutoSave } from '../useAutoSave';
import { VerificationBadge } from '../VerificationBadge';
import type { BgvCheck } from '../useOnboardingV2';
import { hrmsApi } from '@/lib/hrmsApi';

interface S2Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
  verifyBgv: (endpoint: string, payload?: Record<string, unknown>) => Promise<void>;
  addressDocCheck?: BgvCheck;
}

export function S2_Address({ token: _token, initialData, saveSection, verifyBgv, addressDocCheck }: S2Props) {
  const [form, setForm] = useState({
    permanent_address: '', permanent_state: '', permanent_city: '', permanent_pincode: '',
    present_address: '', present_state: '', present_city: '', present_pincode: '',
    emp_location_type: '', sub_location: '',
  });
  const [sameAsPermanent, setSameAsPermanent] = useState(false);
  const [dlNo, setDlNo] = useState('');
  const [voterNo, setVoterNo] = useState('');
  const [verifying, setVerifying] = useState<'dl' | 'voter' | null>(null);
  const [states, setStates] = useState<string[]>([]);
  const [addressProofTypes, setAddressProofTypes] = useState<any[]>([]);
  const initializedRef = useRef(false);

  // Load master data
  useEffect(() => {
    Promise.all([
      hrmsApi.get('/api/onboarding/data/states').then(r => setStates(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {}),
      hrmsApi.get('/api/onboarding/data/address-proof-types').then(r => setAddressProofTypes(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    if (initialData && !initializedRef.current) {
      initializedRef.current = true;
      setForm(prev => ({ ...prev, ...Object.fromEntries(Object.entries(initialData).filter(([,v]) => v != null).map(([k,v]) => [k, String(v)])) }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setForm(prev => {
      const next = { ...prev, [k]: val };
      if (sameAsPermanent && k.startsWith('permanent_')) {
        const presKey = k.replace('permanent_', 'present_') as keyof typeof form;
        (next as Record<string, string>)[presKey] = val;
      }
      return next;
    });
  };

  const copyToPermanent = () => {
    setSameAsPermanent(v => {
      if (!v) {
        setForm(prev => ({
          ...prev,
          present_address: prev.permanent_address,
          present_state: prev.permanent_state,
          present_city: prev.permanent_city,
          present_pincode: prev.permanent_pincode,
        }));
      }
      return !v;
    });
  };

  useAutoSave(payload => saveSection('employee-details', payload), form);

  const doVerify = async (docType: 'driving_license' | 'voter_id', docNo: string) => {
    if (!docNo.trim()) return;
    setVerifying(docType === 'driving_license' ? 'dl' : 'voter');
    try {
      await verifyBgv('verify/address-doc', { docType, documentNumber: docNo });
    } finally {
      setVerifying(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Address & Address Proof</h2>
        <p className="text-sm text-slate-600 mt-1">Provide your permanent and current addresses along with proof documents.</p>
      </div>

      {/* Permanent Address Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">Permanent Address</h3>
          <span className="inline-block px-2 py-1 bg-slate-100 text-xs font-medium text-slate-700 rounded">Required</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">Address Line *</label>
            <textarea
              value={form.permanent_address}
              onChange={set('permanent_address')}
              placeholder="House No., Street, Building Name"
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">State *</label>
            <select
              value={form.permanent_state}
              onChange={set('permanent_state')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
            >
              <option value="">Select state</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">City *</label>
            <input
              type="text"
              value={form.permanent_city}
              onChange={set('permanent_city')}
              placeholder="City name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">PIN Code *</label>
            <input
              type="text"
              value={form.permanent_pincode}
              onChange={set('permanent_pincode')}
              placeholder="6 digits"
              maxLength={6}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            />
          </div>
        </div>
      </div>

      {/* Present Address Section */}
      <div className="space-y-4 pt-6 border-t">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Current / Correspondence Address</h3>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 hover:text-slate-900 transition-colors">
            <input type="checkbox" checked={sameAsPermanent} onChange={copyToPermanent} className="accent-blue-600 rounded cursor-pointer" />
            <span className="font-medium">Same as permanent</span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">Address Line *</label>
            <textarea
              value={form.present_address}
              onChange={set('present_address')}
              disabled={sameAsPermanent}
              placeholder="House No., Street, Building Name"
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">State *</label>
            <select
              value={form.present_state}
              onChange={set('present_state')}
              disabled={sameAsPermanent}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white disabled:bg-slate-50 disabled:cursor-not-allowed"
            >
              <option value="">Select state</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">City *</label>
            <input
              type="text"
              value={form.present_city}
              onChange={set('present_city')}
              disabled={sameAsPermanent}
              placeholder="City name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">PIN Code *</label>
            <input
              type="text"
              value={form.present_pincode}
              onChange={set('present_pincode')}
              disabled={sameAsPermanent}
              placeholder="6 digits"
              maxLength={6}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Address Proof Documents */}
      <div className="space-y-4 pt-6 border-t">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">Address Proof Documents</h3>
          <span className="inline-block px-2 py-1 bg-blue-100 text-xs font-medium text-blue-700 rounded">BGV Verified</span>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex gap-3">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-700">
            <p className="font-medium">Government-accepted proof documents</p>
            <p className="text-slate-600 mt-1">Upload any one of: Driving License, Voter ID, Passport, or Aadhaar. We'll verify using BGV APIs.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Driving License */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">Driving License (DL) Number</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={dlNo}
                onChange={(e) => setDlNo(e.target.value)}
                placeholder="e.g., DL0199900512345"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => doVerify('driving_license', dlNo)}
                disabled={!dlNo.trim() || verifying === 'dl'}
                className="px-3 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {verifying === 'dl' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
              </button>
            </div>
          </div>

          {/* Voter ID */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-1.5">Voter ID (EPIC) Number</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={voterNo}
                onChange={(e) => setVoterNo(e.target.value)}
                placeholder="e.g., 123456789012"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => doVerify('voter_id', voterNo)}
                disabled={!voterNo.trim() || verifying === 'voter'}
                className="px-3 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {verifying === 'voter' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
              </button>
            </div>
          </div>
        </div>

        {addressDocCheck && (
          <div className="mt-3">
            <VerificationBadge status={addressDocCheck.status} summary={addressDocCheck.result_summary} />
          </div>
        )}
      </div>
    </div>
  );
}
