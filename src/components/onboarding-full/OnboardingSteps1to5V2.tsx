/**
 * Onboarding Steps 1-6 V2 — MAS HRMS Design Patterns
 *
 * Redesigned UI with:
 * - Glassmorphism cards
 * - Gradient headers
 * - Colored sections
 * - Enhanced visual hierarchy
 *
 * ALL BACKEND LOGIC UNCHANGED — Only styling updated.
 * All props, handlers, and API calls remain identical to V1.
 */

import { useState, useCallback } from "react";
import {
  AlertCircle, Camera, CheckCircle2, ChevronDown, ChevronUp,
  FileUp, Info, Loader2, ShieldCheck, Trash2, Upload, WifiOff,
  User, Phone, Mail, Building2, Briefcase, Key, Home, MapPin,
  CreditCard, Fingerprint, FileImage, FileText, Eye, Landmark,
  IndianRupee, Heart, Globe, Calendar,
} from "lucide-react";
import { LiveSelfieCapture } from "./LiveSelfieCapture";
import { compressImageForUpload } from "@/lib/compressImageForUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  F, T, RO, Chip, SectionHead, InfoBox, YNChip,
  GlassCard, GradientCardHeader, DocumentCard, SECTION_COLORS,
} from "./OnboardingFormPrimitivesV2";
import type { EmployeeForm, BankForm, StatusData, BgvStatus } from "./useOnboardingFull";
import { PennyDropButton } from "./PennyDropButton";
import { INDIA_STATES, citiesForState, OTHER_CITY } from "@/data/indiaStatesCities";
import { findMissingMandatoryDocs, MANDATORY_DOCUMENT_RULES } from "./mandatoryDocuments";

// ── Constants (unchanged) ─────────────────────────────────────────────────────

const TITLES = ["Mr", "Mrs", "Ms", "Dr"];
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const MARITALS = ["Single", "Married", "Divorced", "Widowed", "Separated"];
const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONS = ["Father", "Husband", "Mother", "Wife", "Son", "Daughter", "Brother", "Sister", "Guardian"];
const NOM_RELS = ["Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Guardian"];
const ADDR_PROOFS = ["Aadhaar Card", "Driving License", "Voter ID", "Passport", "Rent Agreement", "Utility Bill", "Bank Passbook"];
const ACCOUNTS = ["Savings", "Current", "Salary"];

const REQUIRED_DOCS = [
  { type: "Aadhaar", label: "Aadhaar Card", required: true },
  { type: "PAN Card", label: "PAN Card", required: true },
  { type: "Address Proof", label: "Address Proof", required: true },
  { type: "Cancelled Cheque", label: "Cancelled Cheque / Bank Passbook (if you have an account)", required: false },
  { type: "Passport Photo", label: "Passport Size Photo", required: true },
  { type: "10th Marksheet", label: "10th Marksheet / Certificate", required: true },
  { type: "12th Marksheet", label: "12th Marksheet / Diploma Certificate", required: true },
  { type: "Degree Certificate", label: "Degree / Graduation Certificate (if applicable)", required: false },
  { type: "Experience Letter", label: "Experience Letter (if experienced)", required: false },
  { type: "Relieving Letter", label: "Relieving Letter (if experienced)", required: false },
  { type: "Salary Slip", label: "Last Salary Slip (if experienced)", required: false },
  { type: "Passport", label: "Passport (if applicable)", required: false },
  { type: "Driving License", label: "Driving License (if applicable)", required: false },
  { type: "Voter ID", label: "Voter ID (optional)", required: false },
];

const DOC_TYPES = [
  "Aadhaar", "PAN Card", "Passport", "Driving License", "Voter ID",
  "Cancelled Cheque", "Bank Passbook", "Passport Photo",
  "10th Marksheet", "12th Marksheet", "Degree Certificate", "Diploma Certificate",
  "Experience Letter", "Offer Letter", "Appointment Letter", "Salary Slip",
  "Relieving Letter", "NOC Letter", "Form 16", "Address Proof", "Other",
];

// City Field (unchanged logic)
function CityField({ state, city, onChange, required = true }: {
  state: string; city: string; onChange: (v: string) => void; required?: boolean;
}) {
  const options = citiesForState(state);
  const knownCities = options.slice(0, -1);
  const [forceOther, setForceOther] = useState(() => Boolean(city) && !knownCities.includes(city));

  if (forceOther) {
    return (
      <div className="space-y-1">
        <F label="City / District (type manually)" value={city} onChange={onChange}
          required={required} placeholder="Enter city" />
        <button
          type="button"
          className="text-xs text-indigo-600 underline underline-offset-2 font-semibold"
          onClick={() => { setForceOther(false); onChange(""); }}
        >
          ← Choose from list instead
        </button>
      </div>
    );
  }
  return (
    <F label="City / District" value={city}
      onChange={(v) => {
        if (v === OTHER_CITY) { setForceOther(true); onChange(""); }
        else onChange(v);
      }}
      opts={options} required={required} />
  );
}

// ── Step 1: Welcome (Redesigned) ──────────────────────────────────────────────

export function Step1Welcome({
  status,
  privacyConsentAccepted,
  onPrivacyConsent,
  consentAccepted = false,
  onConsent,
  saving = false,
}: {
  status: StatusData | null;
  privacyConsentAccepted: boolean;
  onPrivacyConsent: () => void;
  consentAccepted?: boolean;
  onConsent?: () => void;
  saving?: boolean;
}) {
  const t = status?.token;

  return (
    <div className="space-y-5">
      {/* Hero Card */}
      <GlassCard>
        <GradientCardHeader
          title="Welcome to MAS Callnet"
          subtitle={t?.full_name ? `Hi ${t.full_name.split(" ")[0]}! Your joining journey starts here.` : "Your joining journey starts here."}
          icon={Home}
          color="blue"
        />
        <div className="p-5">
          <SectionHead icon={User} color="blue">Your Details</SectionHead>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <RO label="Full Name" value={t?.full_name} highlight icon={User} color="blue" />
            <RO label="Mobile" value={t?.mobile} icon={Phone} color="emerald" />
            <RO label="Email" value={t?.email} icon={Mail} color="purple" />
            <RO label="Branch" value={t?.branch_name} icon={Building2} color="indigo" />
            <RO label="Process / LOB" value={t?.process_name} icon={Briefcase} color="pink" />
            <RO label="Candidate Code" value={t?.candidate_code || t?.candidate_id} icon={Key} color="amber" />
            <RO label="Source" value={t?.source_type} icon={Globe} />
            {t?.gender && <RO label="Gender" value={t.gender} icon={User} />}
          </div>
        </div>
      </GlassCard>

      {/* Instructions */}
      <GlassCard>
        <div className="p-5">
          <SectionHead icon={Info} color="indigo">Before You Begin</SectionHead>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: "📝", text: "Fill all 10 steps — details used for payroll, PF, ESI and HR records" },
              { icon: "💾", text: "Progress autosaves — no data will be lost if you refresh" },
              { icon: "⭐", text: "Fields marked with * are mandatory" },
              { icon: "📎", text: "Keep Aadhaar, PAN, Passbook scans ready" },
              { icon: "📱", text: "OTP verification required for final submission" },
              { icon: "🔒", text: "All data is encrypted and secure" },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-xl">{item.icon}</span>
                <span className="text-sm text-slate-700">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* Minor Warning */}
      {t?.is_minor && (
        <InfoBox variant="error">
          <p className="font-bold">Minor Candidate — Guardian Consent Required</p>
          <p className="text-xs mt-1">
            Under DPDP Act 2023 §9, processing personal data of minors requires parental/guardian consent.
            Please inform HR immediately.
          </p>
        </InfoBox>
      )}

      {/* DPDP Privacy Notice */}
      <GlassCard>
        <div className={`p-5 ${privacyConsentAccepted ? "bg-gradient-to-br from-emerald-50 to-green-50" : "bg-gradient-to-br from-indigo-50 to-purple-50"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${privacyConsentAccepted ? "bg-emerald-100" : "bg-indigo-100"}`}>
              <ShieldCheck className={`h-5 w-5 ${privacyConsentAccepted ? "text-emerald-600" : "text-indigo-600"}`} />
            </div>
            <div>
              <p className={`font-bold ${privacyConsentAccepted ? "text-emerald-800" : "text-indigo-800"}`}>
                Data Collection Notice (DPDP Act 2023)
              </p>
              <p className="text-xs text-slate-600">Required for processing your application</p>
            </div>
          </div>

          <div className="text-xs text-slate-700 space-y-2 mb-4 p-4 bg-white/80 rounded-xl border border-slate-200">
            <p><strong>What we collect:</strong> Identity (Aadhaar, PAN), contact details, address, bank account, employment history, family information, statutory details.</p>
            <p><strong>Why:</strong> Employment onboarding, payroll processing, statutory compliance (PF/ESIC/TDS), background verification.</p>
            <p><strong>Third parties:</strong> Luckpay (PAN/bank), Befisc (Aadhaar), Crimescan (court records).</p>
            <p><strong>Your rights:</strong> Access, correction, and withdrawal of consent (non-statutory data only).</p>
          </div>

          {!privacyConsentAccepted ? (
            <button
              type="button"
              onClick={onPrivacyConsent}
              className="w-full flex items-center gap-3 rounded-xl border-2 border-indigo-300 bg-white px-4 py-4 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 hover:border-indigo-400 transition-all active:scale-[0.99]"
            >
              <span className="w-6 h-6 rounded-lg border-2 border-indigo-400 flex-shrink-0 flex items-center justify-center">
                <span className="w-3 h-3 rounded bg-indigo-200" />
              </span>
              I consent to processing my personal data for employment purposes
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 p-3 bg-emerald-100 rounded-xl">
              <CheckCircle2 className="h-5 w-5" />
              Privacy consent recorded — you may proceed
            </div>
          )}
        </div>
      </GlassCard>

      {/* BGV Consent */}
      <GlassCard>
        <div className={`p-5 ${consentAccepted ? "bg-gradient-to-br from-emerald-50 to-green-50" : "bg-gradient-to-br from-violet-50 to-purple-50"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${consentAccepted ? "bg-emerald-100" : "bg-violet-100"}`}>
              <Eye className={`h-5 w-5 ${consentAccepted ? "text-emerald-600" : "text-violet-600"}`} />
            </div>
            <div>
              <p className={`font-bold ${consentAccepted ? "text-emerald-800" : "text-violet-800"}`}>
                Background Verification Consent
              </p>
              <p className="text-xs text-slate-600">Required for identity and employment verification</p>
            </div>
          </div>

          <div className="text-xs text-slate-700 space-y-2 mb-4 p-4 bg-white/80 rounded-xl border border-slate-200">
            <p><strong>What is checked:</strong> Identity (Aadhaar via DigiLocker, PAN), bank account ownership, previous employment via UAN.</p>
            <p><strong>Why now:</strong> These checks run on the next few steps. Granting consent here enables each verification.</p>
          </div>

          {!consentAccepted ? (
            <button
              type="button"
              onClick={onConsent}
              disabled={saving}
              className="w-full flex items-center gap-3 rounded-xl border-2 border-violet-300 bg-white px-4 py-4 text-sm font-semibold text-violet-800 hover:bg-violet-100 hover:border-violet-400 transition-all active:scale-[0.99] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span className="w-6 h-6 rounded-lg border-2 border-violet-400 flex-shrink-0 flex items-center justify-center">
                  <span className="w-3 h-3 rounded bg-violet-200" />
                </span>
              )}
              I authorise verification of my identity documents, bank account and employment history
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 p-3 bg-emerald-100 rounded-xl">
              <CheckCircle2 className="h-5 w-5" />
              Verification consent recorded — DigiLocker and checks are enabled
            </div>
          )}
        </div>
      </GlassCard>

      {/* Documents Checklist */}
      <GlassCard>
        <div className="p-5 bg-gradient-to-br from-amber-50 to-orange-50">
          <SectionHead icon={FileUp} color="amber">Documents to Keep Ready</SectionHead>
          <div className="grid gap-2 sm:grid-cols-2">
            {REQUIRED_DOCS.filter((d) => d.required).map((d) => (
              <div key={d.type} className="flex items-center gap-2 text-sm text-amber-800 p-2 bg-white/60 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="font-semibold">{d.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-700 mt-3 font-semibold p-2 bg-amber-100 rounded-lg">
            Experience letters / salary slips required if you have prior work experience.
          </p>
        </div>
      </GlassCard>
    </div>
  );
}

// ── Step 2: Personal Details (Redesigned) ─────────────────────────────────────

export function Step2Personal({
  employee, setEmployee, saving, onSave,
}: {
  employee: EmployeeForm;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  saving: boolean;
  onSave: () => void;
}) {
  const upd = (k: keyof EmployeeForm, v: string) => setEmployee((p) => ({ ...p, [k]: v }));

  return (
    <GlassCard>
      <GradientCardHeader
        title="Personal Details"
        subtitle="Basic information for your employee profile"
        icon={User}
        color="indigo"
      />
      <div className="p-5 space-y-5">

        <SectionHead icon={User} color="indigo">Basic Information</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Title" value={employee.title} onChange={(v) => upd("title", v)} opts={TITLES} required />
          <F label="First Name" value={employee.firstName} onChange={(v) => upd("firstName", v)} required placeholder="Given name" />
          <F label="Middle Name" value={employee.middleName} onChange={(v) => upd("middleName", v)} placeholder="Optional" />
          <F label="Last Name" value={employee.lastName} onChange={(v) => upd("lastName", v)} required placeholder="Family / surname" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Date of Birth" value={employee.dateOfBirth} onChange={(v) => upd("dateOfBirth", v)} type="date" required />
          <F label="Gender" value={employee.gender} onChange={(v) => upd("gender", v)} opts={GENDERS} required />
          <F label="Marital Status" value={employee.maritalStatus} onChange={(v) => upd("maritalStatus", v)} opts={MARITALS} />
          <F label="Blood Group" value={employee.bloodGroup} onChange={(v) => upd("bloodGroup", v)} opts={BLOODS} />
        </div>

        <SectionHead icon={Phone} color="emerald">Contact Information</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Mobile Number" value={employee.mobileNumber} onChange={(v) => upd("mobileNumber", v)} mode="tel" required placeholder="10-digit mobile" />
          <F label="Alternate Mobile" value={employee.alternateMobile} onChange={(v) => upd("alternateMobile", v)} mode="tel" placeholder="Optional" />
          <F label="Personal Email" value={employee.personalEmail} onChange={(v) => upd("personalEmail", v)} type="email" required placeholder="your.email@gmail.com" />
        </div>

        <SectionHead icon={Heart} color="pink">Parent / Guardian</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Father's Name" value={employee.fatherName} onChange={(v) => upd("fatherName", v)} required placeholder="Full name" />
          <F label="Mother's Name" value={employee.motherName} onChange={(v) => upd("motherName", v)} placeholder="Full name" />
          <F label="Spouse Name" value={employee.spouseName} onChange={(v) => upd("spouseName", v)} placeholder="If married" />
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button
            onClick={onSave}
            disabled={saving}
            className="min-h-[52px] px-8 text-base font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 rounded-xl shadow-lg shadow-indigo-500/25 gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Personal Details
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Step 3: Address & KYC (Redesigned) ────────────────────────────────────────

export function Step3AddressKyc({
  employee, setEmployee, status, saving, onSave,
  digilockerUrl, digilockerLoading, digilockerError, onDigilockerStart,
  consentAccepted, onConsent,
}: {
  employee: EmployeeForm;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  status: StatusData | null;
  saving: boolean;
  onSave: () => void;
  digilockerUrl: string | null;
  digilockerLoading: boolean;
  digilockerError: string | null;
  onDigilockerStart: () => void;
  consentAccepted: boolean;
  onConsent: () => void;
}) {
  const upd = (k: keyof EmployeeForm, v: string) => setEmployee((p) => ({ ...p, [k]: v }));
  const [sameAddr, setSameAddr] = useState(false);

  const copyPerm = () => {
    setEmployee((p) => ({
      ...p,
      currentAddr1: p.permanentAddr1,
      currentAddr2: p.permanentAddr2,
      currentCity: p.permanentCity,
      currentState: p.permanentState,
      currentPincode: p.permanentPincode,
      currentCountry: p.permanentCountry,
    }));
    setSameAddr(true);
  };

  const digilockerDone = status?.digilocker?.status === "documents_received";

  return (
    <GlassCard>
      <GradientCardHeader
        title="Address & KYC"
        subtitle="Residential address and identity verification"
        icon={MapPin}
        color="purple"
      />
      <div className="p-5 space-y-5">

        {/* DigiLocker Section */}
        {!digilockerDone && (
          <div className="rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 border-2 border-violet-200 p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center">
                <Fingerprint className="h-6 w-6 text-violet-600" />
              </div>
              <div>
                <p className="font-bold text-violet-800">DigiLocker KYC</p>
                <p className="text-sm text-violet-600">Verify your identity via Aadhaar</p>
              </div>
            </div>

            {!consentAccepted ? (
              <button
                type="button"
                onClick={onConsent}
                disabled={saving}
                className="w-full flex items-center gap-3 rounded-xl border-2 border-violet-300 bg-white px-4 py-4 text-sm font-semibold text-violet-800 hover:bg-violet-100 transition-all"
              >
                <ShieldCheck className="h-5 w-5" />
                Grant BGV Consent to Enable DigiLocker
              </button>
            ) : digilockerUrl ? (
              <a
                href={digilockerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-4 font-bold hover:from-violet-700 hover:to-purple-700 transition-all"
              >
                Open DigiLocker →
              </a>
            ) : (
              <Button
                onClick={onDigilockerStart}
                disabled={digilockerLoading}
                className="w-full min-h-[52px] bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold rounded-xl"
              >
                {digilockerLoading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Fingerprint className="h-5 w-5 mr-2" />}
                Start DigiLocker Verification
              </Button>
            )}

            {digilockerError && (
              <p className="text-sm text-rose-600 font-semibold mt-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> {digilockerError}
              </p>
            )}
          </div>
        )}

        {digilockerDone && (
          <InfoBox variant="success">
            <p className="font-bold">DigiLocker Verification Complete</p>
            <p className="text-xs mt-1">Your Aadhaar details have been verified successfully.</p>
          </InfoBox>
        )}

        <SectionHead icon={Home} color="purple">Permanent Address</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <F label="Address Line 1" value={employee.permanentAddr1} onChange={(v) => upd("permanentAddr1", v)} required placeholder="House/Flat No., Building Name" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <F label="Address Line 2" value={employee.permanentAddr2} onChange={(v) => upd("permanentAddr2", v)} placeholder="Street, Landmark" />
          </div>
          <F label="State" value={employee.permanentState} onChange={(v) => { upd("permanentState", v); upd("permanentCity", ""); }} opts={INDIA_STATES} required />
          <CityField key={employee.permanentState} state={employee.permanentState} city={employee.permanentCity} onChange={(v) => upd("permanentCity", v)} />
          <F label="PIN Code" value={employee.permanentPincode} onChange={(v) => upd("permanentPincode", v)} mode="numeric" required placeholder="6-digit PIN" />
          <F label="Country" value={employee.permanentCountry || "India"} onChange={(v) => upd("permanentCountry", v)} />
        </div>

        <SectionHead icon={MapPin} color="teal">Current Address</SectionHead>
        <div className="mb-4">
          <button
            type="button"
            onClick={copyPerm}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 transition-all ${
              sameAddr ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:border-teal-400"
            }`}
          >
            <CheckCircle2 className={`h-4 w-4 ${sameAddr ? "text-teal-600" : "text-slate-400"}`} />
            Same as permanent address
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <F label="Address Line 1" value={employee.currentAddr1} onChange={(v) => upd("currentAddr1", v)} required placeholder="House/Flat No., Building Name" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <F label="Address Line 2" value={employee.currentAddr2} onChange={(v) => upd("currentAddr2", v)} placeholder="Street, Landmark" />
          </div>
          <F label="State" value={employee.currentState} onChange={(v) => { upd("currentState", v); upd("currentCity", ""); }} opts={INDIA_STATES} required />
          <CityField key={employee.currentState} state={employee.currentState} city={employee.currentCity} onChange={(v) => upd("currentCity", v)} />
          <F label="PIN Code" value={employee.currentPincode} onChange={(v) => upd("currentPincode", v)} mode="numeric" required placeholder="6-digit PIN" />
        </div>

        <SectionHead icon={CreditCard} color="amber">Identity Documents</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="font-bold text-orange-800">Aadhaar Card</p>
                <p className="text-xs text-orange-600">12-digit UID</p>
              </div>
            </div>
            <F label="Aadhaar Number" value={employee.aadhaarNumber} onChange={(v) => upd("aadhaarNumber", v)} mode="numeric" required placeholder="XXXX XXXX XXXX" />
          </div>

          <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-blue-800">PAN Card</p>
                <p className="text-xs text-blue-600">Income Tax ID</p>
              </div>
            </div>
            <F label="PAN Number" value={employee.panNumber} onChange={(v) => upd("panNumber", v.toUpperCase())} required placeholder="ABCDE1234F" />
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <Button
            onClick={onSave}
            disabled={saving}
            className="min-h-[52px] px-8 text-base font-bold bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 rounded-xl shadow-lg shadow-purple-500/25 gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Address & KYC
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// Export remaining steps to be continued in Part 2...
// Step4Documents, Step5Bgv, Step6Bank will follow the same pattern

// ── Step 4: Document Upload (Redesigned) ──────────────────────────────────────

export function Step4Documents({
  status, token, saving, consentAccepted, onUpload, onDelete,
}: {
  status: StatusData | null;
  token: string;
  saving: boolean;
  consentAccepted: boolean;
  onUpload: (file: File, docType: string, docName: string, pageNo: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [docType, setDocType] = useState("Aadhaar");
  const [docName, setDocName] = useState("Aadhaar Card");
  const [pageNo, setPageNo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [showChecklist, setShowChecklist] = useState(true);
  const [fileKey, setFileKey] = useState(0);
  const [selfieUploading, setSelfieUploading] = useState(false);

  const uploadedTypes = new Set((status?.documents || []).map((d) => d.doc_type));
  const selfieUploaded = uploadedTypes.has("Live Selfie");

  const handleSelfieCapture = useCallback(async (selfieFile: File) => {
    setSelfieUploading(true);
    setErr("");
    try {
      await onUpload(selfieFile, "Live Selfie", "Live Selfie (Identity Verification)", "");
      setErr("");
    } catch (e: any) {
      setErr(e.message || "Selfie upload failed");
    } finally {
      setSelfieUploading(false);
    }
  }, [onUpload]);

  const upload = async () => {
    if (!file) { setErr("Please select a file first"); return; }
    setUploading(true); setErr("");
    try {
      const toSend = await compressImageForUpload(file);
      if (toSend.size > 5 * 1024 * 1024) {
        setErr("File size must be under 5 MB");
        return;
      }
      await onUpload(toSend, docType, docName, pageNo);
      setFile(null);
      setPageNo("");
      setFileKey((k) => k + 1);
    } catch (e: any) {
      setErr(e.message || "Upload failed");
    } finally { setUploading(false); }
  };

  const digilockerDone = status?.digilocker?.status === "documents_received";
  const requiredMissing = findMissingMandatoryDocs(status?.documents, digilockerDone);

  return (
    <GlassCard>
      <GradientCardHeader
        title="Document Upload"
        subtitle={`${status?.documents.length ?? 0} documents uploaded${requiredMissing.length > 0 ? ` · ${requiredMissing.length} required pending` : ""}`}
        icon={FileImage}
        color="pink"
      />
      <div className="p-5 space-y-5">

        {digilockerDone ? (
          <InfoBox variant="success">
            <p className="font-bold">Aadhaar & PAN fetched from DigiLocker</p>
            <p className="text-xs mt-1">Now upload your photo, education certificates, and other documents.</p>
          </InfoBox>
        ) : (
          <InfoBox variant="info">
            <p className="font-bold">Upload at least 3 documents</p>
            <p className="text-xs mt-1">Including photo, Aadhaar, PAN, and education certificates. Tip: Use DigiLocker in Step 3!</p>
          </InfoBox>
        )}

        {consentAccepted && (
          <InfoBox variant="success">
            <p className="font-bold">BGV Consent Active</p>
            <p className="text-xs mt-0.5">Documents will trigger automatic verification.</p>
          </InfoBox>
        )}

        {/* Document Checklist */}
        <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-150 transition-all"
          >
            <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Document Checklist ({uploadedTypes.size} uploaded)
            </span>
            {showChecklist ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          </button>
          {showChecklist && (
            <div className="p-4 grid gap-2 sm:grid-cols-2">
              {MANDATORY_DOCUMENT_RULES.map((rule) => {
                const done = !requiredMissing.some((m) => m.label === rule.label);
                return (
                  <div key={rule.label} className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2.5 border ${
                    done ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
                  }`}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    <span className="font-semibold">{rule.label}</span>
                    {!done && <span className="ml-auto text-[10px] font-black uppercase bg-rose-100 px-1.5 py-0.5 rounded">Required</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Selfie */}
        <SectionHead icon={Camera} color="cyan">Live Selfie Capture</SectionHead>
        <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-cyan-200 p-5">
          {selfieUploaded ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <p className="font-bold text-emerald-800">Live Selfie Captured</p>
                <p className="text-sm text-emerald-600">Your identity photo has been uploaded</p>
              </div>
            </div>
          ) : (
            <LiveSelfieCapture
              onCapture={handleSelfieCapture}
              disabled={selfieUploading}
              loading={selfieUploading}
            />
          )}
        </div>

        {/* Upload Form */}
        <SectionHead icon={Upload} color="pink">Upload Document</SectionHead>
        <div className="rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 border-2 border-pink-200 p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Document Type" value={docType} onChange={(v) => { setDocType(v); setDocName(v); }} opts={DOC_TYPES} required />
            <F label="Document Name" value={docName} onChange={setDocName} placeholder="e.g. Aadhaar Card Front" />
            <F label="Page Number (optional)" value={pageNo} onChange={setPageNo} placeholder="e.g. Page 1 of 2" />
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">Select File <span className="text-rose-500">*</span></Label>
              <input
                key={fileKey}
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full min-h-[52px] rounded-xl border-2 border-slate-200 px-4 py-3 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-pink-100 file:text-pink-700 file:font-semibold hover:file:bg-pink-200"
              />
            </div>
          </div>

          {err && (
            <p className="text-sm text-rose-600 font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {err}
            </p>
          )}

          <Button
            onClick={upload}
            disabled={uploading || !file}
            className="min-h-[52px] px-8 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold rounded-xl shadow-lg gap-2"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            Upload Document
          </Button>
        </div>

        {/* Uploaded Documents */}
        {(status?.documents.length ?? 0) > 0 && (
          <>
            <SectionHead icon={FileText} color="emerald">Uploaded Documents ({status?.documents.length})</SectionHead>
            <div className="space-y-2">
              {status?.documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border-2 border-emerald-200">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <div>
                      <p className="font-semibold text-sm text-emerald-800">{doc.doc_name || doc.doc_type}</p>
                      <p className="text-xs text-emerald-600">{doc.doc_type}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onDelete(doc.id)}
                    className="p-2 rounded-lg hover:bg-rose-100 text-rose-500 hover:text-rose-700 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </GlassCard>
  );
}

// ── Step 5: BGV (Redesigned) ──────────────────────────────────────────────────

export function Step5Bgv({
  bgv, bgvApiAvailable, consentAccepted, saving, status,
  onConsent, onVerifyAadhaar, onVerifyPan, onVerifyBank, onVerifyUan, onDigilocker, digilockerStatus,
  digilockerRedirectUrl, onSyncDigilocker, digilockerSyncing,
}: {
  bgv: BgvStatus | null;
  bgvApiAvailable: boolean;
  consentAccepted: boolean;
  saving: boolean;
  status: StatusData | null;
  onConsent: () => void;
  onVerifyAadhaar: () => void;
  onVerifyPan: () => void;
  onVerifyBank: () => void;
  onVerifyUan: () => void;
  onDigilocker: () => void;
  digilockerStatus?: string;
  digilockerRedirectUrl?: string | null;
  onSyncDigilocker?: () => void;
  digilockerSyncing?: boolean;
}) {
  return (
    <GlassCard>
      <GradientCardHeader
        title="Background Verification"
        subtitle="Identity and employment verification"
        icon={ShieldCheck}
        color="violet"
      />
      <div className="p-5 space-y-5">

        {!bgvApiAvailable && (
          <InfoBox variant="warning">
            <p className="font-bold flex items-center gap-2"><WifiOff className="h-4 w-4" /> BGV Service Temporarily Unavailable</p>
            <p className="text-xs mt-1">HR will complete manual BGV after submission. This does not block your onboarding.</p>
          </InfoBox>
        )}

        {/* Consent */}
        <div className={`rounded-xl border-2 p-5 space-y-4 ${consentAccepted ? "bg-emerald-50 border-emerald-200" : "bg-violet-50 border-violet-200"}`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${consentAccepted ? "bg-emerald-100" : "bg-violet-100"}`}>
              <ShieldCheck className={`h-6 w-6 ${consentAccepted ? "text-emerald-600" : "text-violet-600"}`} />
            </div>
            <div>
              <p className={`font-bold ${consentAccepted ? "text-emerald-800" : "text-violet-800"}`}>Digital Verification Consent</p>
              <p className="text-xs text-slate-600">Required for identity and employment verification</p>
            </div>
          </div>

          {!consentAccepted ? (
            <Button
              onClick={onConsent}
              disabled={saving}
              className="w-full min-h-[52px] bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold rounded-xl shadow-lg gap-2"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
              Give Consent & Proceed
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 p-3 bg-emerald-100 rounded-xl">
              <CheckCircle2 className="h-5 w-5" />
              Consent Captured — Verifications Enabled
            </div>
          )}
        </div>

        {/* BGV Stats */}
        {(bgv || consentAccepted) && (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {[
              { label: "BGV Score", value: `${bgv?.score ?? 0}%`, ok: (bgv?.score ?? 0) >= 80, color: "blue" },
              { label: "Status", value: bgv?.overall_status || "pending", ok: bgv?.overall_status === "verified", color: "purple" },
              { label: "HR Ready", value: bgv?.employee_creation_ready ? "Yes" : "Pending", ok: bgv?.employee_creation_ready, color: "teal" },
              { label: "Payroll Ready", value: bgv?.payroll_activation_ready ? "Yes" : "Pending", ok: bgv?.payroll_activation_ready, color: "green" },
            ].map((c) => (
              <div key={c.label} className={`rounded-xl border-2 p-4 ${c.ok ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{c.label}</p>
                <p className={`mt-1.5 text-lg font-black capitalize ${c.ok ? "text-emerald-700" : "text-slate-700"}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Verification Buttons */}
        <SectionHead icon={Eye} color="indigo">Additional Verifications</SectionHead>
        <div className="grid gap-3 grid-cols-2">
          {[
            { label: "Verify Aadhaar", onClick: onVerifyAadhaar, icon: "🪪", checkType: "aadhaar" },
            { label: "Verify PAN", onClick: onVerifyPan, icon: "📋", checkType: "pan" },
            { label: "Verify Bank A/C", onClick: onVerifyBank, icon: "🏦", checkType: "bank" },
            { label: "Verify UAN", onClick: onVerifyUan, icon: "🏢", checkType: "employment" },
          ].map(({ label, onClick, icon, checkType }) => {
            const check = bgv?.checks.find((c) => c.check_type?.toLowerCase() === checkType);
            const verified = check?.status === "verified";
            return (
              <Button
                key={label}
                variant="outline"
                onClick={onClick}
                disabled={!consentAccepted || saving || verified}
                className={`min-h-[52px] text-sm font-bold rounded-xl border-2 flex items-center gap-2 justify-start px-4 ${
                  verified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 hover:border-violet-300 hover:bg-violet-50"
                }`}
              >
                <span className="text-xl">{icon}</span>
                <span className="flex-1 text-left">{label}</span>
                {verified && <CheckCircle2 className="h-4 w-4" />}
              </Button>
            );
          })}
        </div>

        {!consentAccepted && (
          <p className="text-xs text-slate-500 text-center">Give consent above to enable verifications</p>
        )}

        {/* BGV Checks Table */}
        {(bgv?.checks.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-xl border-2 border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b-2 border-slate-200">
                <tr>
                  {["Check", "Status", "Score", "Summary"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bgv!.checks.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold capitalize">{c.check_type?.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                        c.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.match_score ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{c.result_summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ── Step 6: Bank Details (Redesigned) ─────────────────────────────────────────

export function Step6Bank({
  bank, setBank, saving, onSave, onLookupIfsc, token, consentAccepted = false, onSkip,
}: {
  bank: BankForm;
  setBank: React.Dispatch<React.SetStateAction<BankForm>>;
  saving: boolean;
  onSave: () => void;
  onLookupIfsc: (ifsc: string) => void;
  token?: string;
  consentAccepted?: boolean;
  onSkip?: () => void;
}) {
  const upd = (k: keyof BankForm, v: string) => setBank((p) => ({ ...p, [k]: v }));
  const mismatch = Boolean(bank.accountNo && bank.confirmAccountNo && bank.accountNo !== bank.confirmAccountNo);
  const ifscOk = !bank.ifscCode || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifscCode.toUpperCase());

  return (
    <GlassCard>
      <GradientCardHeader
        title="Bank Account Details"
        subtitle="For salary credit (optional at this stage)"
        icon={Landmark}
        color="blue"
      />
      <div className="p-5 space-y-5">

        <InfoBox variant="info">
          <p className="font-bold">Bank account is optional</p>
          <p className="text-xs mt-1">Many new joiners don't have an account yet. You can skip this step and provide details later.</p>
        </InfoBox>

        <SectionHead icon={Landmark} color="blue">Account Information</SectionHead>
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Account Holder Name" value={bank.accountHolderName} onChange={(v) => upd("accountHolderName", v)} required placeholder="As per bank records" />
            <F label="Account Number" value={bank.accountNo} onChange={(v) => upd("accountNo", v)} required mode="numeric" placeholder="Enter account number" />
            <F label="Confirm Account Number" value={bank.confirmAccountNo} onChange={(v) => upd("confirmAccountNo", v)} required mode="numeric" placeholder="Re-enter to confirm" error={mismatch ? "Account numbers do not match" : ""} />
            <F
              label="IFSC Code"
              value={bank.ifscCode}
              onChange={(v) => {
                upd("ifscCode", v.toUpperCase());
                if (v.length === 11) onLookupIfsc(v.toUpperCase());
              }}
              required
              placeholder="e.g. HDFC0001234"
              error={!ifscOk ? "Invalid IFSC format" : ""}
            />
            <F label="Bank Name" value={bank.bankName} onChange={(v) => upd("bankName", v)} required placeholder="e.g. HDFC Bank" />
            <F label="Branch Name" value={bank.branchName} onChange={(v) => upd("branchName", v)} placeholder="Auto-filled from IFSC" prefilled={Boolean(bank.branchName && bank.ifscCode)} />
            <F label="Account Type" value={bank.accountType} onChange={(v) => upd("accountType", v)} opts={ACCOUNTS} required />
          </div>
        </div>

        {/* Penny Drop */}
        {token && consentAccepted && bank.accountNo && bank.ifscCode && (
          <SectionHead icon={IndianRupee} color="emerald">Account Verification</SectionHead>
        )}
        {token && consentAccepted && bank.accountNo && bank.ifscCode && (
          <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <IndianRupee className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-bold text-emerald-800">Penny Drop Verification</p>
                <p className="text-sm text-emerald-600">Verify account ownership by penny drop</p>
              </div>
            </div>
            <PennyDropButton token={token} />
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
          {onSkip && (
            <Button
              variant="outline"
              onClick={onSkip}
              disabled={saving}
              className="min-h-[52px] px-6 font-semibold rounded-xl border-2"
            >
              Skip for Now
            </Button>
          )}
          <Button
            onClick={onSave}
            disabled={saving || mismatch || !ifscOk}
            className="min-h-[52px] px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Bank Details
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

export { REQUIRED_DOCS, DOC_TYPES, TITLES, GENDERS, MARITALS, BLOODS, RELATIONS, NOM_RELS, ADDR_PROOFS, ACCOUNTS };
