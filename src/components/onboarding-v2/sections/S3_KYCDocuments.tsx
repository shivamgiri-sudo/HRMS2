import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAutoSave } from '../useAutoSave';
import { VerificationBadge } from '../VerificationBadge';
import { InlineDocUpload } from '../InlineDocUpload';
import type { BgvCheck } from '../useOnboardingV2';

interface S3Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
  verifyBgv: (endpoint: string, payload?: Record<string, unknown>) => Promise<void>;
  panCheck?: BgvCheck;
  aadhaarCheck?: BgvCheck;
}

export function S3_KYCDocuments({ token, initialData, saveSection, verifyBgv, panCheck, aadhaarCheck }: S3Props) {
  const [form, setForm] = useState({
    pan_number: '', aadhaar_number: '', passport_number: '', dl_number: '',
  });
  const [verifying, setVerifying] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setForm(prev => ({
        ...prev,
        pan_number: String(initialData.pan_number_masked ?? ''),
        passport_number: String(initialData.passport_number ?? ''),
        dl_number: String(initialData.dl_number ?? ''),
      }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  useAutoSave(payload => saveSection('employee-details', {
    pan_number: payload.pan_number,
    passport_number: payload.passport_number,
    dl_number: payload.dl_number,
  }), form);

  const verify = async (type: string, extra?: Record<string, unknown>) => {
    setVerifying(type);
    try {
      if (type === 'pan') await verifyBgv('verify/pan', { panNumber: form.pan_number.trim().toUpperCase() });
      else if (type === 'aadhaar') await verifyBgv('verify/aadhaar-offline', extra);
    } finally {
      setVerifying(null);
    }
  };

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">KYC Documents</h2>

      {/* PAN */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-700">PAN Card</h3>
          {panCheck && <VerificationBadge status={panCheck.status} summary={panCheck.result_summary} />}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={lbl}>PAN Number *</label>
            <input className={inp} value={form.pan_number} onChange={set('pan_number')} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} />
          </div>
          <button
            type="button"
            disabled={form.pan_number.length !== 10 || verifying === 'pan'}
            onClick={() => verify('pan')}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700"
          >
            {verifying === 'pan' ? <Loader2 size={13} className="animate-spin" /> : null}
            Verify PAN
          </button>
        </div>
        <InlineDocUpload token={token} docType="pan_card" label="Upload PAN Card (optional)" />
      </div>

      {/* Aadhaar */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-700">Aadhaar Card</h3>
          {aadhaarCheck && <VerificationBadge status={aadhaarCheck.status} summary={aadhaarCheck.result_summary} />}
        </div>
        <p className="text-xs text-gray-500">Aadhaar number is stored as a masked value. Upload the document for verification.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={verifying === 'aadhaar'}
            onClick={() => verify('aadhaar')}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700"
          >
            {verifying === 'aadhaar' ? <Loader2 size={13} className="animate-spin" /> : null}
            Verify Aadhaar
          </button>
        </div>
        <InlineDocUpload token={token} docType="aadhaar_card" label="Upload Aadhaar Card (front+back) *" />
      </div>

      {/* Passport */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-700">Passport (if available)</h3>
        <div>
          <label className={lbl}>Passport Number</label>
          <input className={inp} value={form.passport_number} onChange={set('passport_number')} placeholder="A1234567" maxLength={20} />
        </div>
        <InlineDocUpload token={token} docType="passport" label="Upload Passport (bio page)" />
      </div>

      {/* DL */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-700">Driving Licence (if available)</h3>
        <div>
          <label className={lbl}>Driving Licence Number</label>
          <input className={inp} value={form.dl_number} onChange={set('dl_number')} placeholder="DL-1234567890" />
        </div>
        <InlineDocUpload token={token} docType="driving_license" label="Upload DL (front+back)" />
      </div>
    </div>
  );
}
