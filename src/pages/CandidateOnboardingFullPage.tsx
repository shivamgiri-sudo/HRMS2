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
  Step10Statutory,
} from "@/components/onboarding-full/OnboardingSteps6to10";

export default function CandidateOnboardingFullPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const onb = useOnboardingFull(token);

  if (onb.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (onb.error && !onb.status) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center">
        <div>
          <p className="text-red-600 font-bold text-lg">{onb.error}</p>
          <p className="text-slate-500 text-sm mt-2">Please refresh or contact HR if the issue persists.</p>
        </div>
      </div>
    );
  }

  if (onb.submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 px-6 text-center">
        <CheckCircle2 className="h-20 w-20 text-emerald-500" />
        <h1 className="text-3xl font-black text-slate-950">Onboarding Submitted!</h1>
        <p className="text-slate-600 max-w-md">
          Your joining details have been submitted successfully. HR will verify and continue your onboarding process.
          You will receive confirmation on your registered email and mobile.
        </p>
      </div>
    );
  }

  const totalSteps = 10 as const;
  const stepLabelsArray = (Object.values(STEP_LABELS) as string[]);

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
        >
          ← Back
        </Button>
      }
      footerRight={
        onb.step < totalSteps ? (
          <Button size="sm" disabled={onb.saving} onClick={onb.advanceStep}>
            {onb.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next →"}
          </Button>
        ) : undefined
      }
    >
      {onb.step === 1 && <Step1Welcome status={onb.status} />}

      {onb.step === 2 && (
        <Step2Personal
          employee={onb.employee}
          setEmployee={onb.setEmployee}
          saving={onb.saving}
          onSave={onb.saveEmployee}
        />
      )}

      {onb.step === 3 && (
        <Step3AddressKyc
          employee={onb.employee}
          setEmployee={onb.setEmployee}
          saving={onb.saving}
          onSave={onb.saveEmployee}
        />
      )}

      {/* Step 4: Identity Docs — placeholder (maps to Document upload step) */}
      {onb.step === 4 && (
        <Step4Documents
          status={onb.status}
          saving={onb.saving}
          consentAccepted={onb.consentAccepted}
          onUpload={onb.uploadDoc}
          onDelete={onb.deleteDoc}
        />
      )}

      {onb.step === 5 && (
        <Step4Documents
          status={onb.status}
          saving={onb.saving}
          consentAccepted={onb.consentAccepted}
          onUpload={onb.uploadDoc}
          onDelete={onb.deleteDoc}
        />
      )}

      {onb.step === 6 && (
        <Step5Bgv
          bgv={onb.bgv}
          consentAccepted={onb.consentAccepted}
          saving={onb.saving}
          onConsent={onb.grantConsent}
          onVerifyAadhaar={onb.verifyAadhaar}
          onVerifyPan={onb.verifyPan}
          onVerifyBank={onb.verifyBank}
          onDigilocker={onb.startDigilocker}
        />
      )}

      {onb.step === 7 && (
        <Step6Bank
          bank={onb.bank}
          setBank={onb.setBank}
          saving={onb.saving}
          onSave={onb.saveBank}
          onLookupIfsc={onb.lookupIfsc}
        />
      )}

      {onb.step === 8 && (
        <Step7Education
          qual={onb.qual}
          setQual={onb.setQual}
          status={onb.status}
          saving={onb.saving}
          onAdd={onb.addQualification}
        />
      )}

      {onb.step === 9 && (
        <Step8Experience
          experience={onb.experience}
          setExperience={onb.setExperience}
          family={onb.family}
          setFamily={onb.setFamily}
          languages={onb.languages}
          setLanguages={onb.setLanguages}
          saving={onb.saving}
          onSave={onb.saveExperience}
        />
      )}

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
          onSendOtp={onb.sendOtp}
          onVerifyOtp={onb.verifyOtp}
          onSave={onb.saveStatutory}
          onSubmit={onb.submit}
        />
      )}
    </OnboardingMobileShell>
  );
}
