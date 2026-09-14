import React, { useState } from 'react';
import { Shield, Loader2, AlertCircle, Info } from 'lucide-react';
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
    <div className="space-y-6 font-lexend">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Court & Criminal Record Check</h2>
        <p className="text-sm text-slate-600 mt-1">Mandatory BGV verification against court databases</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex gap-3">
        <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-slate-700 space-y-2">
          <p className="font-medium">What this check includes</p>
          <ul className="text-slate-600 space-y-1">
            <li>• Criminal records search via authorized court databases</li>
            <li>• Verification of name: <strong>{candidateName ?? 'From your profile'}</strong></li>
            <li>• Uses DOB, father's name, and address from Sections 1 & 2</li>
            <li>• Results typically available within 24-48 hours</li>
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={running || courtCheck?.status === 'queued' || courtCheck?.status === 'verified'}
            onClick={initiate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            {courtCheck?.status === 'queued' ? 'Check In Progress…' : courtCheck?.status === 'verified' ? 'Check Complete' : 'Initiate Court Check'}
          </button>
          {courtCheck && <VerificationBadge status={courtCheck.status} label={statusLabel} summary={courtCheck.result_summary} />}
        </div>
        {courtCheck?.result_summary && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-700">{courtCheck.result_summary}</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium">Non-blocking check</p>
          <p className="mt-1">You can submit your onboarding form regardless of this check status. HR will review the results separately.</p>
        </div>
      </div>
    </div>
  );
}
