import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAutoSave } from '../useAutoSave';
import { VerificationBadge } from '../VerificationBadge';
import type { BgvCheck } from '../useOnboardingV2';

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

  useEffect(() => {
    if (initialData) {
      setForm(prev => ({ ...prev, ...Object.fromEntries(Object.entries(initialData).filter(([,v]) => v != null).map(([k,v]) => [k, String(v)])) }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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
    setVerifying(docType === 'driving_license' ? 'dl' : 'voter');
    try {
      await verifyBgv('verify/address-doc', { docType, documentNumber: docNo });
    } finally {
      setVerifying(null);
    }
  };

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">Address Details</h2>

      <div className="space-y-3">
        <h3 className="font-semibold text-gray-700 text-sm">Permanent Address</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><label className={lbl}>Address Line *</label><input className={inp} value={form.permanent_address} onChange={set('permanent_address')} /></div>
          <div><label className={lbl}>State *</label><input className={inp} value={form.permanent_state} onChange={set('permanent_state')} /></div>
          <div><label className={lbl}>City *</label><input className={inp} value={form.permanent_city} onChange={set('permanent_city')} /></div>
          <div><label className={lbl}>PIN Code *</label><input className={inp} value={form.permanent_pincode} onChange={set('permanent_pincode')} maxLength={6} /></div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-700 text-sm">Present / Correspondence Address</h3>
          <label className="flex items-center gap-1.5 text-xs text-purple-600 cursor-pointer">
            <input type="checkbox" checked={sameAsPermanent} onChange={copyToPermanent} className="accent-purple-600" />
            Same as permanent
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><label className={lbl}>Address Line *</label><input className={inp} value={form.present_address} onChange={set('present_address')} disabled={sameAsPermanent} /></div>
          <div><label className={lbl}>State *</label><input className={inp} value={form.present_state} onChange={set('present_state')} disabled={sameAsPermanent} /></div>
          <div><label className={lbl}>City *</label><input className={inp} value={form.present_city} onChange={set('present_city')} disabled={sameAsPermanent} /></div>
          <div><label className={lbl}>PIN Code *</label><input className={inp} value={form.present_pincode} onChange={set('present_pincode')} disabled={sameAsPermanent} maxLength={6} /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Work Location Type</label>
          <select className={inp} value={form.emp_location_type} onChange={set('emp_location_type')}>
            <option value="">Select</option>
            <option value="WFO">Work from Office</option>
            <option value="WFH">Work from Home</option>
            <option value="Hybrid">Hybrid</option>
          </select>
        </div>
        <div><label className={lbl}>Sub-location</label><input className={inp} value={form.sub_location} onChange={set('sub_location')} placeholder="Floor / Wing / Seat" /></div>
      </div>

      <hr className="border-gray-100" />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-700 text-sm">Address Proof Verification</h3>
          {addressDocCheck && <VerificationBadge status={addressDocCheck.status} />}
        </div>
        <p className="text-xs text-gray-500">Verify your address via Driving Licence or Voter ID API. This is non-blocking — you can proceed without verifying.</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={lbl}>Driving Licence No.</label>
              <input className={inp} value={dlNo} onChange={e => setDlNo(e.target.value)} placeholder="DL-1234567890" />
            </div>
            <button
              type="button"
              disabled={!dlNo || verifying === 'dl'}
              onClick={() => doVerify('driving_license', dlNo)}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700 whitespace-nowrap"
            >
              {verifying === 'dl' ? <Loader2 size={13} className="animate-spin" /> : null}
              Verify DL
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={lbl}>Voter ID (EPIC) No.</label>
              <input className={inp} value={voterNo} onChange={e => setVoterNo(e.target.value)} placeholder="ABC1234567" />
            </div>
            <button
              type="button"
              disabled={!voterNo || verifying === 'voter'}
              onClick={() => doVerify('voter_id', voterNo)}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700 whitespace-nowrap"
            >
              {verifying === 'voter' ? <Loader2 size={13} className="animate-spin" /> : null}
              Verify Voter ID
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
