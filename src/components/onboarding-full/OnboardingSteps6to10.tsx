import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  QualForm, ExperienceForm, FamilyForm, LanguageRow,
  StatutoryForm, StatusData, BgvStatus,
} from "./useOnboardingFull";
import { EMPTY_QUAL } from "./useOnboardingFull";

// ── Mobile-first form primitives with touch-friendly sizing ───────────────────
function F({ label, value, onChange, type = "text", opts, mode, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; opts?: string[]; mode?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <Label className="text-sm font-semibold">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</Label>
      {opts
        ? <select className="flex min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={value || ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        : <Input type={type} inputMode={mode as any} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-h-[44px] text-base" />
      }
    </div>
  );
}
function RO({ label, value }: { label: string; value?: any }) {
  return <div className="rounded-xl border-2 bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-600">{label}</p><p className="mt-1.5 font-semibold text-slate-900 text-base">{value || "—"}</p></div>;
}
function SectionHead({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500 mt-6 mb-4 pb-2 border-b border-slate-200">{children}</p>;
}
function YNChip({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div>
      <Label className="text-sm font-semibold">{label}</Label>
      <div className="flex gap-3 mt-2">
        {[{ l: "Yes", v: true }, { l: "No", v: false }].map(({ l, v }) => (
          <button key={l} type="button" onClick={() => onChange(v)}
            className={`rounded-full px-6 py-2.5 text-sm font-bold border-2 transition-all min-h-[44px] ${value === v ? "bg-slate-950 text-white border-slate-950 scale-105" : "bg-white text-slate-700 border-slate-300 hover:border-slate-600"}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

const QUALS = ["10th", "12th", "Diploma", "Graduate", "Post Graduate", "PhD", "Other"];
const EXP_OPTS = ["fresher", "Less than 1 year", "1–2 years", "2–3 years", "3–5 years", "5+ years"];
const PROFICIENCIES = ["basic", "intermediate", "fluent", "native"];
const LANGUAGES_COMMON = ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia", "Urdu"];

// ── Step 8: Education ─────────────────────────────────────────────────────────
export function Step8Education({
  qual, setQual, status, saving, onAdd,
}: {
  qual: QualForm;
  setQual: React.Dispatch<React.SetStateAction<QualForm>>;
  status: StatusData | null;
  saving: boolean;
  onAdd: () => void;
}) {
  const upd = (k: keyof QualForm, v: string) => setQual((p) => ({ ...p, [k]: v }));

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-cyan-600 to-cyan-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Education / Qualification</CardTitle>
        <p className="text-sm text-cyan-100 mt-1">Add all your educational qualifications</p>
      </CardHeader>
      <CardContent className="pt-5">
        <SectionHead>Add Qualification</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Qualification" value={qual.qualification} onChange={(v) => upd("qualification", v)} opts={QUALS} required />
          <F label="Specialization / Course" value={qual.specializationCourseName} onChange={(v) => upd("specializationCourseName", v)} />
          <F label="Institution Name" value={qual.institutionName} onChange={(v) => upd("institutionName", v)} />
          <F label="Board / University" value={qual.boardType} onChange={(v) => upd("boardType", v)} />
          <F label="Passed Out Year" value={qual.passedOutYear} onChange={(v) => upd("passedOutYear", v)} mode="numeric" placeholder="2022" required />
          <F label="Percentage / CGPA" value={qual.passedOutPercentage} onChange={(v) => upd("passedOutPercentage", v)} mode="decimal" />
          <F label="State" value={qual.passedOutState} onChange={(v) => upd("passedOutState", v)} />
          <F label="City" value={qual.passedOutCity} onChange={(v) => upd("passedOutCity", v)} />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={onAdd} disabled={saving || !qual.qualification} size="lg" className="min-h-[48px] px-6 text-base font-semibold gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />} Add Qualification
          </Button>
          <Button variant="ghost" onClick={() => setQual(EMPTY_QUAL)} disabled={saving} size="lg" className="min-h-[48px] px-6 text-base font-semibold">Clear Form</Button>
        </div>

        <SectionHead>Added Qualifications</SectionHead>
        <div className="space-y-3">
          {!status?.qualifications.length && <p className="text-sm text-slate-500 py-4">No qualifications added yet.</p>}
          {status?.qualifications.map((q) => (
            <div key={q.id} className="flex items-start gap-3 rounded-xl border-2 bg-slate-50 px-5 py-4 text-sm shadow-sm">
              <div className="flex-1">
                <span className="font-bold text-base text-slate-950">{q.qualification}</span>
                {q.specialization_course_name && <span className="text-slate-600"> · {q.specialization_course_name}</span>}
                {q.institution_name && <span className="text-slate-600"> · {q.institution_name}</span>}
                {q.passed_out_year && <span className="text-slate-600"> · {q.passed_out_year}</span>}
                {q.passed_out_percentage && <span className="text-slate-600"> · {q.passed_out_percentage}%</span>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 9: Experience, Family & Language ─────────────────────────────────────
export function Step9ExperienceLang({
  experience, setExperience, family, setFamily, languages, setLanguages, saving, onSave,
}: {
  experience: ExperienceForm;
  setExperience: React.Dispatch<React.SetStateAction<ExperienceForm>>;
  family: FamilyForm;
  setFamily: React.Dispatch<React.SetStateAction<FamilyForm>>;
  languages: LanguageRow[];
  setLanguages: React.Dispatch<React.SetStateAction<LanguageRow[]>>;
  saving: boolean;
  onSave: () => void;
}) {
  const updExp = (k: keyof ExperienceForm, v: string) => setExperience((p) => ({ ...p, [k]: v }));
  const updFam = (k: keyof FamilyForm, v: string) => setFamily((p) => ({ ...p, [k]: v }));
  const [newLang, setNewLang] = useState({ language_name: "", can_read: false, can_write: false, can_speak: false, proficiency: "basic" });
  const isFresher = experience.workingExperience === "fresher";

  const addLanguage = () => {
    if (!newLang.language_name.trim()) return;
    setLanguages((prev) => [...prev, { ...newLang, id: Date.now().toString() }]);
    setNewLang({ language_name: "", can_read: false, can_write: false, can_speak: false, proficiency: "basic" });
  };
  const removeLanguage = (id: string) => setLanguages((prev) => prev.filter((l) => l.id !== id));
  const toggleLangBool = (id: string, field: "can_read" | "can_write" | "can_speak") => {
    setLanguages((prev) => prev.map((l) => l.id === id ? { ...l, [field]: !l[field] } : l));
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-pink-600 to-pink-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Experience, Family & Language</CardTitle>
        <p className="text-sm text-pink-100 mt-1">Work history, family background and language skills</p>
      </CardHeader>
      <CardContent className="pt-5">
        <SectionHead>Family Details</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2">
          <F label="Annual Family Income (₹)" value={family.annualIncome} onChange={(v) => updFam("annualIncome", v)} mode="numeric" />
          <F label="Count of Dependents" value={family.countOfDependents} onChange={(v) => updFam("countOfDependents", v)} mode="numeric" />
        </div>

        <SectionHead>Work Experience</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Experience Level" value={experience.workingExperience} onChange={(v) => updExp("workingExperience", v)} opts={EXP_OPTS} required />
          {!isFresher && <>
            <F label="Total Experience (years)" value={experience.experienceYear} onChange={(v) => updExp("experienceYear", v)} mode="numeric" />
            <F label="Employer Name" value={experience.employerName} onChange={(v) => updExp("employerName", v)} />
            <F label="Last Designation" value={experience.lastDesignation} onChange={(v) => updExp("lastDesignation", v)} />
            <F label="Last CTC (Annual ₹)" value={experience.lastCtc} onChange={(v) => updExp("lastCtc", v)} mode="numeric" />
            <F label="Experience Doc Type" value={experience.experienceDocType} onChange={(v) => updExp("experienceDocType", v)} />
            <F label="From Date" value={experience.fromDate} onChange={(v) => updExp("fromDate", v)} type="date" />
            <F label="To Date" value={experience.toDate} onChange={(v) => updExp("toDate", v)} type="date" />
            <div className="lg:col-span-3">
              <Label className="text-sm font-semibold">Reason for Leaving</Label>
              <Input value={experience.reasonForLeaving} onChange={(e) => updExp("reasonForLeaving", e.target.value)} className="min-h-[44px] text-base" />
            </div>
          </>}
        </div>

        <SectionHead>Language Proficiency</SectionHead>
        <div className="mb-4 flex flex-wrap gap-2">
          {LANGUAGES_COMMON.map((l) => (
            <button key={l} type="button"
              onClick={() => setNewLang((p) => ({ ...p, language_name: l }))}
              className={`rounded-full border-2 px-4 py-2 text-sm font-semibold transition-all min-h-[40px] ${newLang.language_name === l ? "bg-slate-900 text-white border-slate-900 scale-105" : "border-slate-300 hover:border-slate-600"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
          <F label="Language" value={newLang.language_name} onChange={(v) => setNewLang((p) => ({ ...p, language_name: v }))} placeholder="e.g. Tamil" />
          <F label="Proficiency" value={newLang.proficiency} onChange={(v) => setNewLang((p) => ({ ...p, proficiency: v }))} opts={PROFICIENCIES} />
          <div>
            <Label className="text-sm font-semibold">Skills</Label>
            <div className="flex gap-4 mt-2">
              {(["can_read", "can_write", "can_speak"] as const).map((sk) => (
                <label key={sk} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={newLang[sk]} onChange={() => setNewLang((p) => ({ ...p, [sk]: !p[sk] }))} className="h-4 w-4" />
                  {sk.replace("can_", "")}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-end">
            <Button size="lg" onClick={addLanguage} disabled={!newLang.language_name.trim()} className="min-h-[44px] px-6 text-base font-semibold gap-2">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {languages.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b">
                <tr>{["Language", "Read", "Write", "Speak", "Level", ""].map((h) => <th key={h} className="p-3 text-left text-xs font-bold uppercase text-slate-700">{h}</th>)}</tr>
              </thead>
              <tbody>
                {languages.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-slate-50">
                    <td className="p-3 font-semibold">{l.language_name}</td>
                    {(["can_read", "can_write", "can_speak"] as const).map((f) => (
                      <td key={f} className="p-3">
                        <input type="checkbox" checked={l[f]} onChange={() => toggleLangBool(l.id, f)} className="h-4 w-4" />
                      </td>
                    ))}
                    <td className="p-3 capitalize">{l.proficiency}</td>
                    <td className="p-3">
                      <button type="button" onClick={() => removeLanguage(l.id)} className="p-2 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4 text-red-400" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={saving} size="lg" className="min-h-[48px] px-8 text-base font-semibold">
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Save Experience & Language
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 10: Statutory + OTP + Submit ─────────────────────────────────────────
export function Step10Statutory({
  statutory, setStatutory, otpSent, otpVerified, otpCode, setOtpCode,
  saving, employee, bank, status, bgv, completion,
  onSendOtp, onVerifyOtp, onSave, onSubmit,
}: {
  statutory: StatutoryForm;
  setStatutory: React.Dispatch<React.SetStateAction<StatutoryForm>>;
  otpSent: boolean;
  otpVerified: boolean;
  otpCode: string;
  setOtpCode: React.Dispatch<React.SetStateAction<string>>;
  saving: boolean;
  employee: { employeeName: string; mobileNumber: string; panNumber: string };
  bank: { bankName: string };
  status: StatusData | null;
  bgv: BgvStatus | null;
  completion: number;
  onSendOtp: () => void;
  onVerifyOtp: () => void;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const updS = (k: keyof StatutoryForm, v: any) => setStatutory((p) => ({ ...p, [k]: v }));

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Statutory Declaration & Submit</CardTitle>
        <p className="text-sm text-emerald-100 mt-1">Final statutory details, OTP verification and submission</p>
      </CardHeader>
      <CardContent className="pt-5 space-y-6">
        <SectionHead>Statutory Information</SectionHead>
        <div className="grid gap-6 sm:grid-cols-3">
          <YNChip label="Previous PF Member?" value={statutory.previousPfMember} onChange={(v) => updS("previousPfMember", v)} />
          <YNChip label="EPS Member?" value={statutory.epsMember} onChange={(v) => updS("epsMember", v)} />
          <YNChip label="International Worker?" value={statutory.internationalWorker} onChange={(v) => updS("internationalWorker", v)} />
        </div>

        <SectionHead>Mobile OTP Verification</SectionHead>
        {otpVerified ? (
          <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 px-5 py-4 text-sm font-semibold text-emerald-800 flex items-center gap-3">
            <span className="text-2xl">✓</span>
            <span>Mobile {employee.mobileNumber} verified successfully</span>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-4 border">An OTP will be sent to <strong className="text-slate-950">{employee.mobileNumber || "your registered mobile"}</strong></p>
            <div className="flex flex-wrap gap-3 items-end">
              <Button variant="outline" onClick={onSendOtp} disabled={saving || !employee.mobileNumber} size="lg" className="min-h-[48px] px-6 text-base font-semibold">
                {otpSent ? "Resend OTP" : "Send OTP"}
              </Button>
              {otpSent && (
                <div className="flex gap-3 items-end">
                  <div>
                    <Label className="text-sm font-semibold">Enter OTP</Label>
                    <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} maxLength={6} inputMode="numeric" className="w-40 min-h-[48px] text-base text-center font-mono text-lg tracking-widest" placeholder="6-digit" />
                  </div>
                  <Button onClick={onVerifyOtp} disabled={saving || otpCode.length !== 6} size="lg" className="min-h-[48px] px-6 text-base font-semibold">Verify OTP</Button>
                </div>
              )}
            </div>
          </div>
        )}

        <SectionHead>Declaration</SectionHead>
        <label className="flex items-start gap-4 cursor-pointer p-5 bg-slate-50 rounded-xl border-2 hover:border-slate-400 transition-colors">
          <input type="checkbox" checked={statutory.declarationAccepted} onChange={(e) => updS("declarationAccepted", e.target.checked)} className="mt-1 h-5 w-5 flex-shrink-0" />
          <span className="text-sm leading-relaxed text-slate-800">
            I hereby declare that the information furnished above is <strong>true, correct and complete</strong> to the best of my knowledge and belief.
            I understand that any misrepresentation or omission will result in <strong>rejection or termination of employment</strong>.
          </span>
        </label>

        <SectionHead>Review Summary</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RO label="Name" value={employee.employeeName} />
          <RO label="PAN" value={employee.panNumber ? `${employee.panNumber.slice(0, 3)}XXXXX${employee.panNumber.slice(-2)}` : "Not entered"} />
          <RO label="Documents" value={`${status?.documents.length || 0} uploaded`} />
          <RO label="BGV Status" value={bgv?.overall_status || "pending"} />
          <RO label="Bank" value={bank.bankName || "Not saved"} />
          <RO label="Completion" value={`${completion}%`} />
          <RO label="OTP" value={otpVerified ? "Verified ✓" : "Not verified"} />
          <RO label="Declaration" value={statutory.declarationAccepted ? "Signed ✓" : "Not signed"} />
        </div>

        <div className="flex flex-wrap gap-4 pt-3">
          <Button variant="outline" onClick={onSave} disabled={saving} size="lg" className="min-h-[48px] px-6 text-base font-semibold">Save Statutory</Button>
          <Button
            onClick={onSubmit}
            disabled={saving || !statutory.declarationAccepted || !otpVerified}
            className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[48px] px-8 text-base font-bold shadow-lg"
            size="lg"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            🚀 Submit Onboarding
          </Button>
        </div>
        {(!otpVerified || !statutory.declarationAccepted) && (
          <div className="rounded-xl bg-amber-50 border-2 border-amber-200 px-5 py-3 text-sm font-semibold text-amber-800">
            ⚠ {!otpVerified && "Verify your mobile OTP to enable submit. "}
            {!statutory.declarationAccepted && "Accept the declaration to enable submit."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
