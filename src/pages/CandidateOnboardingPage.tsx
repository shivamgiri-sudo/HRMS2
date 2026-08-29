// src/pages/CandidateOnboardingPage.tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { LiveSelfieCapture } from '@/components/onboarding-full/LiveSelfieCapture';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface PreFill {
  full_name: string; mobile: string; email: string;
  branch_name?: string; applied_for_process?: string;
}

export default function CandidateOnboardingPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [step, setStep] = useState<Step>(1);
  const [prefill, setPrefill] = useState<PreFill | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    father_name: '', date_of_birth: '',
    current_address: '', permanent_address: '',
    aadhar_number: '', pan_number: '', uan_number: '',
    bank_account_no: '', bank_ifsc: '', bank_name: '',
    emergency_contact_name: '', emergency_contact_mobile: '',
    resume_url: '',
  });

  // A live selfie is a mandatory document, not a form field — it's captured
  // via the webcam and uploaded to candidate_onboarding_document (doc_type
  // "Live Selfie"), the same store and mandatory-gate check the canonical
  // full-onboarding flow uses. submitProfile() now rejects submission
  // without one; see ats.onboarding.service.ts.
  const [selfieCaptured, setSelfieCaptured] = useState(false);
  const [selfieUploading, setSelfieUploading] = useState(false);
  const [selfieError, setSelfieError] = useState('');

  useEffect(() => {
    if (!token) { setTokenError('No onboarding token provided.'); setLoading(false); return; }
    hrmsApi.get<{ data: PreFill }>(`/api/ats/onboarding/validate-token?token=${token}`)
      .then(r => { setPrefill(r.data); setLoading(false); })
      .catch((e: any) => { setTokenError(e?.response?.data?.error ?? 'Invalid or expired token.'); setLoading(false); });
  }, [token]);

  const set = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSelfieCapture = async (file: File) => {
    setSelfieUploading(true);
    setSelfieError('');
    try {
      const fd = new FormData();
      fd.append('token', token);
      fd.append('docType', 'Live Selfie');
      fd.append('docName', 'Live Selfie (Identity Verification)');
      fd.append('pageNo', '');
      fd.append('file', file);
      // Same document-upload endpoint the canonical full-onboarding flow
      // uses (see useOnboardingFull.ts's uploadDoc) — token-scoped, not
      // step-scoped, so it works unchanged against a legacy-flow token too.
      await hrmsApi.postForm('/api/ats/onboarding-full/documents', fd);
      setSelfieCaptured(true);
    } catch (e: any) {
      setSelfieError(e?.response?.data?.error ?? 'Selfie upload failed. Please try again.');
    } finally {
      setSelfieUploading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await hrmsApi.post('/api/ats/onboarding/submit-profile', { token, ...form });
      setSubmitted(true);
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /></div>;
  if (tokenError) return <div className="flex items-center justify-center h-screen text-red-500 text-center p-8">{tokenError}</div>;
  if (submitted) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <CheckCircle2 className="text-green-500 w-16 h-16" />
      <h2 className="text-xl font-semibold">Profile Submitted Successfully</h2>
      <p className="text-muted-foreground">Your HR team will review your details and reach out shortly.</p>
    </div>
  );

  const stepTitles: Record<Step, string> = {
    1: 'Welcome', 2: 'Personal Details', 3: 'Statutory Details',
    4: 'Bank Details', 5: 'Emergency Contact', 6: 'Documents', 7: 'Review & Submit',
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex gap-1 mb-2">
            {([1,2,3,4,5,6,7] as Step[]).map(s => (
              <div key={s} className={`h-1.5 flex-1 rounded ${s <= step ? 'bg-blue-600' : 'bg-gray-200'}`} />
            ))}
          </div>
          <CardTitle>Step {step}: {stepTitles[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {step === 1 && (
            <>
              <p>Welcome, <strong>{prefill?.full_name}</strong>!</p>
              <p className="text-sm text-muted-foreground">
                Branch: {prefill?.branch_name ?? 'N/A'} | Process: {prefill?.applied_for_process ?? 'N/A'}
              </p>
              <p className="text-sm">Please complete your profile to finish the joining process. This takes about 5 minutes.</p>
            </>
          )}

          {step === 2 && (
            <>
              <div><Label>Full Name</Label><Input value={prefill?.full_name} disabled /></div>
              <div><Label>Mobile</Label><Input value={prefill?.mobile} disabled /></div>
              <div><Label>Email</Label><Input value={prefill?.email} disabled /></div>
              <div><Label>Father's Name *</Label><Input value={form.father_name} onChange={e => set('father_name', e.target.value)} /></div>
              <div><Label>Date of Birth *</Label><Input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></div>
              <div><Label>Current Address *</Label><Input value={form.current_address} onChange={e => set('current_address', e.target.value)} /></div>
              <div><Label>Permanent Address</Label><Input value={form.permanent_address} onChange={e => set('permanent_address', e.target.value)} placeholder="Leave blank if same as current" /></div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">All fields on this page are optional.</p>
              <div><Label>Aadhaar Number</Label><Input value={form.aadhar_number} onChange={e => set('aadhar_number', e.target.value)} placeholder="12-digit Aadhaar" /></div>
              <div><Label>PAN Number</Label><Input value={form.pan_number} onChange={e => set('pan_number', e.target.value)} placeholder="ABCDE1234F" /></div>
              <div><Label>UAN Number</Label><Input value={form.uan_number} onChange={e => set('uan_number', e.target.value)} placeholder="If applicable" /></div>
            </>
          )}

          {step === 4 && (
            <>
              <div><Label>Bank Account Number *</Label><Input value={form.bank_account_no} onChange={e => set('bank_account_no', e.target.value)} /></div>
              <div><Label>IFSC Code *</Label><Input value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value)} placeholder="e.g. SBIN0001234" /></div>
              <div><Label>Bank Name *</Label><Input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} /></div>
            </>
          )}

          {step === 5 && (
            <>
              <div><Label>Emergency Contact Name *</Label><Input value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} /></div>
              <div><Label>Emergency Contact Mobile *</Label><Input type="tel" value={form.emergency_contact_mobile} onChange={e => set('emergency_contact_mobile', e.target.value)} /></div>
            </>
          )}

          {step === 6 && (
            <>
              <p className="text-sm text-muted-foreground">Provide a resume link if available, and complete the mandatory live selfie below. HR will follow up for hard copies during joining.</p>
              <div><Label>Resume URL</Label><Input value={form.resume_url} onChange={e => set('resume_url', e.target.value)} placeholder="https://..." /></div>
              <div>
                <Label>Live Selfie *</Label>
                <LiveSelfieCapture onCapture={handleSelfieCapture} captured={selfieCaptured} disabled={selfieUploading} />
                {selfieError && <p className="text-xs text-red-600 mt-1">{selfieError}</p>}
              </div>
            </>
          )}

          {step === 7 && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Review your details before submitting:</p>
              <p><strong>Name:</strong> {prefill?.full_name}</p>
              <p><strong>Father's Name:</strong> {form.father_name || '—'}</p>
              <p><strong>Date of Birth:</strong> {form.date_of_birth || '—'}</p>
              <p><strong>Bank:</strong> {form.bank_name} — {form.bank_account_no || '—'}</p>
              <p><strong>IFSC:</strong> {form.bank_ifsc || '—'}</p>
              <p><strong>Emergency Contact:</strong> {form.emergency_contact_name} ({form.emergency_contact_mobile})</p>
            </div>
          )}

          <div className="flex justify-between pt-2">
            {step > 1 && <Button variant="outline" onClick={() => setStep(s => (s - 1) as Step)}>Back</Button>}
            {step < 7 && (
              <Button
                className="ml-auto"
                onClick={() => setStep(s => (s + 1) as Step)}
                disabled={step === 6 && !selfieCaptured}
              >
                Next
              </Button>
            )}
            {step === 7 && (
              <Button className="ml-auto" onClick={handleSubmit} disabled={loading || !selfieCaptured}>
                {loading ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : null}
                Submit Profile
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
