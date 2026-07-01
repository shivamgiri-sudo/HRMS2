import React, { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { DigiLockerButton } from '../DigiLockerButton';

const BGV_API = `${import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055'}/api/ats/bgv`;

interface S0Props {
  token: string;
  hasConsent: boolean;
  candidateInfo: { full_name?: string; branch_name?: string; process_name?: string } | null;
  onConsented: () => void;
}

const CONSENT_TEXT = `I hereby consent to the collection, verification, and processing of my personal data, identity documents, educational credentials, employment history, and court/criminal records for the purpose of employment background verification (BGV) in accordance with applicable laws including the Digital Personal Data Protection Act (DPDP), 2023. I understand that this verification is a requirement for my employment with MAS Callnet India Pvt. Ltd.`;

export function S0_Welcome({ token, hasConsent, candidateInfo, onConsented }: S0Props) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConsent = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BGV_API}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, consentText: CONSENT_TEXT, purposes: ['bgv', 'employment'] }),
      });
      const data = await res.json();
      if (data.success) {
        onConsented();
      } else {
        setError(data.message ?? 'Could not record consent. Please try again.');
      }
    } catch {
      setError('Could not record consent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h1 className="text-2xl font-bold mb-1">Welcome, {candidateInfo?.full_name ?? 'Candidate'} 👋</h1>
        <p className="text-purple-100 text-sm">
          {candidateInfo?.branch_name} {candidateInfo?.process_name ? `· ${candidateInfo.process_name}` : ''}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-purple-600" size={20} />
          <h2 className="font-semibold text-gray-800">Background Verification Consent</h2>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{CONSENT_TEXT}</p>

        {!hasConsent ? (
          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-purple-600"
              />
              <span className="text-sm text-gray-700">
                I have read and agree to the above consent statement.
              </span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={!agreed || submitting}
              onClick={handleConsent}
              className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? 'Recording…' : 'Give Consent & Begin'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm font-medium">
            <ShieldCheck size={16} />
            Consent recorded. You may proceed with the form.
          </div>
        )}
      </div>

      {hasConsent && (
        <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 space-y-3">
          <h3 className="font-semibold text-blue-800 text-sm">One-Click Document Fetch via DigiLocker</h3>
          <p className="text-xs text-blue-600">Connect your DigiLocker to automatically pull Aadhaar, Driving Licence, Voter ID, Education certificates, and Passport — all at once.</p>
          <DigiLockerButton token={token} variant="primary" />
          <p className="text-xs text-gray-400">Or upload documents manually in each section below.</p>
        </div>
      )}
    </div>
  );
}
