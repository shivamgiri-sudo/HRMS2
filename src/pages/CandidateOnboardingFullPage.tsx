import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnboardingFull, STEP_LABELS } from "@/components/onboarding-full/useOnboardingFull";
import type { Step } from "@/components/onboarding-full/useOnboardingFull";
import {
  Step1Welcome,
  Step2Personal,
  Step3AddressKyc,
  Step5Documents,
  Step6Bgv,
  Step7Bank,
} from "@/components/onboarding-full/OnboardingSteps1to5";
import {
  Step8Education,
  Step9ExperienceLang,
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">MAS Callnet · Onboarding</p>
              <h1 className="text-xl font-black text-slate-950 leading-tight">
                {onb.status?.token.full_name ?? "Candidate"} — Joining Form
              </h1>
              <p className="text-xs text-slate-500">
                {onb.status?.token.branch_name || "Branch N/A"} · {onb.status?.token.process_name || "Process N/A"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[11px] text-slate-500 uppercase font-bold">Completion</p>
                <p className="text-2xl font-black text-slate-900">{onb.completion}%</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center">
                <div
                  className="h-10 w-10 rounded-full"
                  style={{
                    background: `conic-gradient(#16a34a ${onb.completion * 3.6}deg, #e2e8f0 0deg)`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Step tabs — scrollable on mobile */}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {(Object.entries(STEP_LABELS) as [string, string][]).map(([n, label]) => {
              const num = Number(n) as Step;
              const isActive = num === onb.step;
              const isDone = num < onb.step;
              return (
                <button
                  key={n}
                  onClick={() => onb.setStep(num)}
                  className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold whitespace-nowrap transition-colors ${
                    isActive ? "bg-slate-950 text-white" :
                    isDone ? "bg-emerald-100 text-emerald-700" :
                    "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {n}. {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-5">
        {onb.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {onb.error}
            <button onClick={() => onb.setError("")} className="ml-2 underline text-xs">dismiss</button>
          </div>
        )}

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
          <Step5Documents
            status={onb.status}
            saving={onb.saving}
            consentAccepted={onb.consentAccepted}
            onUpload={onb.uploadDoc}
            onDelete={onb.deleteDoc}
          />
        )}

        {onb.step === 5 && (
          <Step5Documents
            status={onb.status}
            saving={onb.saving}
            consentAccepted={onb.consentAccepted}
            onUpload={onb.uploadDoc}
            onDelete={onb.deleteDoc}
          />
        )}

        {onb.step === 6 && (
          <Step6Bgv
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
          <Step7Bank
            bank={onb.bank}
            setBank={onb.setBank}
            saving={onb.saving}
            onSave={onb.saveBank}
            onLookupIfsc={onb.lookupIfsc}
          />
        )}

        {onb.step === 8 && (
          <Step8Education
            qual={onb.qual}
            setQual={onb.setQual}
            status={onb.status}
            saving={onb.saving}
            onAdd={onb.addQualification}
          />
        )}

        {onb.step === 9 && (
          <Step9ExperienceLang
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

        {/* Nav footer */}
        <div className="flex justify-between pt-2">
          <Button
            variant="outline"
            disabled={onb.step === 1 || onb.saving}
            onClick={() => onb.setStep((s) => Math.max(1, s - 1) as Step)}
          >
            ← Back
          </Button>
          {onb.step < totalSteps && (
            <Button disabled={onb.saving} onClick={onb.advanceStep}>
              {onb.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next →"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
