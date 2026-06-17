import React, { useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { VerificationBadge } from '../VerificationBadge';
import type { BgvCheck } from '../useOnboardingV2';

interface S9Props {
  token: string;
  verifyBgv: (endpoint: string, payload?: Record<string, unknown>) => Promise<void>;
  courtCheck?: BgvCheck;
  candidateName?: string;
}

export function S9_CourtCheck({ token: _token, verifyBgv, courtCheck, candidateName }: S9Props) {
  const [running, setRunning] = useState(false);

  const initiate = async () => {
    setRunning(true);
    try {
      await verifyBgv('verify/court');
    } finally {
      setRunning(false);
    }
  };

  const statusLabel = courtCheck?.status === 'verified' ? 'Clear' : courtCheck?.status === 'failed' ? 'Records Found' : undefined;

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-800">Court / Criminal Record Verification</h2>

      <div className="bg-gray-50 rounded-xl p-5 space-y-4 border border-gray-100">
        <div className="flex items-center gap-2">
          <Shield className="text-purple-600" size={20} />
          <p className="font-semibold text-gray-700">About this check</p>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          This check verifies your name and date of birth against court and criminal records databases via a public API. It is a mandatory BGV step for compliance.
        </p>
        <p className="text-sm text-gray-600">
          The check uses the following details from your profile:
        </p>
        <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
          <li>Name: <strong>{candidateName ?? 'From your profile'}</strong></li>
          <li>Date of birth, father's name, and permanent address (filled in Sections 1 & 2)</li>
        </ul>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={running || courtCheck?.status === 'queued' || courtCheck?.status === 'verified'}
            onClick={initiate}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            {courtCheck?.status === 'queued' ? 'Check In Progress…' : courtCheck?.status === 'verified' ? 'Check Complete' : 'Initiate Court Check'}
          </button>
          {courtCheck && <VerificationBadge status={courtCheck.status} label={statusLabel} summary={courtCheck.result_summary} />}
        </div>
        {courtCheck?.result_summary && (
          <p className="text-xs text-gray-500 bg-white border border-gray-100 rounded-lg p-3">{courtCheck.result_summary}</p>
        )}
      </div>

      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 text-sm text-amber-800">
        <strong>Important:</strong> This check is non-blocking. You may submit your onboarding form regardless of the court check status. HR will review the result separately.
      </div>
    </div>
  );
}
