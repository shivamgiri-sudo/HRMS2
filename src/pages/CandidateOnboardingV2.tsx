import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
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

export default function CandidateOnboardingV2() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const {
    currentSection, goToSection,
    status, bgv, loading, error, saving,
    fetchStatus, saveSection, verifyBgv, submitOnboarding,
    bgvCheckFor, hasConsent,
  } = useOnboardingV2(token);

  // Determine which sections are "complete enough"
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
    full_name: String((status?.profile as any)?.employee_name ?? ''),
    branch_name: String((status?.profile as any)?.branch_name ?? ''),
    process_name: String((status?.profile as any)?.process_name ?? ''),
  }), [status]);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <Loader2 className="mx-auto animate-spin text-purple-600" size={40} />
          <p className="text-gray-500 text-sm">Loading your onboarding session…</p>
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
        {/* Header bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">
              MAS Callnet — Employee Onboarding
            </span>
            {saving && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Loader2 size={11} className="animate-spin" /> Saving…
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
                ← Previous
              </button>
            )}
            {currentSection < 10 && (
              <button
                type="button"
                onClick={() => goToSection(currentSection + 1)}
                className="px-3 py-1.5 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700"
              >
                Next →
              </button>
            )}
          </div>
        </div>

        {/* Section content */}
        <div className="p-6 md:p-8 max-w-3xl">
          {sectionContent()}
        </div>
      </main>
    </div>
  );
}
