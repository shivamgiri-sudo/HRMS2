import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingFull, STEP_LABELS } from "@/components/onboarding-full/useOnboardingFull";
import type { Step } from "@/components/onboarding-full/useOnboardingFull";
import OnboardingMobileShell from "@/components/onboarding/OnboardingMobileShell";
import {
  Step1Welcome,
  Step2Personal,
  Step3AddressKyc,
  Step4Documents,
  Step5Bgv,
  Step6Bank,
} from "@/components/onboarding-full/OnboardingSteps1to5";
import {
  Step7Education,
  Step8Experience,
  Step9FamilyLang,
  Step10Statutory,
} from "@/components/onboarding-full/OnboardingSteps6to10";

export default function CandidateOnboardingFullPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const onb = useOnboardingFull(token);

  if (onb.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
          <p className="text-slate-500 font-semibold text-sm">Loading your onboarding form…</p>
        </div>
      </div>
    );
  }

  if (onb.error && !onb.status) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center bg-slate-50">
        <div className="max-w-sm space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <span className="text-3xl">⚠️</span>
          </div>
          <p className="text-red-600 font-bold text-lg">{onb.error}</p>
          <p className="text-slate-500 text-sm">Please refresh the page or contact HR if the issue persists.</p>
          <Button onClick={() => window.location.reload()} variant="outline" className="mt-2">
            Refresh Page
          </Button>
        </div>
      </div>
    );
  }

  if (onb.submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-br from-emerald-50 to-blue-50 px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center shadow-lg">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-slate-950">Onboarding Submitted!</h1>
          <p className="text-slate-600 max-w-md mt-3 leading-relaxed">
            Your joining details have been submitted successfully. HR will verify and continue your onboarding process.
            You will receive confirmation on your registered email and mobile number shortly.
          </p>
        </div>
        <div className="rounded-xl border-2 border-emerald-200 bg-white p-5 max-w-sm w-full text-left space-y-2 shadow-sm">
          <p className="text-sm font-bold text-slate-700">What happens next?</p>
          <div className="space-y-1.5">
            {[
              "HR team reviews your submitted profile",
              "Background verification is processed",
              "You receive confirmation call/email from HR",
              "Joining date and offer letter communicated",
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 font-black flex items-center justify-center">{i + 1}</span>
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const totalSteps = 10 as const;
  const stepLabelsArray = Object.values(STEP_LABELS) as string[];

  return (
    <OnboardingMobileShell
      currentStep={onb.step}
      totalSteps={totalSteps}
      candidateName={onb.status?.token.full_name ?? "Candidate"}
      branchProcess={
        [onb.status?.token.branch_name, onb.status?.token.process_name]
          .filter(Boolean).join(" · ") || undefined
      }
      completion={onb.completion}
      stepLabels={stepLabelsArray}
      onStepClick={(n) => onb.setStep(n as Step)}
      saving={onb.saving}
      error={onb.error}
      onDismissError={() => onb.setError("")}
      footerLeft={
        <Button
          variant="outline"
          size="sm"
          disabled={onb.step === 1 || onb.saving}
          onClick={() => onb.setStep((s) => Math.max(1, s - 1) as Step)}
          className="min-h-[44px] px-5 font-semibold rounded-xl border-2"
        >
          ← Back
        </Button>
      }
      footerRight={
        onb.step < totalSteps ? (
          <Button
            size="sm"
            disabled={onb.saving}
            onClick={onb.advanceStep}
            className="min-h-[44px] px-6 font-bold bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md"
          >
            {onb.saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Next →
          </Button>
        ) : undefined
      }
    >
      {/* Step 1: Welcome */}
      {onb.step === 1 && <Step1Welcome status={onb.status} />}

      {/* Step 2: Personal Details */}
      {onb.step === 2 && (
        <Step2Personal
          employee={onb.employee}
          setEmployee={onb.setEmployee}
          saving={onb.saving}
          onSave={onb.saveEmployee}
        />
      )}

      {/* Step 3: Address & KYC */}
      {onb.step === 3 && (
        <Step3AddressKyc
          employee={onb.employee}
          setEmployee={onb.setEmployee}
          saving={onb.saving}
          onSave={onb.saveEmployee}
        />
      )}

      {/* Step 4: Document Upload */}
      {onb.step === 4 && (
        <Step4Documents
          status={onb.status}
          saving={onb.saving}
          consentAccepted={onb.consentAccepted}
          onUpload={onb.uploadDoc}
          onDelete={onb.deleteDoc}
        />
      )}

      {/* Step 5: BGV Consent & Verification */}
      {onb.step === 5 && (
        <Step5Bgv
          bgv={onb.bgv}
          bgvApiAvailable={onb.bgvApiAvailable}
          consentAccepted={onb.consentAccepted}
          saving={onb.saving}
          onConsent={onb.grantConsent}
          onVerifyAadhaar={onb.verifyAadhaar}
          onVerifyPan={onb.verifyPan}
          onVerifyBank={onb.verifyBank}
          onVerifyUan={onb.verifyUan}
          onDigilocker={onb.startDigilocker}
        />
      )}

      {/* Step 6: Bank Details */}
      {onb.step === 6 && (
        <Step6Bank
          bank={onb.bank}
          setBank={onb.setBank}
          saving={onb.saving}
          onSave={onb.saveBank}
          onLookupIfsc={onb.lookupIfsc}
        />
      )}

      {/* Step 7: Education */}
      {onb.step === 7 && (
        <Step7Education
          qual={onb.qual}
          setQual={onb.setQual}
          status={onb.status}
          saving={onb.saving}
          onAdd={onb.addQualification}
        />
      )}

      {/* Step 8: Work Experience */}
      {onb.step === 8 && (
        <Step8Experience
          experience={onb.experience}
          setExperience={onb.setExperience}
          saving={onb.saving}
          onSave={onb.saveExperience}
        />
      )}

      {/* Step 9: Family & Language */}
      {onb.step === 9 && (
        <Step9FamilyLang
          family={onb.family}
          setFamily={onb.setFamily}
          languages={onb.languages}
          setLanguages={onb.setLanguages}
          saving={onb.saving}
          onSave={onb.saveExperience}
        />
      )}

      {/* Step 10: Statutory & Submit */}
      {onb.step === 10 && (
        <Step10Statutory
          statutory={onb.statutory}
          setStatutory={onb.setStatutory}
          otpSent={onb.otpSent}
          otpVerified={onb.otpVerified}
          otpCode={onb.otpCode}
          setOtpCode={onb.setOtpCode}
          saving={onb.saving}
          employee={onb.employee}
          bank={onb.bank}
          status={onb.status}
          bgv={onb.bgv}
          completion={onb.completion}
          pfOptOutElected={onb.pfOptOutElected}
          pfOptOutSaving={onb.pfOptOutSaving}
          pfOptOutConsented={onb.pfOptOutConsented}
          pfOptOutConsentedAt={onb.pfOptOutConsentedAt}
          onPfOptOutConsent={onb.pfOptOutConsent}
          onSendOtp={onb.sendOtp}
          onVerifyOtp={onb.verifyOtp}
          onSave={onb.saveStatutory}
          onSubmit={onb.submit}
        />
      )}
    </OnboardingMobileShell>
  );
}
