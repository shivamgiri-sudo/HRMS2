import React, { useState } from 'react';
import { CheckCircle, Loader2, Send } from 'lucide-react';
import { VerificationBadge } from '../VerificationBadge';
import { DocumentSubmissionTracker, type DocumentStatus } from '../DocumentSubmissionTracker';
import type { OnboardingStatus, BgvStatus, OnboardingDocument } from '../useOnboardingV2';

interface S10Props {
  status: OnboardingStatus | null;
  bgv: BgvStatus | null;
  submitOnboarding: () => Promise<void>;
}

const CHECKS = [
  { key: 'pan',          label: 'PAN Verification' },
  { key: 'aadhaar',      label: 'Aadhaar Verification' },
  { key: 'bank',         label: 'Bank Verification' },
  { key: 'address_doc',  label: 'Address Doc Verification' },
  { key: 'education_doc',label: 'Education Verification' },
  { key: 'court',        label: 'Court Check' },
];

// Map backend doc_type to human labels and required flag
const DOC_META: Record<string, { label: string; required: boolean }> = {
  cancelled_cheque:     { label: 'Cancelled Cheque / Passbook',   required: true },
  pan_card:             { label: 'PAN Card',                       required: true },
  aadhaar_front:        { label: 'Aadhaar Front',                  required: true },
  aadhaar_back:         { label: 'Aadhaar Back',                   required: false },
  passport:             { label: 'Passport',                       required: false },
  driving_license:      { label: 'Driving License',               required: false },
  voter_id:             { label: 'Voter ID',                       required: false },
  education_certificate:{ label: 'Education Certificate',          required: false },
  experience_letter:    { label: 'Experience Letter',              required: false },
  photo:                { label: 'Photograph',                     required: true },
};

function buildDocStatuses(rawDocs: OnboardingDocument[]): DocumentStatus[] {
  // Start from all expected docs (required ones shown even if not uploaded)
  const result: DocumentStatus[] = Object.entries(DOC_META).map(([docType, meta]) => {
    const uploaded = rawDocs.find(d => d.doc_type === docType);
    if (!uploaded) {
      return { docType, label: meta.label, required: meta.required, status: 'not_started' };
    }
    const status: DocumentStatus['status'] =
      uploaded.document_status === 'verified'      ? 'verified' :
      uploaded.document_status === 'rejected'      ? 'failed' :
      uploaded.document_status === 'name_mismatch' ? 'name_mismatch' :
      'uploaded';
    return {
      docType,
      label: meta.label,
      required: meta.required,
      status,
      uploadedAt: uploaded.uploaded_at,
      verificationStatus: uploaded.document_status === 'verified' ? 'verified' :
                          uploaded.document_status === 'name_mismatch' ? 'name_mismatch' : 'pending',
    };
  });
  // Also surface any uploaded docs not in the meta map
  rawDocs.forEach(d => {
    if (!DOC_META[d.doc_type]) {
      const status: DocumentStatus['status'] =
        d.document_status === 'verified'      ? 'verified' :
        d.document_status === 'rejected'      ? 'failed' :
        d.document_status === 'name_mismatch' ? 'name_mismatch' :
        'uploaded';
      result.push({
        docType: d.doc_type,
        label: d.doc_name || d.doc_type,
        required: false,
        status,
        uploadedAt: d.uploaded_at,
      });
    }
  });
  return result;
}

export function S10_ReviewSubmit({ status, bgv, submitOnboarding }: S10Props) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docStatuses = buildDocStatuses((status?.documents ?? []) as OnboardingDocument[]);
  const profile = status?.profile as Record<string, unknown> | null;
  const isAlreadySubmitted = String(profile?.profile_status ?? '') === 'submitted';

  const hasBank = !!(status?.bank as Record<string, unknown> | null);
  const hasQualifications = Array.isArray(status?.qualifications) && (status.qualifications as unknown[]).length > 0;

  const missingItems: string[] = [];
  if (!profile?.employee_name || !profile?.mobile_number || !profile?.pan_number_masked) {
    missingItems.push('Personal information (name, mobile, PAN)');
  }
  if (!hasBank) missingItems.push('Bank details (Section 5)');
  if (!hasQualifications) missingItems.push('Qualifications (Section 6 — at least one required)');

  const mandatoryFilled = missingItems.length === 0;

  const doSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitOnboarding();
      setSubmitted(true);
    } catch {
      setError('Submission failed. Please check your details and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted || isAlreadySubmitted) {
    return (
      <div className="max-w-lg mx-auto text-center space-y-4 py-12">
        <CheckCircle className="mx-auto text-green-500" size={56} />
        <h2 className="text-xl font-bold text-gray-800">Form Submitted Successfully!</h2>
        <p className="text-gray-500 text-sm">Your onboarding details have been submitted. Our HR team will review your information and reach out for the next steps.</p>
        <p className="text-xs text-gray-400">You may close this window.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-800">Review & Submit</h2>

      {/* Profile summary */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm text-gray-700">Your Details</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div><span className="text-gray-500">Name:</span> <strong>{String(profile?.employee_name ?? '—')}</strong></div>
          <div><span className="text-gray-500">Mobile:</span> <strong>{String(profile?.mobile_number ?? '—')}</strong></div>
          <div><span className="text-gray-500">PAN:</span> <strong>{String(profile?.pan_number_masked ?? '—')}</strong></div>
          <div><span className="text-gray-500">Aadhaar:</span> <strong>{String(profile?.aadhaar_number_masked ?? '—')}</strong></div>
          <div><span className="text-gray-500">DOB:</span> <strong>{String(profile?.date_of_birth ?? '—')}</strong></div>
        </div>
      </div>

      {/* Document Submission Tracker */}
      {docStatuses.length > 0 && (
        <DocumentSubmissionTracker documents={docStatuses} section={10} />
      )}

      {/* BGV status table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <p className="font-semibold text-sm text-gray-700">Verification Status (non-blocking — does not affect submission)</p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {CHECKS.map(({ key, label }) => {
              const check = bgv?.checks.find(c => c.check_type === key);
              return (
                <tr key={key} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5 text-gray-600">{label}</td>
                  <td className="px-4 py-2.5 text-right">
                    <VerificationBadge status={check?.status ?? 'not_run'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">BGV Score</span>
          <span className="font-bold text-gray-800">{bgv?.score ?? 0}/100</span>
        </div>
      </div>

      {missingItems.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
          <p className="font-semibold mb-1">Please complete these sections before submitting:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {missingItems.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={!mandatoryFilled || submitting}
        onClick={doSubmit}
        className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {submitting ? 'Submitting…' : 'Submit Onboarding Form'}
      </button>
      <p className="text-xs text-gray-400">By submitting, you confirm that all information provided is accurate and complete.</p>
    </div>
  );
}
