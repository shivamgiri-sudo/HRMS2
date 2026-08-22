/**
 * Candidate Onboarding Full Page V2 — Redesigned UI
 *
 * Uses the SAME useOnboardingFull hook (all backend logic unchanged).
 * Only the UI components are redesigned with MAS HRMS design patterns.
 *
 * TEST PAGE — for local testing before production deployment.
 */

import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, Home, User, MapPin, FileImage, ShieldCheck, Landmark, GraduationCap, Briefcase, Users, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useOnboardingFull, STEP_LABELS } from "@/components/onboarding-full/useOnboardingFull";
import type { Step } from "@/components/onboarding-full/useOnboardingFull";

// Import ALL V2 redesigned components
import {
  Step1Welcome,
  Step2Personal,
  Step3AddressKyc,
  Step4Documents,
  Step5Bgv,
  Step6Bank,
} from "@/components/onboarding-full/OnboardingSteps1to5V2";
import {
  Step7Education,
  Step8Experience,
  Step9FamilyLang,
  Step10Statutory,
} from "@/components/onboarding-full/OnboardingSteps6to10V2";

// Step configuration with colors
const STEPS = [
  { id: 1, title: "Welcome", icon: Home, color: "blue" },
  { id: 2, title: "Personal", icon: User, color: "indigo" },
  { id: 3, title: "Address", icon: MapPin, color: "purple" },
  { id: 4, title: "Documents", icon: FileImage, color: "pink" },
  { id: 5, title: "BGV", icon: ShieldCheck, color: "violet" },
  { id: 6, title: "Bank", icon: Landmark, color: "blue" },
  { id: 7, title: "Education", icon: GraduationCap, color: "cyan" },
  { id: 8, title: "Experience", icon: Briefcase, color: "pink" },
  { id: 9, title: "Family", icon: Users, color: "teal" },
  { id: 10, title: "Submit", icon: Send, color: "emerald" },
] as const;

const STEP_COLORS: Record<string, { gradient: string; bg: string; border: string; text: string }> = {
  blue: { gradient: "from-blue-600 to-indigo-600", bg: "bg-blue-600", border: "border-blue-200", text: "text-blue-600" },
  indigo: { gradient: "from-indigo-600 to-purple-600", bg: "bg-indigo-600", border: "border-indigo-200", text: "text-indigo-600" },
  purple: { gradient: "from-purple-600 to-violet-600", bg: "bg-purple-600", border: "border-purple-200", text: "text-purple-600" },
  pink: { gradient: "from-pink-600 to-rose-600", bg: "bg-pink-600", border: "border-pink-200", text: "text-pink-600" },
  violet: { gradient: "from-violet-600 to-purple-600", bg: "bg-violet-600", border: "border-violet-200", text: "text-violet-600" },
  cyan: { gradient: "from-cyan-600 to-teal-600", bg: "bg-cyan-600", border: "border-cyan-200", text: "text-cyan-600" },
  teal: { gradient: "from-teal-600 to-emerald-600", bg: "bg-teal-600", border: "border-teal-200", text: "text-teal-600" },
  emerald: { gradient: "from-emerald-600 to-green-600", bg: "bg-emerald-600", border: "border-emerald-200", text: "text-emerald-600" },
};

export default function CandidateOnboardingFullPageV2() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  // SAME HOOK — all backend logic unchanged
  const onb = useOnboardingFull(token);

  // Loading state
  if (onb.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 flex items-center justify-center mx-auto shadow-lg">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
          <div>
            <p className="text-slate-900 font-bold">Loading your onboarding form…</p>
            <p className="text-slate-500 text-sm">Please wait</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (onb.error && !onb.status) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
        <div className="max-w-md text-center space-y-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 flex items-center justify-center mx-auto shadow-lg">
            <span className="text-4xl">⚠️</span>
          </div>
          <div>
            <p className="text-rose-600 font-black text-xl">{onb.error}</p>
            <p className="text-slate-500 text-sm mt-2">Please refresh the page or contact HR if the issue persists.</p>
          </div>
          <Button
            onClick={() => window.location.reload()}
            className="min-h-[48px] px-6 bg-gradient-to-r from-rose-600 to-red-600 text-white font-bold rounded-xl"
          >
            Refresh Page
          </Button>
        </div>
      </div>
    );
  }

  // Submitted state
  if (onb.submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-6 text-center">
        <img
          src="/mcn-logo.png"
          alt="Mas Callnet India Private Limited"
          className="h-14 w-auto object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="w-28 h-28 rounded-3xl bg-gradient-to-r from-emerald-500 to-green-600 flex items-center justify-center shadow-2xl">
          <CheckCircle2 className="h-16 w-16 text-white" />
        </div>
        <div>
          <h1 className="text-4xl font-black text-slate-950">Onboarding Submitted!</h1>
          <p className="text-slate-600 max-w-md mt-4 leading-relaxed">
            Your joining details have been submitted successfully. HR will verify and continue your onboarding process.
          </p>
        </div>
        <div className="rounded-2xl border-2 border-emerald-200 bg-white/95 backdrop-blur-sm p-6 max-w-sm w-full text-left shadow-lg">
          <p className="text-sm font-bold text-slate-800 mb-4">What happens next?</p>
          <div className="space-y-3">
            {[
              "HR team reviews your submitted profile",
              "Background verification is processed",
              "You receive confirmation call/email",
              "Joining date and offer letter communicated",
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-3 text-sm text-slate-600">
                <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 font-black flex items-center justify-center text-xs">
                  {i + 1}
                </span>
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const currentStep = STEPS.find(s => s.id === onb.step)!;
  const stepColor = STEP_COLORS[currentStep.color];
  const progress = (onb.step / 10) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {/* Demo Banner */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 text-white p-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5" />
          <span className="font-bold text-sm">V2 Design Test</span>
          <span className="text-white/70 text-xs">| MAS HRMS Design Patterns</span>
        </div>
      </div>

      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">
                {onb.status?.token.full_name || "Candidate"}
              </p>
              <p className="text-xs text-slate-500">
                {[onb.status?.token.branch_name, onb.status?.token.process_name].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900">Step {onb.step} of 10</p>
              <p className="text-xs text-slate-500">{onb.completion}% Complete</p>
            </div>
          </div>
          <Progress value={progress} className="h-2" />

          {/* Step indicators */}
          <div className="flex gap-1.5 mt-3 overflow-x-auto pb-2">
            {STEPS.map((s) => {
              const sc = STEP_COLORS[s.color];
              const isActive = s.id === onb.step;
              const isComplete = s.id < onb.step || onb.sectionComplete[s.id as Step];
              return (
                <button
                  key={s.id}
                  onClick={() => onb.setStep(s.id as Step)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 transition-all text-xs font-semibold whitespace-nowrap ${
                    isActive
                      ? `${sc.border} bg-white ${sc.text}`
                      : isComplete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                        : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black ${
                    isActive ? `bg-gradient-to-r ${sc.gradient} text-white` :
                    isComplete ? "bg-emerald-500 text-white" :
                    "bg-slate-200 text-slate-500"
                  }`}>
                    {isComplete && s.id < onb.step ? "✓" : s.id}
                  </div>
                  <span className="hidden sm:inline">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Error Toast */}
      {onb.error && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <div className="rounded-xl bg-rose-50 border-2 border-rose-200 p-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-rose-700">{onb.error}</p>
            <button onClick={() => onb.setError("")} className="text-rose-500 hover:text-rose-700">✕</button>
          </div>
        </div>
      )}

      {/* Autosave Status */}
      {onb.autosaveStatus && (
        <div className="max-w-4xl mx-auto px-4 pt-2">
          <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> {onb.autosaveStatus}
          </p>
        </div>
      )}

      {/* Step Content */}
      <div className="max-w-4xl mx-auto p-4 pb-32">
        {/* Step 1: Welcome (V2) */}
        {onb.step === 1 && (
          <Step1Welcome
            status={onb.status}
            privacyConsentAccepted={onb.privacyConsentAccepted}
            onPrivacyConsent={onb.recordPrivacyConsent}
            consentAccepted={onb.consentAccepted}
            onConsent={onb.grantConsent}
            saving={onb.saving}
          />
        )}

        {/* Step 2: Personal Details (V2) */}
        {onb.step === 2 && (
          <Step2Personal
            employee={onb.employee}
            setEmployee={onb.setEmployee}
            saving={onb.saving}
            onSave={onb.saveEmployee}
          />
        )}

        {/* Step 3: Address & KYC (V2) */}
        {onb.step === 3 && (
          <Step3AddressKyc
            employee={onb.employee}
            setEmployee={onb.setEmployee}
            status={onb.status}
            saving={onb.saving}
            onSave={onb.saveEmployee}
            digilockerUrl={onb.redirectUrl}
            digilockerLoading={onb.saving}
            digilockerError={null}
            onDigilockerStart={onb.startDigilocker}
            consentAccepted={onb.consentAccepted}
            onConsent={onb.grantConsent}
          />
        )}

        {/* Step 4: Documents (V2) */}
        {onb.step === 4 && (
          <Step4Documents
            status={onb.status}
            token={token}
            saving={onb.saving}
            consentAccepted={onb.consentAccepted}
            onUpload={onb.uploadDoc}
            onDelete={onb.deleteDoc}
          />
        )}

        {/* Step 5: BGV (V2) */}
        {onb.step === 5 && (
          <Step5Bgv
            bgv={onb.bgv}
            bgvApiAvailable={onb.bgvApiAvailable}
            consentAccepted={onb.consentAccepted}
            saving={onb.saving}
            status={onb.status}
            onConsent={onb.grantConsent}
            onVerifyAadhaar={onb.verifyAadhaar}
            onVerifyPan={onb.verifyPan}
            onVerifyBank={onb.verifyBank}
            onVerifyUan={onb.verifyUan}
            onDigilocker={onb.startDigilocker}
            digilockerRedirectUrl={onb.redirectUrl}
            digilockerStatus={onb.digilockerSessionState}
            onSyncDigilocker={onb.syncDigilocker}
            digilockerSyncing={onb.digilockerSyncing}
          />
        )}

        {/* Step 6: Bank (V2) */}
        {onb.step === 6 && (
          <Step6Bank
            bank={onb.bank}
            setBank={onb.setBank}
            saving={onb.saving}
            onSave={onb.saveBank}
            onLookupIfsc={onb.lookupIfsc}
            token={token}
            consentAccepted={onb.consentAccepted}
            onSkip={onb.advanceStep}
          />
        )}

        {/* Step 7: Education (V2) */}
        {onb.step === 7 && (
          <Step7Education
            qual={onb.qual}
            setQual={onb.setQual}
            status={onb.status}
            saving={onb.saving}
            onAdd={onb.addQualification}
          />
        )}

        {/* Step 8: Experience (V2) */}
        {onb.step === 8 && (
          <Step8Experience
            experience={onb.experience}
            setExperience={onb.setExperience}
            saving={onb.saving}
            onSave={onb.saveExperience}
          />
        )}

        {/* Step 9: Family & Language (V2) */}
        {onb.step === 9 && (
          <Step9FamilyLang
            family={onb.family}
            setFamily={onb.setFamily}
            languages={onb.languages}
            setLanguages={onb.setLanguages}
            familyMembers={onb.familyMembers}
            setFamilyMembers={onb.setFamilyMembers}
            saving={onb.saving}
            onSave={onb.saveExperience}
          />
        )}

        {/* Step 10: Submit (V2) */}
        {onb.step === 10 && (
          <Step10Statutory
            statutory={onb.statutory}
            setStatutory={onb.setStatutory}
            otpSent={onb.otpSent}
            otpChannels={onb.otpChannels}
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
            consentAccepted={onb.consentAccepted}
            privacyConsentAccepted={onb.privacyConsentAccepted}
            onGoToDocuments={() => onb.setStep(4)}
          />
        )}
      </div>

      {/* Footer Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-slate-200 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Button
            variant="outline"
            disabled={onb.step === 1 || onb.saving}
            onClick={() => onb.setStep((s) => Math.max(1, s - 1) as Step)}
            className="min-h-[48px] px-6 font-semibold rounded-xl border-2"
          >
            ← Back
          </Button>

          {onb.step < 10 ? (
            <Button
              disabled={onb.saving}
              onClick={onb.advanceStep}
              className={`min-h-[48px] px-8 font-bold rounded-xl shadow-lg bg-gradient-to-r ${stepColor.gradient} text-white`}
            >
              {onb.saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Next Step →
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
