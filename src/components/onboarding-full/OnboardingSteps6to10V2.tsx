/**
 * Onboarding Steps 7-10 V2 — MAS HRMS Design Patterns
 *
 * Redesigned UI with glassmorphism, gradient headers, colored sections.
 * ALL BACKEND LOGIC UNCHANGED — Only styling updated.
 */

import { useState } from "react";
import {
  AlertCircle, CheckCircle2, Loader2, Plus, Trash2, Shield,
  GraduationCap, BookOpen, Briefcase, Building2, Users, Heart,
  Languages, FileText, Smartphone, Send, BadgeCheck, User,
  CreditCard, Percent, FileCheck, Phone, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  F, RO, SectionHead, InfoBox, YNChip,
  GlassCard, GradientCardHeader, ChecklistCard, SECTION_COLORS,
} from "./OnboardingFormPrimitivesV2";
import type {
  QualForm, ExperienceForm, FamilyForm, LanguageRow, FamilyMemberRow,
  StatutoryForm, StatusData, BgvStatus, BankForm,
} from "./useOnboardingFull";
import { EMPTY_QUAL, FAMILY_MEMBER_LIMIT, hasSavedMaskedValue } from "./useOnboardingFull";
import { findMissingBlockingDocs } from "./mandatoryDocuments";

// ── Constants ─────────────────────────────────────────────────────────────────

const QUALS = ["10th / SSC", "12th / HSC", "ITI", "Diploma", "Graduate (B.A./B.Com/B.Sc/BBA)", "Graduate (B.Tech/BE)", "Post Graduate (MA/MCom/MSc/MBA)", "Post Graduate (M.Tech/ME)", "PhD / Doctorate", "Other"];
const EXP_OPTS = ["Fresher (No Experience)", "Less than 6 months", "6 months – 1 year", "1–2 years", "2–3 years", "3–5 years", "5+ years"];
const PROFICIENCIES = ["Basic", "Intermediate", "Fluent", "Native / Mother tongue"];
const LANGUAGES_COMMON = ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia", "Urdu", "Assamese", "Maithili"];
const EXP_DOC_TYPES = ["Experience Letter", "Appointment Letter", "Relieving Letter", "Offer Letter", "Form 16", "Salary Slip", "Employment Certificate", "Other"];
const FAMILY_RELATIONS = ["Spouse", "Son", "Daughter", "Father", "Mother", "Brother", "Sister", "Other"];

// ── Step 7: Education (Redesigned) ────────────────────────────────────────────

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
    <GlassCard>
      <GradientCardHeader
        title="Education & Qualifications"
        subtitle={`${status?.qualifications.length ?? 0} qualifications added`}
        icon={GraduationCap}
        color="cyan"
      />
      <div className="p-5 space-y-5">

        <InfoBox variant="info">
          <p className="font-bold">Add each qualification separately</p>
          <p className="text-xs mt-1">At minimum, add your 10th / SSC qualification. Upload marksheets in the Documents step.</p>
        </InfoBox>

        <SectionHead icon={Plus} color="cyan">Add Qualification</SectionHead>
        <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <F label="Qualification Level" value={qual.qualification} onChange={(v) => upd("qualification", v)} opts={QUALS} required />
            <F label="Specialization / Course" value={qual.specializationCourseName} onChange={(v) => upd("specializationCourseName", v)} placeholder="e.g. Computer Science" />
            <F label="Institution Name" value={qual.institutionName} onChange={(v) => upd("institutionName", v)} placeholder="College/School name" />
            <F label="Board / University" value={qual.boardType} onChange={(v) => upd("boardType", v)} placeholder="e.g. CBSE, Osmania" />
            <F label="Year of Passing" value={qual.passedOutYear} onChange={(v) => upd("passedOutYear", v)} mode="numeric" placeholder={String(new Date().getFullYear())} required error={!yearOk ? "Enter valid year (1970–present)" : ""} />
            <F label="Percentage / CGPA" value={qual.passedOutPercentage} onChange={(v) => upd("passedOutPercentage", v)} mode="decimal" placeholder="e.g. 72.5 or 7.8" />
            <F label="State" value={qual.passedOutState} onChange={(v) => upd("passedOutState", v)} placeholder="State of institution" />
            <F label="City" value={qual.passedOutCity} onChange={(v) => upd("passedOutCity", v)} placeholder="City of institution" />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              onClick={onAdd}
              disabled={saving || !qual.qualification || !yearOk}
              className="min-h-[52px] px-6 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700 text-white font-bold rounded-xl shadow-lg gap-2"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              Add Qualification
            </Button>
            <Button
              variant="outline"
              onClick={() => setQual(EMPTY_QUAL)}
              disabled={saving}
              className="min-h-[52px] px-6 font-semibold rounded-xl border-2"
            >
              Clear Form
            </Button>
          </div>
        </div>

        <SectionHead icon={BookOpen} color="teal">Added Qualifications</SectionHead>
        {!status?.qualifications.length ? (
          <div className="text-center py-10 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200">
            <GraduationCap className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-400">No qualifications added yet</p>
            <p className="text-xs text-slate-400 mt-1">Add at least your 10th / SSC qualification</p>
          </div>
        ) : (
          <div className="space-y-3">
            {status?.qualifications.map((q, idx) => (
              <div key={q.id} className="flex items-start gap-4 rounded-xl border-2 border-cyan-200 bg-cyan-50 px-4 py-4">
                <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-black">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900">{q.qualification}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {q.specialization_course_name && <span className="text-xs bg-slate-200 text-slate-700 rounded-full px-2.5 py-1">{q.specialization_course_name}</span>}
                    {q.institution_name && <span className="text-xs bg-slate-200 text-slate-700 rounded-full px-2.5 py-1">{q.institution_name}</span>}
                    {q.passed_out_year && <span className="text-xs bg-cyan-100 text-cyan-700 rounded-full px-2.5 py-1">Year: {q.passed_out_year}</span>}
                    {q.passed_out_percentage && <span className="text-xs bg-cyan-100 text-cyan-700 rounded-full px-2.5 py-1">{q.passed_out_percentage}%</span>}
                  </div>
                </div>
                <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ── Step 8: Experience (Redesigned) ───────────────────────────────────────────

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
    <GlassCard>
      <GradientCardHeader
        title="Work Experience"
        subtitle="Previous employment history (if any)"
        icon={Briefcase}
        color="pink"
      />
      <div className="p-5 space-y-5">

        <SectionHead icon={Briefcase} color="pink">Experience Level</SectionHead>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXP_OPTS.map((exp) => (
            <button
              key={exp}
              type="button"
              onClick={() => updExp("workingExperience", exp)}
              className={`min-h-[52px] rounded-xl border-2 font-semibold text-sm transition-all px-4 py-3 text-left ${
                experience.workingExperience === exp
                  ? "border-pink-500 bg-pink-50 text-pink-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-pink-300"
              }`}
            >
              {experience.workingExperience === exp && <span className="mr-2">✓</span>}
              {exp}
            </button>
          ))}
        </div>

        {isFresher ? (
          <InfoBox variant="success">
            <p className="font-bold">Fresher Profile Selected</p>
            <p className="text-xs mt-1">No work experience details required. Upload your latest marksheet/certificate in Documents.</p>
          </InfoBox>
        ) : (
          <>
            <SectionHead icon={Building2} color="violet">Previous Employment Details</SectionHead>
            <div className="rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 border-2 border-pink-200 p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-1">
                  <F label="Company Name" value={experience.employerName} onChange={(v) => updExp("employerName", v)} required placeholder="Full company name" />
                </div>
                <F label="Designation / Role" value={experience.lastDesignation} onChange={(v) => updExp("lastDesignation", v)} required placeholder="e.g. Customer Care Executive" />
                <F label="Experience (years)" value={experience.experienceYear} onChange={(v) => updExp("experienceYear", v)} mode="decimal" placeholder="e.g. 1.5" />
                <F label="Last CTC (Annual ₹)" value={experience.lastCtc} onChange={(v) => updExp("lastCtc", v)} mode="numeric" placeholder="Annual CTC in rupees" />
                <F label="From Date" value={experience.fromDate} onChange={(v) => updExp("fromDate", v)} type="date" required />
                <F label="To Date" value={experience.toDate} onChange={(v) => updExp("toDate", v)} type="date" required error={dateOrderError} />
                <F label="Reason for Leaving" value={experience.reasonForLeaving} onChange={(v) => updExp("reasonForLeaving", v)} placeholder="e.g. Better opportunity" />
                <F label="Document Type Available" value={experience.experienceDocType} onChange={(v) => updExp("experienceDocType", v)} opts={EXP_DOC_TYPES} helpText="What document can you provide?" />
              </div>
            </div>

            <InfoBox variant="warning">
              <p className="text-xs">Upload experience letter, relieving letter or salary slip in the Documents step.</p>
            </InfoBox>
          </>
        )}

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button
            onClick={onSave}
            disabled={saving}
            className="min-h-[52px] px-8 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold rounded-xl shadow-lg gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Experience Details
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Step 9: Family & Language (Redesigned) ────────────────────────────────────

export function Step9FamilyLang({
  family, setFamily, languages, setLanguages, familyMembers, setFamilyMembers, saving, onSave,
}: {
  family: FamilyForm;
  setFamily: React.Dispatch<React.SetStateAction<FamilyForm>>;
  languages: LanguageRow[];
  setLanguages: React.Dispatch<React.SetStateAction<LanguageRow[]>>;
  familyMembers: FamilyMemberRow[];
  setFamilyMembers: React.Dispatch<React.SetStateAction<FamilyMemberRow[]>>;
  saving: boolean;
  onSave: () => void;
}) {
  const updFam = (k: keyof FamilyForm, v: string) => setFamily((p) => ({ ...p, [k]: v }));
  const EMPTY_MEMBER = { memberName: "", relation: "", dob: "", address: "", isEpsNominee: false };
  const [newMember, setNewMember] = useState(EMPTY_MEMBER);
  const familyFull = familyMembers.length >= FAMILY_MEMBER_LIMIT;
  const epsTaken = familyMembers.some((m) => m.isEpsNominee);

  const addMember = () => {
    const name = newMember.memberName.trim();
    if (!name || familyFull) return;
    setFamilyMembers((prev) => [...prev, { ...newMember, memberName: name, isEpsNominee: newMember.isEpsNominee && !epsTaken, id: String(Date.now()) }]);
    setNewMember(EMPTY_MEMBER);
  };

  const [newLang, setNewLang] = useState({ language_name: "", can_read: false, can_write: false, can_speak: false, proficiency: "Intermediate" });

  const addLanguage = () => {
    const name = newLang.language_name.trim();
    if (!name || languages.some((l) => l.language_name.toLowerCase() === name.toLowerCase())) return;
    if (!newLang.can_read && !newLang.can_write && !newLang.can_speak) {
      setNewLang((p) => ({ ...p, can_speak: true }));
      return;
    }
    setLanguages((prev) => [...prev, { ...newLang, id: String(Date.now()) }]);
    setNewLang({ language_name: "", can_read: false, can_write: false, can_speak: false, proficiency: "Intermediate" });
  };

  return (
    <GlassCard>
      <GradientCardHeader
        title="Family & Language Skills"
        subtitle="Family information and languages you know"
        icon={Users}
        color="teal"
      />
      <div className="p-5 space-y-5">

        <SectionHead icon={Heart} color="pink">Family Information</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Annual Household Income (₹)" value={family.annualIncome} onChange={(v) => updFam("annualIncome", v)} mode="numeric" placeholder="Approximate annual income" helpText="All family members combined" />
          <F label="Number of Dependents" value={family.countOfDependents} onChange={(v) => updFam("countOfDependents", v)} mode="numeric" placeholder="Including yourself" />
        </div>

        <SectionHead icon={Users} color="emerald">Family Members (EPF Form 2)</SectionHead>
        <InfoBox variant="info">
          <p className="text-xs">Add family members for EPF pension scheme. Add up to <strong>{FAMILY_MEMBER_LIMIT}</strong> members.</p>
        </InfoBox>

        <div className="rounded-xl bg-gradient-to-br from-teal-50 to-emerald-50 border-2 border-teal-200 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <F label="Member Name" value={newMember.memberName} onChange={(v) => setNewMember((p) => ({ ...p, memberName: v }))} placeholder="Full name" />
            <F label="Relationship" value={newMember.relation} onChange={(v) => setNewMember((p) => ({ ...p, relation: v }))} opts={FAMILY_RELATIONS} />
            <F label="Date of Birth" value={newMember.dob} onChange={(v) => setNewMember((p) => ({ ...p, dob: v }))} type="date" />
            <Button onClick={addMember} disabled={!newMember.memberName.trim() || familyFull} className="min-h-[52px] bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {familyMembers.length > 0 && (
          <div className="space-y-2">
            {familyMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl bg-emerald-50 border-2 border-emerald-200">
                <User className="h-5 w-5 text-emerald-600" />
                <div className="flex-1">
                  <p className="font-bold text-emerald-800">{m.memberName}</p>
                  <div className="flex gap-2 mt-1">
                    {m.relation && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{m.relation}</span>}
                    {m.dob && <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">DOB: {m.dob}</span>}
                  </div>
                </div>
                <button onClick={() => setFamilyMembers((p) => p.filter((x) => x.id !== m.id))} className="p-2 hover:bg-rose-100 rounded-lg">
                  <Trash2 className="h-4 w-4 text-rose-400" />
                </button>
              </div>
            ))}
          </div>
        )}

        <SectionHead icon={Languages} color="cyan">Language Proficiency</SectionHead>
        <InfoBox variant="info">
          <p className="text-xs">Add at least <strong>English</strong> and your regional language.</p>
        </InfoBox>

        <div className="flex flex-wrap gap-2">
          {LANGUAGES_COMMON.map((l) => {
            const added = languages.some((la) => la.language_name === l);
            return (
              <button
                key={l}
                type="button"
                disabled={added}
                onClick={() => setNewLang((p) => ({ ...p, language_name: l }))}
                className={`rounded-full border-2 px-4 py-2 text-sm font-semibold transition-all ${
                  added ? "border-emerald-200 bg-emerald-50 text-emerald-600" :
                  newLang.language_name === l ? "border-teal-500 bg-teal-50 text-teal-700" :
                  "border-slate-200 bg-white hover:border-teal-400"
                }`}
              >
                {added && "✓ "}{l}
              </button>
            );
          })}
        </div>

        <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <F label="Language" value={newLang.language_name} onChange={(v) => setNewLang((p) => ({ ...p, language_name: v }))} placeholder="Type or select above" />
            <F label="Proficiency" value={newLang.proficiency} onChange={(v) => setNewLang((p) => ({ ...p, proficiency: v }))} opts={PROFICIENCIES} />
            <div className="flex gap-4">
              {(["can_read", "can_write", "can_speak"] as const).map((sk) => (
                <label key={sk} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={newLang[sk]} onChange={() => setNewLang((p) => ({ ...p, [sk]: !p[sk] }))} className="h-4 w-4 accent-teal-600" />
                  <span className="capitalize font-medium">{sk.replace("can_", "")}</span>
                </label>
              ))}
            </div>
            <Button onClick={addLanguage} disabled={!newLang.language_name.trim()} className="min-h-[52px] bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl gap-2">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {languages.length > 0 && (
          <div className="overflow-x-auto rounded-xl border-2 border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b-2 border-slate-200">
                <tr>
                  {["Language", "Read", "Write", "Speak", "Level", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {languages.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{l.language_name}</td>
                    <td className="px-4 py-3 text-center">{l.can_read ? "✓" : "—"}</td>
                    <td className="px-4 py-3 text-center">{l.can_write ? "✓" : "—"}</td>
                    <td className="px-4 py-3 text-center">{l.can_speak ? "✓" : "—"}</td>
                    <td className="px-4 py-3 text-teal-700 font-semibold">{l.proficiency}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setLanguages((p) => p.filter((x) => x.id !== l.id))} className="p-1.5 hover:bg-rose-50 rounded-lg">
                        <Trash2 className="h-4 w-4 text-rose-400" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button onClick={onSave} disabled={saving} className="min-h-[52px] px-8 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-bold rounded-xl shadow-lg gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Family & Language
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Step 10: Statutory & Submit (Redesigned) ──────────────────────────────────

export function Step10Statutory({
  statutory, setStatutory, otpSent, otpVerified, otpCode, setOtpCode, otpChannels,
  saving, employee, bank, status, bgv, completion,
  pfOptOutElected, pfOptOutSaving, pfOptOutConsented, pfOptOutConsentedAt,
  onPfOptOutConsent,
  onSendOtp, onVerifyOtp, onSave, onSubmit,
  consentAccepted, privacyConsentAccepted, onGoToDocuments,
}: {
  statutory: StatutoryForm;
  setStatutory: React.Dispatch<React.SetStateAction<StatutoryForm>>;
  otpSent: boolean;
  otpVerified: boolean;
  otpChannels: { sms: boolean; email: boolean } | null;
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
  consentAccepted: boolean;
  privacyConsentAccepted: boolean;
  onGoToDocuments?: () => void;
}) {
  const updS = (k: keyof StatutoryForm, v: any) => setStatutory((p) => ({ ...p, [k]: v }));
  const [pfForm11Check1, setPfForm11Check1] = useState(false);
  const [pfForm11Check2, setPfForm11Check2] = useState(false);
  const [pfForm11Check3, setPfForm11Check3] = useState(false);

  const isPfOptOutEligibleCandidate = statutory.previousPfMember === false && statutory.epsMember === false && statutory.internationalWorker === false;
  const form11ConsentReady = pfForm11Check1 && pfForm11Check2 && pfForm11Check3;

  const digilockerDone = status?.digilocker?.status === "documents_received";
  const missingMandatoryDocs = findMissingBlockingDocs(status?.documents, digilockerDone);
  const documentsOk = missingMandatoryDocs.length === 0;
  const canSubmit = statutory.declarationAccepted && otpVerified && privacyConsentAccepted && consentAccepted && documentsOk;

  return (
    <GlassCard>
      <GradientCardHeader
        title="Statutory Declaration & Submit"
        subtitle="Final step — OTP verification and submission"
        icon={Send}
        color="emerald"
      />
      <div className="p-5 space-y-5">

        <SectionHead icon={Shield} color="purple">Statutory Information</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <YNChip label="Previous PF Member?" value={statutory.previousPfMember} onChange={(v) => updS("previousPfMember", v)} helpText="Were you a PF member before?" />
          <YNChip label="EPS Member?" value={statutory.epsMember} onChange={(v) => updS("epsMember", v)} helpText="Employee Pension Scheme" />
          <YNChip label="International Worker?" value={statutory.internationalWorker} onChange={(v) => updS("internationalWorker", v)} helpText="Foreign national?" />
        </div>

        {/* PF Opt-Out */}
        {isPfOptOutEligibleCandidate && !pfOptOutConsented && pfOptOutElected === null && (
          <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-5 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Shield className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-blue-900">PF Opt-Out Available (Form 11)</p>
                <p className="text-sm text-blue-800 mt-1">Since this is your first employment, you can opt out of PF. <strong>This is irrevocable.</strong></p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { state: pfForm11Check1, set: setPfForm11Check1, label: "I confirm this is my first employment" },
                { state: pfForm11Check2, set: setPfForm11Check2, label: "I confirm I have never held a UAN or PF account" },
                { state: pfForm11Check3, set: setPfForm11Check3, label: "I understand this election is irrevocable" },
              ].map(({ state, set, label }, i) => (
                <label key={i} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${state ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200"}`}>
                  <input type="checkbox" checked={state} onChange={(e) => set(e.target.checked)} className="h-5 w-5 accent-emerald-600" />
                  <span className="text-sm text-slate-800">{label}</span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => onPfOptOutConsent(true)} disabled={!form11ConsentReady || pfOptOutSaving} className="min-h-[52px] px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl gap-2">
                {pfOptOutSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Shield className="h-5 w-5" />}
                Opt Out of PF
              </Button>
              <Button variant="outline" onClick={() => onPfOptOutConsent(false)} disabled={pfOptOutSaving} className="min-h-[52px] px-6 font-semibold rounded-xl border-2">
                Keep PF Deductions
              </Button>
            </div>
          </div>
        )}

        {pfOptOutConsented && (
          <InfoBox variant="success">
            <p className="font-bold">PF Opt-Out Recorded</p>
            <p className="text-xs mt-1">Your CTC = Gross = Net-in-Hand (no PF deductions).</p>
          </InfoBox>
        )}

        {/* OTP Verification */}
        <SectionHead icon={Smartphone} color="teal">OTP Verification</SectionHead>
        {otpVerified ? (
          <InfoBox variant="success">
            <p className="font-bold">OTP Verified Successfully</p>
            <p className="text-xs mt-1">{employee.mobileNumber} has been verified.</p>
          </InfoBox>
        ) : (
          <div className="rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 border-2 border-teal-200 p-5 space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-teal-200">
                <Phone className="h-4 w-4 text-teal-600" />
                <span className="font-semibold text-slate-800">{employee.mobileNumber || "Not entered"}</span>
              </div>
            </div>

            {otpSent && otpChannels && (
              <InfoBox variant={otpChannels.sms || otpChannels.email ? "success" : "warning"}>
                <p className="text-xs font-bold">
                  {otpChannels.sms && otpChannels.email ? "OTP sent to mobile and email." :
                   otpChannels.email ? "OTP sent to email (SMS failed)." : "Could not deliver OTP."}
                </p>
              </InfoBox>
            )}

            <div className="flex flex-wrap gap-3 items-end">
              <Button variant="outline" onClick={onSendOtp} disabled={saving || !employee.mobileNumber} className="min-h-[52px] px-6 font-bold rounded-xl border-2 gap-2">
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                {otpSent ? "Resend OTP" : "Send OTP"}
              </Button>

              {otpSent && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">Enter OTP</Label>
                    <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} maxLength={6} inputMode="numeric" className="w-40 min-h-[52px] text-xl text-center font-mono tracking-[0.4em] rounded-xl border-2" placeholder="000000" />
                  </div>
                  <Button onClick={onVerifyOtp} disabled={saving || otpCode.length !== 6} className="min-h-[52px] px-6 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl gap-2">
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                    Verify
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Declaration */}
        <SectionHead icon={FileText} color="amber">Declaration</SectionHead>
        <label className={`flex items-start gap-4 cursor-pointer p-5 rounded-xl border-2 transition-all ${
          statutory.declarationAccepted ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-200"
        }`}>
          <input type="checkbox" checked={statutory.declarationAccepted} onChange={(e) => updS("declarationAccepted", e.target.checked)} className="mt-1 h-6 w-6 accent-emerald-600" />
          <span className="text-sm leading-relaxed text-slate-800">
            I declare that all information is <strong>true, correct and complete</strong>. Misrepresentation may result in <strong>rejection or termination</strong>.
          </span>
        </label>

        {/* Checklist */}
        <SectionHead icon={BadgeCheck} color="indigo">Submission Checklist</SectionHead>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <ChecklistCard label="Name" value={employee.employeeName || "—"} ok={Boolean(employee.employeeName)} icon={User} tone="blue" />
          <ChecklistCard label="PAN" value={employee.panNumber ? `${employee.panNumber.slice(0,3)}XXX${employee.panNumber.slice(-2)}` : "—"} ok={Boolean(employee.panNumber)} icon={CreditCard} tone="purple" />
          <ChecklistCard label="Documents" value={`${status?.documents.length || 0} uploaded`} ok={(status?.documents.length ?? 0) >= 3} icon={FileText} tone="green" />
          <ChecklistCard label="BGV" value={bgv?.overall_status || "Pending"} ok={bgv?.overall_status === "verified" || consentAccepted} icon={Shield} tone="teal" />
          <ChecklistCard label="Bank" value={bank.bankName || "Not saved"} ok={Boolean(bank.bankName)} icon={Building2} tone="blue" />
          <ChecklistCard label="OTP" value={otpVerified ? "Verified" : "Not verified"} ok={otpVerified} icon={Smartphone} tone="teal" />
          <ChecklistCard label="Declaration" value={statutory.declarationAccepted ? "Signed" : "Not signed"} ok={statutory.declarationAccepted} icon={FileCheck} tone="amber" />
          <ChecklistCard label="Qualifications" value={`${status?.qualifications.length || 0} added`} ok={(status?.qualifications.length ?? 0) >= 1} icon={BadgeCheck} tone="purple" />
          <ChecklistCard label="Completion" value={`${completion}%`} ok={completion >= 60} icon={Percent} tone="green" />
        </div>

        {/* Submit */}
        <div className="rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 p-6 space-y-4 text-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Send className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="font-bold text-lg">Ready to submit?</p>
              <p className="text-emerald-100 text-sm">Your profile will go to HR for review</p>
            </div>
          </div>

          {!canSubmit && (
            <div className="rounded-xl bg-white/10 border border-white/20 p-4 space-y-2">
              <p className="text-sm font-bold">Complete these steps:</p>
              {!privacyConsentAccepted && <p className="text-xs flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Privacy consent required (Step 1)</p>}
              {!consentAccepted && <p className="text-xs flex items-center gap-2"><AlertCircle className="h-4 w-4" /> BGV consent required (Step 5)</p>}
              {!documentsOk && <p className="text-xs flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Missing documents: {missingMandatoryDocs.map(d => d.label).join(", ")}</p>}
              {!otpVerified && <p className="text-xs flex items-center gap-2"><AlertCircle className="h-4 w-4" /> OTP must be verified</p>}
              {!statutory.declarationAccepted && <p className="text-xs flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Declaration must be accepted</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={onSave} disabled={saving} className="min-h-[52px] px-6 font-semibold rounded-xl border-2 border-white/30 bg-white/10 text-white hover:bg-white/20">
              Save Progress
            </Button>
            <Button onClick={onSubmit} disabled={saving || !canSubmit} className={`min-h-[52px] px-10 font-black rounded-xl gap-2 ${canSubmit ? "bg-white text-emerald-700 hover:bg-emerald-50 shadow-xl" : "bg-white/30 text-white/60"}`}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              Submit Onboarding
            </Button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
