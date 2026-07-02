import { useState, useEffect, useCallback, useRef } from 'react';

const BASE = `${import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055'}/api/ats`;
const API = `${BASE}/onboarding-full`;
const BGV_API = `${BASE}/bgv`;

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface BgvCheck {
  check_type: string;
  status: 'verified' | 'mismatch' | 'failed' | 'manual_review' | 'queued' | 'not_run';
  result_summary?: string;
  matched_name?: string;
  verified_at?: string;
}

export interface OnboardingDocument {
  id: string;
  doc_type: string;
  doc_name: string;
  file_original_name: string;
  document_status: 'pending' | 'verified' | 'rejected' | 'name_mismatch';
  uploaded_at: string;
}

export interface OnboardingStatus {
  profile: Record<string, unknown> | null;
  bank: Record<string, unknown> | null;
  qualifications: unknown[];
  experience: Record<string, unknown> | null;
  family: Record<string, unknown> | null;
  documents: OnboardingDocument[];
  submission_log: unknown[];
}

export interface BgvStatus {
  consent: Record<string, unknown> | null;
  checks: BgvCheck[];
  score: number;
  overall_status: string;
  missing_mandatory_checks: string[];
}

export function useOnboardingV2(token: string | null) {
  const [currentSection, setCurrentSection] = useState(0);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [bgv, setBgv] = useState<BgvStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    const [onbRes, bgvRes] = await Promise.all([
      apiFetch<{ success: boolean; data: OnboardingStatus }>(`${API}/status?token=${token}`),
      apiFetch<{ success: boolean; data: BgvStatus }>(`${BGV_API}/status?token=${token}`),
    ]);
    if (onbRes.success) setStatus(onbRes.data);
    if (bgvRes.success) setBgv(bgvRes.data);
    const stepIdx = (onbRes.data?.profile as Record<string, unknown> | null)?.current_step_idx;
    if (typeof stepIdx === 'number' && !initializedRef.current) {
      setCurrentSection(stepIdx);
    }
    initializedRef.current = true;
  }, [token]);

  const refreshBgvStatus = useCallback(async () => {
    if (!token) return;
    const res = await apiFetch<{ success: boolean; data: BgvStatus }>(`${BGV_API}/status?token=${token}`);
    if (res.success) setBgv(res.data);
  }, [token]);

  useEffect(() => {
    if (!token) { setLoading(false); setError('Invalid or missing onboarding token.'); return; }
    setLoading(true);
    fetchStatus()
      .catch(() => setError('Failed to load your onboarding session. Please refresh the page.'))
      .finally(() => setLoading(false));
  }, [token, fetchStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('step') === 'digilocker' && token) {
      refreshBgvStatus().then(() => {
        const clean = `${window.location.pathname}?token=${token}`;
        window.history.replaceState({}, '', clean);
      });
    }
  }, [token, refreshBgvStatus]);

  const goToSection = useCallback(async (idx: number) => {
    setCurrentSection(idx);
    if (!token) return;
    fetch(`${API}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, stepIdx: idx }),
    }).catch(() => {});
  }, [token]);

  const saveSection = useCallback(async (endpoint: string, payload: Record<string, unknown>) => {
    if (!token) return;
    setSaving(true);
    try {
      await apiFetch(`${API}/${endpoint}`, { method: 'POST', body: JSON.stringify({ token, ...payload }) });
      await fetchStatus();
    } finally {
      setSaving(false);
    }
  }, [token, fetchStatus]);

  const verifyBgv = useCallback(async (endpoint: string, payload?: Record<string, unknown>) => {
    if (!token) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; data: BgvStatus }>(`${BGV_API}/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ token, ...payload }),
      });
      if (res.success) setBgv(res.data);
    } finally {
      setSaving(false);
    }
  }, [token]);

  const submitOnboarding = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    try {
      await apiFetch(`${API}/submit`, { method: 'POST', body: JSON.stringify({ token }) });
      await fetchStatus();
    } finally {
      setSaving(false);
    }
  }, [token, fetchStatus]);

  const bgvCheckFor = useCallback((checkType: string): BgvCheck | undefined => {
    return bgv?.checks.find(c => c.check_type === checkType);
  }, [bgv]);

  const hasConsent = !!(bgv?.consent && (bgv.consent as Record<string, unknown>).consent_status === 'granted');

  return {
    currentSection,
    goToSection,
    status,
    bgv,
    loading,
    error,
    saving,
    fetchStatus,
    refreshBgvStatus,
    saveSection,
    verifyBgv,
    submitOnboarding,
    bgvCheckFor,
    hasConsent,
  };
}
