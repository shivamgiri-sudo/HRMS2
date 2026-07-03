import { useState } from "react";
import {
  AlertCircle, CheckCircle2, Loader2, Plus, Trash2, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  F, RO, SectionHead, InfoBox, YNChip,
} from "./OnboardingFormPrimitives";
import type {
  QualForm, ExperienceForm, FamilyForm, LanguageRow,
  StatutoryForm, StatusData, BgvStatus, BankForm,
} from "./useOnboardingFull";
import { EMPTY_QUAL } from "./useOnboardingFull";

// ── Constants ─────────────────────────────────────────────────────────────────

const QUALS = ["10th / SSC", "12th / HSC", "ITI", "Diploma", "Graduate (B.A./B.Com/B.Sc/BBA)", "Graduate (B.Tech/BE)", "Post Graduate (MA/MCom/MSc/MBA)", "Post Graduate (M.Tech/ME)", "PhD / Doctorate", "Other"];
const EXP_OPTS = ["Fresher (No Experience)", "Less than 6 months", "6 months – 1 year", "1–2 years", "2–3 years", "3–5 years", "5+ years"];
const PROFICIENCIES = ["Basic", "Intermediate", "Fluent", "Native / Mother tongue"];
const LANGUAGES_COMMON = ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia", "Urdu", "Assamese", "Maithili"];
const EXP_DOC_TYPES = ["Experience Letter", "Appointment Letter", "Relieving Letter", "Offer Letter", "Form 16", "Salary Slip", "Employment Certificate", "Other"];

// ── Step 7: Education ─────────────────────────────────────────────────────────

export function Step7Education({
  qual, setQual, status, saving, onAdd,
}: {
  qual: QualForm;
  setQual: React.Dispatch<React.SetStateAction<QualForm>>;
  status: StatusData | null;
  saving: boolean;
  onAdd: () => void;
}) {
  const upd = (k: keyof QualForm, v: string) => setQual((p) => ({ ...p, [k]: v }));

  const yearOk = !qual.passedOutYear || (
    parseInt(qual.passedOutYear) >= 1970 && parseInt(qual.passedOutYear) <= new Date().getFullYear()
  );

  return (
    <Card className="border-t-4 border-t-cyan-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center text-lg">🎓</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Education & Qualifications</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Add all qualifications — {status?.qualifications.length ?? 0} added so far
            </p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5">

        <InfoBox variant="info">
          <p className="text-xs">
            Add each qualification separately. At minimum, add your <strong>10th / SSC</strong> qualification.
            If you are a fresher with only 10th + 12th, add both. Upload marksheets in the Documents step.
          </p>
        </InfoBox>

        <SectionHead sub="Fill details and click Add">Add Qualification</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Qualification Level" value={qual.qualification} onChange={(v) => upd("qualification", v)} opts={QUALS} required />
          <F label="Specialization / Course Name" value={qual.specializationCourseName} onChange={(v) => upd("specializationCourseName", v)} placeholder="e.g. Computer Science, Commerce" />
          <F label="Institution / School / College" value={qual.institutionName} onChange={(v) => upd("institutionName", v)} placeholder="Full institution name" />
          <F label="Board / University" value={qual.boardType} onChange={(v) => upd("boardType", v)} placeholder="e.g. CBSE, Osmania University" />
          <F
            label="Year of Passing"
            value={qual.passedOutYear}
            onChange={(v) => upd("passedOutYear", v)}
            mode="numeric"
            placeholder={String(new Date().getFullYear())}
            required
            error={!yearOk ? "Enter a valid year (1970–present)" : ""}
          />
          <F label="Percentage / CGPA" value={qual.passedOutPercentage} onChange={(v) => upd("passedOutPercentage", v)} mode="decimal" placeholder="e.g. 72.5 or 7.8" />
          <F label="State" value={qual.passedOutState} onChange={(v) => upd("passedOutState", v)} placeholder="State of institution" />
          <F label="City" value={qual.passedOutCity} onChange={(v) => upd("passedOutCity", v)} placeholder="City of institution" />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            onClick={onAdd}
            disabled={saving || !qual.qualification || !yearOk}
            size="lg"
            className="min-h-[52px] px-6 text-base font-bold bg-cyan-600 hover:bg-cyan-700 rounded-xl shadow-md gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Add Qualification
          </Button>
          <Button
            variant="outline"
            onClick={() => setQual(EMPTY_QUAL)}
            disabled={saving}
            size="lg"
            className="min-h-[52px] px-6 text-base font-semibold rounded-xl border-2"
          >
            Clear Form
          </Button>
        </div>

        <SectionHead sub="All qualifications you have added">Added Qualifications</SectionHead>
        {!status?.qualifications.length && (
          <div className="text-center py-8 text-slate-400">
            <span className="text-4xl block mb-2">🎓</span>
            <p className="text-sm font-semibold">No qualifications added yet</p>
            <p className="text-xs mt-1">Add at least your 10th / SSC qualification</p>
          </div>
        )}
        <div className="space-y-3">
          {status?.qualifications.map((q, idx) => (
            <div key={q.id} className="flex items-start gap-3 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-4 shadow-sm">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-black text-sm">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-base text-slate-950">{q.qualification}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {q.specialization_course_name && <span className="text-xs bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">{q.specialization_course_name}</span>}
                  {q.institution_name && <span className="text-xs bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">{q.institution_name}</span>}
                  {q.passed_out_year && <span className="text-xs bg-cyan-100 text-cyan-700 rounded-full px-2 py-0.5">Year: {q.passed_out_year}</span>}
                  {q.passed_out_percentage && <span className="text-xs bg-cyan-100 text-cyan-700 rounded-full px-2 py-0.5">{q.passed_out_percentage}%</span>}
                  {q.board_type && <span className="text-xs bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">{q.board_type}</span>}
                </div>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 8: Experience ────────────────────────────────────────────────────────

export function Step8Experience({
  experience, setExperience, saving, onSave,
}: {
  experience: ExperienceForm;
  setExperience: React.Dispatch<React.SetStateAction<ExperienceForm>>;
  saving: boolean;
  onSave: () => void;
}) {
  const updExp = (k: keyof ExperienceForm, v: string) => setExperience((p) => ({ ...p, [k]: v }));
  const isFresher = experience.workingExperience === "Fresher (No Experience)" || experience.workingExperience === "fresher";
  const dateOrderError = experience.fromDate && experience.toDate && experience.fromDate >= experience.toDate
    ? "From date must be before To date" : "";

  return (
    <Card className="border-t-4 border-t-pink-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center text-lg">💼</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Work Experience</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Previous employment history (if any)</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5">

        <SectionHead sub="Select your experience level">Experience Level</SectionHead>
        <F
          label="Total Work Experience"
          value={experience.workingExperience}
          onChange={(v) => updExp("workingExperience", v)}
          opts={EXP_OPTS}
          required
        />

        {isFresher ? (
          <InfoBox variant="success">
            <p className="text-sm">
              <strong>Fresher profile selected.</strong> No work experience details are required.
              Make sure to upload your latest marksheet/certificate in the Documents step.
            </p>
          </InfoBox>
        ) : (
          <div>
            <SectionHead sub="Most recent employer details">Previous Employment Details</SectionHead>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <F label="Employer / Company Name" value={experience.employerName} onChange={(v) => updExp("employerName", v)}
                  required placeholder="Full company name" />
              </div>
              <F label="Last Designation / Role" value={experience.lastDesignation} onChange={(v) => updExp("lastDesignation", v)}
                required placeholder="e.g. Customer Care Executive" />
              <F label="Total Experience (years)" value={experience.experienceYear} onChange={(v) => updExp("experienceYear", v)}
                mode="decimal" placeholder="e.g. 1.5" />
              <F label="Last CTC / Annual Salary (₹)" value={experience.lastCtc} onChange={(v) => updExp("lastCtc", v)}
                mode="numeric" placeholder="Annual CTC in rupees" />
              <F label="From Date" value={experience.fromDate} onChange={(v) => updExp("fromDate", v)} type="date" required />
              <F label="To Date" value={experience.toDate} onChange={(v) => updExp("toDate", v)} type="date" required error={dateOrderError} />
              <F label="Reason for Leaving" value={experience.reasonForLeaving} onChange={(v) => updExp("reasonForLeaving", v)}
                placeholder="e.g. Better opportunity, Relocation" />
              <F label="Document Type Available" value={experience.experienceDocType} onChange={(v) => updExp("experienceDocType", v)}
                opts={EXP_DOC_TYPES} helpText="What document can you provide?" />
            </div>
            <InfoBox variant="warning">
              <p className="text-xs">
                Upload experience letter, relieving letter or salary slip in the Documents step.
                Experienced candidates without supporting documents may be subject to additional verification.
              </p>
            </InfoBox>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            onClick={onSave}
            disabled={saving}
            size="lg"
            className="min-h-[52px] px-8 text-base font-bold bg-pink-600 hover:bg-pink-700 rounded-xl shadow-lg gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Experience Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 9: Family & Language ─────────────────────────────────────────────────

export function Step9FamilyLang({
  family, setFamily, languages, setLanguages, saving, onSave,
}: {
  family: FamilyForm;
  setFamily: React.Dispatch<React.SetStateAction<FamilyForm>>;
  languages: LanguageRow[];
  setLanguages: React.Dispatch<React.SetStateAction<LanguageRow[]>>;
  saving: boolean;
  onSave: () => void;
}) {
  const updFam = (k: keyof FamilyForm, v: string) => setFamily((p) => ({ ...p, [k]: v }));
  const [newLang, setNewLang] = useState({ language_name: "", can_read: false, can_write: false, can_speak: false, proficiency: "Intermediate" });

  const addLanguage = () => {
    const name = newLang.language_name.trim();
    if (!name) return;
    if (languages.some((l) => l.language_name.toLowerCase() === name.toLowerCase())) return;
    if (!newLang.can_read && !newLang.can_write && !newLang.can_speak) {
      setNewLang((p) => ({ ...p, can_speak: true }));
      return;
    }
    setLanguages((prev) => [...prev, { ...newLang, id: String(Date.now()) }]);
    setNewLang({ language_name: "", can_read: false, can_write: false, can_speak: false, proficiency: "Intermediate" });
  };

  const removeLanguage = (id: string) => setLanguages((prev) => prev.filter((l) => l.id !== id));

  const toggleLangBool = (id: string, field: "can_read" | "can_write" | "can_speak") => {
    setLanguages((prev) => prev.map((l) => l.id === id ? { ...l, [field]: !l[field] } : l));
  };

  return (
    <Card className="border-t-4 border-t-teal-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center text-lg">👨‍👩‍👧</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Family & Language Skills</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Family information and languages you know</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5">

        <SectionHead sub="For HR records and statutory purposes">Family Information</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <F
            label="Annual Household Income (₹)"
            value={family.annualIncome}
            onChange={(v) => updFam("annualIncome", v)}
            mode="numeric"
            placeholder="Approximate annual income"
            helpText="All family members combined income"
          />
          <F
            label="Number of Dependents"
            value={family.countOfDependents}
            onChange={(v) => updFam("countOfDependents", v)}
            mode="numeric"
            placeholder="Including yourself"
            helpText="Family members dependent on you"
          />
        </div>

        <SectionHead sub="Languages you can read, write or speak">Language Proficiency</SectionHead>
        <InfoBox variant="info">
          <p className="text-xs">
            Add at least <strong>English</strong> and your regional language. Select proficiency for each.
            This helps with process and client allocation.
          </p>
        </InfoBox>

        {/* Quick language chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          {LANGUAGES_COMMON.map((l) => {
            const alreadyAdded = languages.some((la) => la.language_name === l);
            return (
              <button
                key={l}
                type="button"
                disabled={alreadyAdded}
                onClick={() => setNewLang((p) => ({ ...p, language_name: l }))}
                className={`rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-all min-h-[36px] active:scale-95 ${
                  alreadyAdded
                    ? "border-emerald-200 bg-emerald-50 text-emerald-600 cursor-default"
                    : newLang.language_name === l
                      ? "border-teal-500 bg-teal-50 text-teal-700 scale-105"
                      : "border-slate-300 bg-white hover:border-teal-400 hover:bg-teal-50"
                }`}
              >
                {alreadyAdded && "✓ "}{l}
              </button>
            );
          })}
        </div>

        {/* New language form */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
          <div className="sm:col-span-2 lg:col-span-1">
            <F
              label="Language"
              value={newLang.language_name}
              onChange={(v) => setNewLang((p) => ({ ...p, language_name: v }))}
              placeholder="Type language name"
            />
          </div>
          <div>
            <F
              label="Proficiency"
              value={newLang.proficiency}
              onChange={(v) => setNewLang((p) => ({ ...p, proficiency: v }))}
              opts={PROFICIENCIES}
            />
          </div>
          <div>
            <Label className="text-sm font-semibold text-slate-700">Skills</Label>
            <div className="flex flex-col gap-2 mt-2">
              {(["can_read", "can_write", "can_speak"] as const).map((sk) => (
                <label key={sk} className="flex items-center gap-2 text-sm cursor-pointer select-none min-h-[28px]">
                  <input
                    type="checkbox"
                    checked={newLang[sk]}
                    onChange={() => setNewLang((p) => ({ ...p, [sk]: !p[sk] }))}
                    className="h-4 w-4 accent-teal-600"
                  />
                  <span className="capitalize font-medium">{sk.replace("can_", "")}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-end">
            <Button
              size="lg"
              onClick={addLanguage}
              disabled={!newLang.language_name.trim()}
              className="w-full min-h-[48px] px-4 text-base font-bold bg-teal-600 hover:bg-teal-700 rounded-xl gap-2"
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {/* Languages table */}
        {languages.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border-2 border-slate-200 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b-2 border-slate-200">
                <tr>
                  {["Language", "Read", "Write", "Speak", "Level", ""].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold uppercase text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {languages.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-3 font-semibold text-slate-900">{l.language_name}</td>
                    {(["can_read", "can_write", "can_speak"] as const).map((f) => (
                      <td key={f} className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={l[f]}
                          onChange={() => toggleLangBool(l.id, f)}
                          className="h-4 w-4 accent-teal-600"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-slate-600 text-xs font-semibold capitalize">{l.proficiency}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => removeLanguage(l.id)}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label={`Remove ${l.language_name}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-400 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {languages.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 font-semibold">
            ⚠ Please add at least English as a language
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            onClick={onSave}
            disabled={saving}
            size="lg"
            className="min-h-[52px] px-8 text-base font-bold bg-teal-600 hover:bg-teal-700 rounded-xl shadow-lg gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Family & Language
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
  pfOptOutElected, pfOptOutSaving, pfOptOutConsented, pfOptOutConsentedAt,
  onPfOptOutConsent,
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
  pfOptOutElected: boolean | null;
  pfOptOutSaving: boolean;
  pfOptOutConsented: boolean;
  pfOptOutConsentedAt: string | null;
  onPfOptOutConsent: (elected: boolean) => void;
  onSendOtp: () => void;
  onVerifyOtp: () => void;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const updS = (k: keyof StatutoryForm, v: any) => setStatutory((p) => ({ ...p, [k]: v }));
  const [pfForm11Check1, setPfForm11Check1] = useState(false);
  const [pfForm11Check2, setPfForm11Check2] = useState(false);
  const [pfForm11Check3, setPfForm11Check3] = useState(false);

  // Show Form 11 only when candidate answers indicate first-time employment
  const isPfOptOutEligibleCandidate =
    statutory.previousPfMember === false &&
    statutory.epsMember === false &&
    statutory.internationalWorker === false;
  const form11ConsentReady = pfForm11Check1 && pfForm11Check2 && pfForm11Check3;

  const canSubmit = statutory.declarationAccepted && otpVerified;

  return (
    <Card className="border-t-4 border-t-emerald-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg">✅</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Statutory Declaration & Submit</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Final step — OTP verification and submission</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5 space-y-5">

        {/* Statutory Declarations */}
        <SectionHead sub="Required for PF and statutory compliance">Statutory Information</SectionHead>
        <div className="grid gap-5 sm:grid-cols-3">
          <YNChip
            label="Previous PF Member?"
            value={statutory.previousPfMember}
            onChange={(v) => updS("previousPfMember", v)}
            helpText="Were you a PF member in any previous job?"
          />
          <YNChip
            label="EPS Member?"
            value={statutory.epsMember}
            onChange={(v) => updS("epsMember", v)}
            helpText="Employee Pension Scheme membership"
          />
          <YNChip
            label="International Worker?"
            value={statutory.internationalWorker}
            onChange={(v) => updS("internationalWorker", v)}
            helpText="Are you a foreign national or hold foreign passport?"
          />
        </div>

        {/* Form 11 — PF Opt-Out (EPF Act §17(1) — Excluded Employee) */}
        {isPfOptOutEligibleCandidate && (
          <div>
            <SectionHead sub="Employees' Provident Fund Act §17(1) — Excluded Employee Option">
              PF Opt-Out Declaration (Form 11)
            </SectionHead>
            {pfOptOutConsented ? (
              <InfoBox variant="success">
                <p className="font-bold">PF Opt-Out Consent Recorded</p>
                <p className="text-xs mt-0.5">
                  You elected to opt out of PF contributions under EPF Act §17(1) on{" "}
                  {pfOptOutConsentedAt ? new Date(pfOptOutConsentedAt).toLocaleString("en-IN") : "—"}.
                  This election is final and cannot be changed.
                </p>
                <p className="text-xs mt-1 text-emerald-700 font-semibold">
                  Your CTC = Gross = Net-in-Hand (no statutory deductions will apply).
                </p>
              </InfoBox>
            ) : pfOptOutElected === false ? (
              <InfoBox variant="info">
                <p className="font-bold">PF Deductions Will Apply</p>
                <p className="text-xs mt-0.5">
                  You chose to keep PF contributions. Standard PF/ESI deductions will apply per EPF Act rules.
                </p>
              </InfoBox>
            ) : (
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-5 space-y-4">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-blue-900">
                    You may be eligible to opt out of PF under EPF Act §17(1)
                  </p>
                  <p className="text-xs text-blue-800 leading-relaxed">
                    Since this is your first employment and you have never been a PF member, you can choose to opt out.
                    If your basic salary exceeds ₹15,000/month, you qualify as an "Excluded Employee."
                    <strong> This is an irrevocable, one-time election.</strong>
                  </p>
                </div>

                <div className="rounded-lg border border-blue-300 bg-white p-4 space-y-3">
                  <p className="text-xs font-black uppercase tracking-wide text-blue-700">Form 11 — Online Declaration</p>
                  <p className="text-xs text-slate-700 leading-relaxed italic border-l-4 border-blue-300 pl-3">
                    "I hereby declare that I am joining employment for the first time and have never been a member
                    of the Employees' Provident Fund or the Employees' Pension Scheme. I have never held a UAN or
                    PF account. I wish to exercise my option under Section 17(1) of the EPF &amp; MP Act, 1952 to be
                    treated as an Excluded Employee. I understand this is a one-time irrevocable election."
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    { state: pfForm11Check1, set: setPfForm11Check1, label: "I confirm this is my first employment — I have never worked anywhere before." },
                    { state: pfForm11Check2, set: setPfForm11Check2, label: "I confirm I have never held a UAN (Universal Account Number) or any PF account." },
                    { state: pfForm11Check3, set: setPfForm11Check3, label: "I understand this PF opt-out election is irrevocable and cannot be changed after joining." },
                  ].map(({ state, set, label }, i) => (
                    <label key={i} className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-all ${state ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200 hover:border-slate-400"}`}>
                      <input
                        type="checkbox"
                        checked={state}
                        onChange={(e) => set(e.target.checked)}
                        className="mt-0.5 h-5 w-5 flex-shrink-0 accent-emerald-600"
                      />
                      <span className="text-sm text-slate-800">{label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => onPfOptOutConsent(true)}
                    disabled={!form11ConsentReady || pfOptOutSaving}
                    size="lg"
                    className="min-h-[52px] px-6 text-sm font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                  >
                    {pfOptOutSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Shield className="h-5 w-5" />}
                    I Consent — Opt Out of PF
                  </Button>
                  <Button
                    onClick={() => onPfOptOutConsent(false)}
                    disabled={pfOptOutSaving}
                    variant="outline"
                    size="lg"
                    className="min-h-[52px] px-6 text-sm font-semibold rounded-xl border-2"
                  >
                    No, Keep PF Deductions
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  You must make a selection before submitting. This step is only available to first-time employees.
                </p>
              </div>
            )}
          </div>
        )}

        {/* OTP Verification */}
        <SectionHead sub="Verify your registered mobile number">Mobile OTP Verification</SectionHead>
        {otpVerified ? (
          <InfoBox variant="success">
            <p className="font-bold">Mobile Verified Successfully</p>
            <p className="text-xs mt-0.5">{employee.mobileNumber} has been verified via OTP.</p>
          </InfoBox>
        ) : (
          <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-5 space-y-4">
            <p className="text-sm text-slate-700">
              An OTP will be sent to your registered mobile number:{" "}
              <strong className="text-slate-950">{employee.mobileNumber || "Not entered"}</strong>
            </p>
            {!employee.mobileNumber && (
              <InfoBox variant="warning">
                <p className="text-xs font-bold">Mobile number missing — go back to Step 2 and enter your mobile number first.</p>
              </InfoBox>
            )}
            <div className="flex flex-wrap gap-3 items-end">
              <Button
                variant="outline"
                onClick={onSendOtp}
                disabled={saving || !employee.mobileNumber}
                size="lg"
                className="min-h-[52px] px-6 text-base font-bold rounded-xl border-2"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                {otpSent ? "Resend OTP" : "Send OTP"}
              </Button>

              {otpSent && (
                <div className="flex gap-3 items-end">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold">Enter OTP</Label>
                    <Input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      maxLength={6}
                      inputMode="numeric"
                      className="w-40 min-h-[52px] text-xl text-center font-mono tracking-[0.4em] rounded-xl border-2 border-slate-200"
                      placeholder="000000"
                    />
                  </div>
                  <Button
                    onClick={onVerifyOtp}
                    disabled={saving || otpCode.length !== 6}
                    size="lg"
                    className="min-h-[52px] px-6 text-base font-bold bg-emerald-600 hover:bg-emerald-700 rounded-xl gap-2"
                  >
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                    Verify
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Declaration */}
        <SectionHead sub="Read carefully and accept">Declaration</SectionHead>
        <label className={`flex items-start gap-4 cursor-pointer p-5 rounded-xl border-2 transition-all ${statutory.declarationAccepted ? "bg-emerald-50 border-emerald-300" : "bg-slate-50 border-slate-300 hover:border-slate-500"}`}>
          <input
            type="checkbox"
            checked={statutory.declarationAccepted}
            onChange={(e) => updS("declarationAccepted", e.target.checked)}
            className="mt-0.5 h-5 w-5 flex-shrink-0 accent-emerald-600"
          />
          <span className="text-sm leading-relaxed text-slate-800">
            I hereby declare that all information furnished above is{" "}
            <strong>true, correct and complete</strong> to the best of my knowledge and belief.
            I understand that any misrepresentation, concealment or omission of facts may result in{" "}
            <strong>rejection of my candidature or termination of employment</strong>, and I accept full responsibility for the accuracy of this information.
            I also consent to verification of all details provided, including employment history, educational credentials and identity documents.
          </span>
        </label>

        {/* Review Summary */}
        <SectionHead sub="Quick check before final submission">Submission Checklist</SectionHead>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Name", value: employee.employeeName, ok: Boolean(employee.employeeName) },
            { label: "PAN", value: employee.panNumber ? `${employee.panNumber.slice(0, 3)}XXXXX${employee.panNumber.slice(-2)}` : "Not entered", ok: Boolean(employee.panNumber) },
            { label: "Documents", value: `${status?.documents.length || 0} uploaded`, ok: (status?.documents.length ?? 0) >= 3 },
            { label: "BGV Status", value: bgv?.overall_status || "Not run / Manual", ok: true },
            { label: "Bank", value: bank.bankName || "Not saved", ok: Boolean(bank.bankName) },
            { label: "Profile Completion", value: `${completion}%`, ok: completion >= 60 },
            { label: "OTP", value: otpVerified ? "Verified ✓" : "Not verified", ok: otpVerified },
            { label: "Declaration", value: statutory.declarationAccepted ? "Signed ✓" : "Not signed", ok: statutory.declarationAccepted },
            { label: "Qualifications", value: `${status?.qualifications.length || 0} added`, ok: (status?.qualifications.length ?? 0) >= 1 },
          ].map(({ label, value, ok }) => (
            <div key={label} className={`rounded-xl border-2 p-3 ${ok ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
                {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
              </div>
              <p className="mt-1 font-semibold text-slate-900 text-sm">{value}</p>
            </div>
          ))}
        </div>

        {/* Submit section */}
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 space-y-4">
          <p className="font-bold text-emerald-900 text-sm">Ready to submit?</p>
          <p className="text-xs text-emerald-800 leading-relaxed">
            Once submitted, your profile goes to the HR team for review. You will receive a confirmation on your registered
            mobile and email. You <strong>cannot edit</strong> your submission after this step.
          </p>

          {!canSubmit && (
            <div className="space-y-1.5">
              {!otpVerified && (
                <p className="text-xs text-red-700 font-bold flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> Mobile OTP must be verified before submission
                </p>
              )}
              {!statutory.declarationAccepted && (
                <p className="text-xs text-red-700 font-bold flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> Declaration must be accepted before submission
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={onSave}
              disabled={saving}
              size="lg"
              className="min-h-[52px] px-6 text-base font-semibold rounded-xl border-2"
            >
              Save Progress
            </Button>
            <Button
              onClick={onSubmit}
              disabled={saving || !canSubmit}
              size="lg"
              className={`min-h-[52px] px-10 text-base font-black rounded-xl shadow-xl gap-2 ${
                canSubmit
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-slate-300 text-slate-500 cursor-not-allowed"
              }`}
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              Submit Onboarding
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
