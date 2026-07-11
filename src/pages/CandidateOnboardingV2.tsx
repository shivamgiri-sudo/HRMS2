import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, ShieldCheck, Smartphone, LogOut } from 'lucide-react';
import { useOnboardingV2 } from '../components/onboarding-v2/useOnboardingV2';
import { OnboardingV2Sidebar } from '../components/onboarding-v2/OnboardingV2Sidebar';
import { S0_Welcome } from '../components/onboarding-v2/sections/S0_Welcome';
import { S1_PersonalInfo } from '../components/onboarding-v2/sections/S1_PersonalInfo';
import { S2_Address } from '../components/onboarding-v2/sections/S2_Address';
import { S3_KYCDocuments } from '../components/onboarding-v2/sections/S3_KYCDocuments';
import { S4_StatutoryIds } from '../components/onboarding-v2/sections/S4_StatutoryIds';
import { S5_BankDetails } from '../components/onboarding-v2/sections/S5_BankDetails';
import { S6_Qualifications } from '../components/onboarding-v2/sections/S6_Qualifications';
import { S7_WorkExperience } from '../components/onboarding-v2/sections/S7_WorkExperience';
import { S8_FamilyNominees } from '../components/onboarding-v2/sections/S8_FamilyNominees';
import { S9_CourtCheck } from '../components/onboarding-v2/sections/S9_CourtCheck';
import { S10_ReviewSubmit } from '../components/onboarding-v2/sections/S10_ReviewSubmit';

const API_BASE = `${import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055'}/api/candidate/onboarding`;

type CandidateStart = {
  candidateCode?: string;
  candidateName?: string;
  branchName?: string;
  processName?: string;
  mobileMasked?: string;
  mobilePrefilled?: boolean;
};

type ApiResponse<T> = { success: boolean; data: T; message?: string };

function storageKey(token: string) {
  return `candidate_onboarding_session:${token}`;
}

function deviceId() {
  const key = 'candidate_onboarding_device_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  localStorage.setItem(key, id);
  return id;
}

async function api<T>(path: string, options: RequestInit = {}, sessionToken?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { 'x-candidate-session-token': sessionToken } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await res.json().catch(() => ({ message: res.statusText }));
  if (!res.ok || payload.success === false) throw new Error(payload.message ?? res.statusText);
  return payload as T;
}

function CandidateOtpGate({ token, onVerified }: { token: string; onVerified: (sessionToken: string) => void }) {
  const [start, setStart] = useState<CandidateStart | null>(null);
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [phase, setPhase] = useState<'loading' | 'mobile' | 'otp'>('loading');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(storageKey(token));
    if (saved) {
      api<ApiResponse<unknown>>(`/resume?token=${encodeURIComponent(token)}`, { method: 'GET' }, saved)
        .then(() => onVerified(saved))
        .catch(() => {
          localStorage.removeItem(storageKey(token));
          return api<ApiResponse<CandidateStart>>('/start', {
            method: 'POST',
            body: JSON.stringify({ token }),
          }).then((res) => {
            setStart(res.data);
            setPhase('mobile');
          });
        })
        .catch((err) => {
          setError(err.message || 'Unable to start onboarding.');
          setPhase('mobile');
        });
      return;
    }

    api<ApiResponse<CandidateStart>>('/start', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        setStart(res.data);
        setPhase('mobile');
      })
      .catch((err) => {
        setError(err.message || 'Unable to start onboarding.');
        setPhase('mobile');
      });
  }, [token, onVerified]);

  const sendOtp = async () => {
    setSending(true);
    setError('');
    setNotice('');
    try {
      const res = await api<ApiResponse<{ mobileMasked: string; message: string }>>('/send-otp', {
        method: 'POST',
        body: JSON.stringify({ token, mobile: mobile || undefined }),
      });
      setNotice(`OTP sent to ${res.data.mobileMasked || start?.mobileMasked || 'your registered mobile number'}.`);
      setPhase('otp');
    } catch (err: any) {
      setError(err.message || 'Could not send OTP.');
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async () => {
    setSending(true);
    setError('');
    try {
      const res = await api<ApiResponse<{ sessionToken: string }>>('/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ token, mobile: mobile || undefined, otp, deviceId: deviceId() }),
      });
      localStorage.setItem(storageKey(token), res.data.sessionToken);
      onVerified(res.data.sessionToken);
    } catch (err: any) {
      setError(err.message || 'Invalid OTP.');
    } finally {
      setSending(false);
    }
  };

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">Verify mobile number</h1>
            <p className="text-sm text-slate-500">Required before viewing onboarding data.</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-semibold">{start?.candidateName || 'Candidate'}</p>
          <p>{start?.branchName || 'Branch pending'}{start?.processName ? ` | ${start.processName}` : ''}</p>
          {start?.mobileMasked && <p className="mt-1 text-slate-500">Registered mobile: {start.mobileMasked}</p>}
        </div>

        <div className="mt-5 space-y-3">
          {!start?.mobilePrefilled && (
            <div>
              <label className="text-sm font-medium text-slate-700">Mobile number</label>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                className="mt-1 h-11 w-full rounded-md border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="10-digit mobile number"
              />
            </div>
          )}

          {phase === 'otp' && (
            <div>
              <label className="text-sm font-medium text-slate-700">OTP</label>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                className="mt-1 h-11 w-full rounded-md border px-3 text-center text-lg tracking-[0.35em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="000000"
              />
            </div>
          )}

          {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

          {phase === 'mobile' ? (
            <button
              type="button"
              onClick={sendOtp}
              disabled={sending || (!start?.mobilePrefilled && mobile.length !== 10)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send OTP
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={sendOtp}
                disabled={sending}
                className="h-11 rounded-md border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Resend
              </button>
              <button
                type="button"
                onClick={verifyOtp}
                disabled={sending || otp.length !== 6}
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
          <p>Your saved progress, uploaded documents, and verification status are linked to this secure session.</p>
        </div>
      </div>
    </div>
  );
}

function CandidateOnboardingV2Authenticated({ token, sessionToken, onLogout }: { token: string; sessionToken: string; onLogout: () => void }) {
  const {
    currentSection, goToSection,
    status, bgv, loading, error, saving,
    fetchStatus, saveSection, verifyBgv, submitOnboarding,
    bgvCheckFor, hasConsent,
  } = useOnboardingV2(token, sessionToken);

  const completed = useMemo(() => {
    const s = new Set<number>();
    if (hasConsent) s.add(0);
    const p = status?.profile as Record<string, unknown> | null;
    if (p?.employee_name && p?.mobile_number) s.add(1);
    if (p?.permanent_address) s.add(2);
    if (p?.pan_number_masked) s.add(3);
    if (status?.bank) s.add(5);
    if (Array.isArray(status?.qualifications) && status!.qualifications.length > 0) s.add(6);
    if (status?.experience) s.add(7);
    if (status?.family) s.add(8);
    return s;
  }, [hasConsent, status]);

  const candidateInfo = useMemo(() => ({
    full_name: String((status?.profile as any)?.employee_name ?? (status as any)?.token?.full_name ?? ''),
    branch_name: String((status as any)?.token?.branch_name ?? ''),
    process_name: String((status as any)?.token?.process_name ?? ''),
  }), [status]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
          <p className="text-gray-500 text-sm">Loading your onboarding session...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle className="mx-auto text-red-500" size={40} />
          <p className="text-gray-700 font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  const profile = status?.profile as Record<string, unknown> | null;

  const sectionContent = () => {
    switch (currentSection) {
      case 0: return <S0_Welcome token={token} hasConsent={hasConsent} candidateInfo={candidateInfo} onConsented={fetchStatus} />;
      case 1: return <S1_PersonalInfo token={token} initialData={profile} saveSection={saveSection} />;
      case 2: return <S2_Address token={token} initialData={profile} saveSection={saveSection} verifyBgv={verifyBgv} addressDocCheck={bgvCheckFor('address_doc')} />;
      case 3: return <S3_KYCDocuments token={token} initialData={profile} saveSection={saveSection} verifyBgv={verifyBgv} panCheck={bgvCheckFor('pan')} aadhaarCheck={bgvCheckFor('aadhaar')} />;
      case 4: return <S4_StatutoryIds token={token} initialData={profile} saveSection={saveSection} />;
      case 5: return <S5_BankDetails token={token} initialData={status?.bank as Record<string, unknown> | null} saveSection={saveSection} verifyBgv={verifyBgv} bankCheck={bgvCheckFor('bank')} />;
      case 6: return <S6_Qualifications token={token} initialData={(status?.qualifications ?? []) as unknown[]} verifyBgv={verifyBgv} eduCheck={bgvCheckFor('education_doc')} />;
      case 7: return <S7_WorkExperience token={token} initialData={status?.experience as Record<string, unknown> | null} saveSection={saveSection} />;
      case 8: return <S8_FamilyNominees token={token} initialData={status?.family as Record<string, unknown> | null} saveSection={saveSection} />;
      case 9: return <S9_CourtCheck token={token} verifyBgv={verifyBgv} courtCheck={bgvCheckFor('court')} candidateName={String(profile?.employee_name ?? '')} />;
      case 10: return <S10_ReviewSubmit status={status} bgv={bgv} submitOnboarding={submitOnboarding} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <OnboardingV2Sidebar
        current={currentSection}
        completed={completed}
        hasConsent={hasConsent}
        onNavigate={goToSection}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">
              MAS Callnet - Employee Onboarding
            </span>
            {saving && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Loader2 size={11} className="animate-spin" /> Saving...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentSection > 0 && (
              <button
                type="button"
                onClick={() => goToSection(currentSection - 1)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Previous
              </button>
            )}
            {currentSection < 10 && (
              <button
                type="button"
                onClick={() => goToSection(currentSection + 1)}
                className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Next
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
              title="Save and exit"
            >
              <LogOut size={14} />
              Exit
            </button>
          </div>
        </div>

        <div className="p-6 md:p-8 max-w-3xl">
          {sectionContent()}
        </div>
      </main>
    </div>
  );
}

export default function CandidateOnboardingV2() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <AlertCircle className="mx-auto text-red-500" size={40} />
          <p className="text-gray-700 font-semibold">Invalid or expired onboarding link.</p>
          <p className="text-sm text-gray-500">Please use the link from your joining email.</p>
        </div>
      </div>
    );
  }

  const logout = async () => {
    const saved = localStorage.getItem(storageKey(token));
    if (saved) {
      await api('/logout', { method: 'POST' }, saved).catch(() => undefined);
    }
    localStorage.removeItem(storageKey(token));
    setSessionToken(null);
  };

  if (!sessionToken) {
    return <CandidateOtpGate token={token} onVerified={setSessionToken} />;
  }

  return <CandidateOnboardingV2Authenticated token={token} sessionToken={sessionToken} onLogout={logout} />;
}
