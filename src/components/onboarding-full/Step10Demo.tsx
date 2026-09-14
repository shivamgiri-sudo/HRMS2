import { useState } from "react";
import {
  AlertCircle, CheckCircle2, Loader2, Shield, Phone, Mail, FileText,
  User, CreditCard, Building2, BadgeCheck, Percent, Smartphone, Lock,
  Sparkles, ChevronRight, Send, FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Step 10 Demo — MAS HRMS Design Patterns Applied
 *
 * FRONTEND ONLY — No backend connections, mock data only.
 * Demonstrates: glassmorphism, gradient headers, colored sections, responsive layout.
 */

// Mock data for demo
const MOCK_EMPLOYEE = {
  employeeName: "Rajesh Kumar Singh",
  mobileNumber: "9876543210",
  email: "rajesh.kumar@mashrms.in",
  panNumber: "ABCDE1234F",
};

const MOCK_STATUS = {
  documents: Array(7).fill({ id: "1" }),
  qualifications: [{ id: "1", qualification: "Graduate" }, { id: "2", qualification: "12th" }],
};

export default function Step10Demo() {
  // Demo states
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [previousPfMember, setPreviousPfMember] = useState<boolean | null>(null);
  const [epsMember, setEpsMember] = useState<boolean | null>(null);
  const [internationalWorker, setInternationalWorker] = useState<boolean | null>(null);
  const [pfOptOutConsented, setPfOptOutConsented] = useState(false);
  const [pfForm11Checks, setPfForm11Checks] = useState([false, false, false]);

  // Check eligibility
  const isPfOptOutEligible = previousPfMember === false && epsMember === false && internationalWorker === false;
  const form11ConsentReady = pfForm11Checks.every(Boolean);
  const canSubmit = declarationAccepted && otpVerified;

  // Mock actions
  const handleSendOtp = () => {
    setSaving(true);
    setTimeout(() => {
      setOtpSent(true);
      setSaving(false);
    }, 1000);
  };

  const handleVerifyOtp = () => {
    setSaving(true);
    setTimeout(() => {
      setOtpVerified(true);
      setSaving(false);
    }, 1000);
  };

  const handlePfOptOut = () => {
    setSaving(true);
    setTimeout(() => {
      setPfOptOutConsented(true);
      setSaving(false);
    }, 500);
  };

  // Reusable Yes/No Chip Component
  const YNChip = ({
    label, value, onChange, helpText
  }: {
    label: string; value: boolean | null; onChange: (v: boolean) => void; helpText?: string;
  }) => (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-slate-700">{label}</Label>
      {helpText && <p className="text-xs text-slate-500">{helpText}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`flex-1 min-h-[48px] rounded-xl border-2 font-bold text-sm transition-all active:scale-95 ${
            value === true
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`flex-1 min-h-[48px] rounded-xl border-2 font-bold text-sm transition-all active:scale-95 ${
            value === false
              ? "border-rose-500 bg-rose-50 text-rose-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
        >
          No
        </button>
      </div>
    </div>
  );

  // Checklist Item Component
  const ChecklistItem = ({
    label, value, ok, icon: Icon, tone
  }: {
    label: string; value: string; ok: boolean; icon: React.ElementType;
    tone: "blue" | "green" | "amber" | "purple" | "teal" | "pink";
  }) => {
    const toneMap = {
      blue: { bg: "from-blue-50 to-indigo-50", border: "border-blue-200", icon: "#0b63e5", text: "text-blue-700" },
      green: { bg: "from-emerald-50 to-green-50", border: "border-emerald-200", icon: "#15803d", text: "text-emerald-700" },
      amber: { bg: "from-amber-50 to-orange-50", border: "border-amber-200", icon: "#ea580c", text: "text-amber-700" },
      purple: { bg: "from-purple-50 to-violet-50", border: "border-purple-200", icon: "#6d28d9", text: "text-purple-700" },
      teal: { bg: "from-teal-50 to-cyan-50", border: "border-teal-200", icon: "#0891b2", text: "text-teal-700" },
      pink: { bg: "from-pink-50 to-rose-50", border: "border-pink-200", icon: "#db2777", text: "text-pink-700" },
    };
    const t = toneMap[tone];

    return (
      <div className={`rounded-xl border-2 ${t.border} bg-gradient-to-br ${t.bg} p-4 transition-all hover:shadow-md`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${t.icon}15` }}
            >
              <Icon className="h-5 w-5" style={{ color: t.icon }} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
              <p className={`mt-0.5 font-bold text-sm ${t.text}`}>{value}</p>
            </div>
          </div>
          {ok ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Demo Banner */}
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 text-white p-4 rounded-2xl shadow-lg">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6" />
            <div>
              <p className="font-bold">Design Demo — Step 10: Statutory & Submit</p>
              <p className="text-sm text-white/80">MAS HRMS Design Patterns Applied (Frontend Only)</p>
            </div>
          </div>
        </div>

        {/* Main Card — Glassmorphism */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-lg overflow-hidden">

          {/* Gradient Header */}
          <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 sm:p-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <FileCheck className="h-7 w-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white">Statutory Declaration & Submit</h1>
                <p className="text-emerald-100 text-sm mt-1">Final step — verify your details and submit your onboarding</p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-6">

            {/* Section 1: Statutory Declarations */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Statutory Information</h2>
                  <p className="text-xs text-slate-500">Required for PF and statutory compliance</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <YNChip
                  label="Previous PF Member?"
                  value={previousPfMember}
                  onChange={setPreviousPfMember}
                  helpText="Were you a PF member before?"
                />
                <YNChip
                  label="EPS Member?"
                  value={epsMember}
                  onChange={setEpsMember}
                  helpText="Employee Pension Scheme"
                />
                <YNChip
                  label="International Worker?"
                  value={internationalWorker}
                  onChange={setInternationalWorker}
                  helpText="Foreign national or passport holder?"
                />
              </div>
            </section>

            {/* Section 2: PF Opt-Out (Form 11) — Conditional */}
            {isPfOptOutEligible && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">PF Opt-Out Declaration (Form 11)</h2>
                    <p className="text-xs text-slate-500">EPF Act §17(1) — Excluded Employee Option</p>
                  </div>
                </div>

                {pfOptOutConsented ? (
                  <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-emerald-800">PF Opt-Out Consent Recorded</p>
                        <p className="text-sm text-emerald-700 mt-1">
                          You elected to opt out of PF contributions. This election is final.
                        </p>
                        <p className="text-sm text-emerald-600 font-semibold mt-2">
                          Your CTC = Gross = Net-in-Hand (no statutory deductions)
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Shield className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-bold text-blue-900">You may be eligible to opt out of PF</p>
                        <p className="text-sm text-blue-800 mt-1">
                          Since this is your first employment and you have never been a PF member, you can choose to opt out.
                          <strong className="text-blue-900"> This is an irrevocable, one-time election.</strong>
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg bg-white border border-blue-200 p-4">
                      <p className="text-xs font-black uppercase tracking-wide text-blue-700 mb-2">Form 11 — Online Declaration</p>
                      <p className="text-sm text-slate-700 italic border-l-4 border-blue-300 pl-3">
                        "I hereby declare that I am joining employment for the first time and have never been a member
                        of the Employees' Provident Fund or the Employees' Pension Scheme..."
                      </p>
                    </div>

                    <div className="space-y-3">
                      {[
                        "I confirm this is my first employment — I have never worked anywhere before.",
                        "I confirm I have never held a UAN (Universal Account Number) or any PF account.",
                        "I understand this PF opt-out election is irrevocable and cannot be changed after joining.",
                      ].map((text, i) => (
                        <label
                          key={i}
                          className={`flex items-start gap-3 cursor-pointer p-4 rounded-xl border-2 transition-all ${
                            pfForm11Checks[i]
                              ? "bg-emerald-50 border-emerald-300"
                              : "bg-white border-slate-200 hover:border-slate-400"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={pfForm11Checks[i]}
                            onChange={(e) => {
                              const newChecks = [...pfForm11Checks];
                              newChecks[i] = e.target.checked;
                              setPfForm11Checks(newChecks);
                            }}
                            className="mt-0.5 h-5 w-5 flex-shrink-0 accent-emerald-600"
                          />
                          <span className="text-sm text-slate-800">{text}</span>
                        </label>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={handlePfOptOut}
                        disabled={!form11ConsentReady || saving}
                        className="min-h-[52px] px-6 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 gap-2"
                      >
                        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Shield className="h-5 w-5" />}
                        I Consent — Opt Out of PF
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-[52px] px-6 font-semibold rounded-xl border-2"
                      >
                        No, Keep PF Deductions
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Section 3: OTP Verification */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center">
                  <Smartphone className="h-4 w-4 text-teal-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">OTP Verification</h2>
                  <p className="text-xs text-slate-500">Verify your mobile number and email</p>
                </div>
              </div>

              {otpVerified ? (
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-800">OTP Verified Successfully</p>
                      <p className="text-sm text-emerald-700 mt-1">
                        {MOCK_EMPLOYEE.mobileNumber} has been verified via OTP.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 border-2 border-teal-200 p-5 space-y-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-teal-200">
                      <Phone className="h-4 w-4 text-teal-600" />
                      <span className="font-semibold text-slate-800">{MOCK_EMPLOYEE.mobileNumber}</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-teal-200">
                      <Mail className="h-4 w-4 text-teal-600" />
                      <span className="font-semibold text-slate-800">{MOCK_EMPLOYEE.email}</span>
                    </div>
                  </div>

                  <p className="text-sm text-teal-800">
                    Your OTP will be sent to both your mobile number and email. Enter whichever reaches you first.
                  </p>

                  {otpSent && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                      <p className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        OTP sent to your mobile and email!
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 items-end">
                    <Button
                      variant="outline"
                      onClick={handleSendOtp}
                      disabled={saving}
                      className="min-h-[52px] px-6 font-bold rounded-xl border-2 border-teal-300 bg-white hover:bg-teal-50 gap-2"
                    >
                      {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                      {otpSent ? "Resend OTP" : "Send OTP"}
                    </Button>

                    {otpSent && (
                      <div className="flex gap-3 items-end flex-wrap">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-semibold text-slate-700">Enter OTP</Label>
                          <Input
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                            maxLength={6}
                            inputMode="numeric"
                            className="w-40 min-h-[52px] text-xl text-center font-mono tracking-[0.4em] rounded-xl border-2 border-teal-200 focus:border-teal-500"
                            placeholder="000000"
                          />
                        </div>
                        <Button
                          onClick={handleVerifyOtp}
                          disabled={saving || otpCode.length !== 6}
                          className="min-h-[52px] px-6 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold rounded-xl shadow-lg shadow-teal-500/30 gap-2"
                        >
                          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                          Verify
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Section 4: Declaration */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Declaration</h2>
                  <p className="text-xs text-slate-500">Read carefully and accept</p>
                </div>
              </div>

              <label className={`flex items-start gap-4 cursor-pointer p-5 rounded-xl border-2 transition-all ${
                declarationAccepted
                  ? "bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-300"
                  : "bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 hover:border-amber-400"
              }`}>
                <input
                  type="checkbox"
                  checked={declarationAccepted}
                  onChange={(e) => setDeclarationAccepted(e.target.checked)}
                  className="mt-0.5 h-6 w-6 flex-shrink-0 accent-emerald-600"
                />
                <span className="text-sm leading-relaxed text-slate-800">
                  I hereby declare that all information furnished above is{" "}
                  <strong>true, correct and complete</strong> to the best of my knowledge and belief.
                  I understand that any misrepresentation, concealment or omission of facts may result in{" "}
                  <strong>rejection of my candidature or termination of employment</strong>, and I accept full responsibility for the accuracy of this information.
                </span>
              </label>
            </section>

            {/* Section 5: Submission Checklist */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <BadgeCheck className="h-4 w-4 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Submission Checklist</h2>
                  <p className="text-xs text-slate-500">Quick check before final submission</p>
                </div>
              </div>

              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                <ChecklistItem label="Name" value={MOCK_EMPLOYEE.employeeName} ok icon={User} tone="blue" />
                <ChecklistItem label="PAN" value={`${MOCK_EMPLOYEE.panNumber.slice(0,3)}XXXXX${MOCK_EMPLOYEE.panNumber.slice(-2)}`} ok icon={CreditCard} tone="purple" />
                <ChecklistItem label="Documents" value={`${MOCK_STATUS.documents.length} uploaded`} ok icon={FileText} tone="green" />
                <ChecklistItem label="BGV Status" value="Verified ✓" ok icon={Shield} tone="teal" />
                <ChecklistItem label="Bank" value="HDFC Bank" ok icon={Building2} tone="blue" />
                <ChecklistItem label="Profile Completion" value="92%" ok icon={Percent} tone="green" />
                <ChecklistItem label="OTP" value={otpVerified ? "Verified ✓" : "Not verified"} ok={otpVerified} icon={Smartphone} tone="teal" />
                <ChecklistItem label="Declaration" value={declarationAccepted ? "Signed ✓" : "Not signed"} ok={declarationAccepted} icon={FileCheck} tone="amber" />
                <ChecklistItem label="Qualifications" value={`${MOCK_STATUS.qualifications.length} added`} ok icon={BadgeCheck} tone="purple" />
              </div>
            </section>

            {/* Section 6: Submit */}
            <section>
              <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 space-y-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Send className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">Ready to submit?</p>
                    <p className="text-emerald-100 text-sm">
                      Once submitted, your profile goes to HR for review
                    </p>
                  </div>
                </div>

                {!canSubmit && (
                  <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 p-4 space-y-2">
                    <p className="text-sm font-bold text-white/90 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Complete these steps:
                    </p>
                    {!otpVerified && (
                      <p className="text-sm text-white/80 flex items-center gap-2 pl-6">
                        <ChevronRight className="h-3 w-3" /> OTP must be verified
                      </p>
                    )}
                    {!declarationAccepted && (
                      <p className="text-sm text-white/80 flex items-center gap-2 pl-6">
                        <ChevronRight className="h-3 w-3" /> Declaration must be accepted
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="min-h-[52px] px-6 font-semibold rounded-xl border-2 border-white/30 bg-white/10 text-white hover:bg-white/20"
                  >
                    <Lock className="h-4 w-4 mr-2" />
                    Save Progress
                  </Button>
                  <Button
                    disabled={!canSubmit}
                    className={`min-h-[52px] px-10 font-black rounded-xl gap-2 transition-all ${
                      canSubmit
                        ? "bg-white text-emerald-700 hover:bg-emerald-50 shadow-xl"
                        : "bg-white/30 text-white/60 cursor-not-allowed"
                    }`}
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    Submit Onboarding
                  </Button>
                </div>
              </div>
            </section>

          </div>
        </div>

        {/* Design Pattern Legend */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Applied Design Patterns</h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-gradient-to-br from-emerald-600 to-teal-600" />
              <span className="text-slate-700">Gradient Headers (Section-specific)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border border-white/60 bg-white/95 backdrop-blur-sm" />
              <span className="text-slate-700">Glassmorphism Cards</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200" />
              <span className="text-slate-700">Colored Section Cards</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-lg bg-purple-100 flex items-center justify-center text-[8px]">●</div>
              <span className="text-slate-700">Icon Containers with Tone</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓</span>
              <span className="text-slate-700">Status Badges</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs">📱</span>
              <span className="text-slate-700">Mobile-First Responsive Grid</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
