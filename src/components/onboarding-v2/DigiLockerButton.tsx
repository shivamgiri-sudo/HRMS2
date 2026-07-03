import React, { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

const ONBOARDING_API = `${import.meta.env.VITE_HRMS_API_URL ?? 'http://localhost:5055'}/api/ats/onboarding-full`;

interface DigiLockerButtonProps {
  token: string;
  requestedDocuments?: string[];
  label?: string;
  variant?: 'primary' | 'outline';
}

const ALL_DOCS = ['AADHAAR', 'DRIVING_LICENSE', 'VOTER_ID', 'CBSE_10', 'CBSE_12', 'DEGREE', 'PASSPORT'];

export function DigiLockerButton({
  token,
  requestedDocuments = ALL_DOCS,
  label = 'Connect DigiLocker',
  variant = 'outline',
}: DigiLockerButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ONBOARDING_API}/digilocker/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, requestedDocuments }),
      });
      const data = await res.json();
      const nextUrl = data?.data?.redirectUrl ?? data?.data?.verificationUrl;
      if (data.success && nextUrl) {
        window.location.href = nextUrl;
      } else {
        setError('Could not start DigiLocker session. Please try again.');
      }
    } catch {
      setError('DigiLocker unavailable. Please use the manual upload option below.');
    } finally {
      setLoading(false);
    }
  };

  const base = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50';
  const styles = variant === 'primary'
    ? `${base} bg-blue-600 text-white hover:bg-blue-700`
    : `${base} border-2 border-blue-300 text-blue-700 hover:bg-blue-50`;

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={loading} className={styles}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
        {loading ? 'Connecting…' : label}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
