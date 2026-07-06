import { useState } from "react";
import {
  AlertCircle, Camera, CheckCircle2, ChevronDown, ChevronUp,
  FileUp, Info, Loader2, ShieldCheck, Trash2, Upload, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  F, T, RO, Chip, SectionHead, InfoBox,
} from "./OnboardingFormPrimitives";
import type { EmployeeForm, BankForm, StatusData, BgvStatus } from "./useOnboardingFull";
import { PennyDropButton } from "./PennyDropButton";

// ── Constants ─────────────────────────────────────────────────────────────────

const TITLES = ["Mr", "Mrs", "Ms", "Dr"];
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const MARITALS = ["Single", "Married", "Divorced", "Widowed", "Separated"];
const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONS = ["Father", "Husband", "Mother", "Wife", "Son", "Daughter", "Brother", "Sister", "Guardian"];
const NOM_RELS = ["Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Guardian"];
// CATEGORIES removed per user request
// RELIGIONS removed per user request
const ADDR_PROOFS = ["Aadhaar Card", "Driving License", "Voter ID", "Passport", "Rent Agreement", "Utility Bill", "Bank Passbook"];
const ACCOUNTS = ["Savings", "Current", "Salary"];
const INDIA_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Delhi", "Jammu & Kashmir", "Ladakh",
  "Andaman & Nicobar Islands", "Chandigarh", "Dadra & Nagar Haveli", "Daman & Diu",
  "Lakshadweep", "Puducherry",
];

// Required documents list — used to track what's been uploaded
const REQUIRED_DOCS = [
  { type: "Aadhaar", label: "Aadhaar Card", required: true },
  { type: "PAN Card", label: "PAN Card", required: true },
  { type: "10th Marksheet", label: "10th Marksheet / Certificate", required: true },
  { type: "Cancelled Cheque", label: "Cancelled Cheque / Bank Passbook", required: true },
  { type: "Passport Photo", label: "Passport Size Photo", required: true },
  { type: "12th Marksheet", label: "12th Marksheet (if applicable)", required: false },
  { type: "Degree Certificate", label: "Degree / Diploma Certificate (if applicable)", required: false },
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

// ── Step 1: Welcome ────────────────────────────────────────────────────────────

export function Step1Welcome({
  status,
  privacyConsentAccepted,
  onPrivacyConsent,
}: {
  status: StatusData | null;
  privacyConsentAccepted: boolean;
  onPrivacyConsent: () => void;
}) {
  const t = status?.token;
  return (
    <div className="space-y-4">
      {/* Hero card */}
      <Card className="border-t-4 border-t-blue-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg">👋</span>
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Welcome to</p>
              <p className="text-sm font-bold text-slate-900 leading-tight">MAS Callnet Onboarding</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {t?.full_name ? `Hi ${t.full_name.split(" ")[0]}! ` : ""}Your joining journey starts here.
              </p>
            </div>
          </div>
        </div>
        <CardContent className="pt-4 px-5 pb-5">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500 mb-3">Your Details</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <RO label="Full Name" value={t?.full_name} highlight />
            <RO label="Mobile" value={t?.mobile} />
            <RO label="Email" value={t?.email} />
            <RO label="Branch" value={t?.branch_name} />
            <RO label="Process / LOB" value={t?.process_name} />
            <RO label="Candidate Code" value={t?.candidate_code || t?.candidate_id} />
            <RO label="Source" value={t?.source_type} />
            {t?.gender && <RO label="Gender" value={t.gender} />}
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <CardContent className="pt-4 px-5 pb-5">
          <p className="font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" /> Before you begin
          </p>
          <div className="space-y-2">
            {[
              ["📝", "Fill all 10 steps carefully — details are used for payroll, PF, ESI and HR records"],
              ["💾", "Progress autosaves as you type — no data will be lost if you refresh"],
              ["⭐", "Fields marked with * are mandatory — you cannot submit without them"],
              ["📎", "Keep scanned copies of Aadhaar, PAN, Passbook/Cancelled Cheque and marksheets ready"],
              ["📱", "An OTP will be sent to your registered mobile for final submission"],
              ["🔒", "All data is encrypted and used only for employment and statutory compliance"],
            ].map(([icon, text], i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="flex-shrink-0">{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* DPDP §9 — Minor candidate warning */}
      {t?.is_minor && (
        <Card className="shadow-sm border-2 border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="font-bold text-red-800 text-sm flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Minor Candidate — Guardian Consent Required
            </p>
            <p className="text-xs text-red-700 leading-relaxed">
              Our records indicate you are under 18 years of age. Under the Digital Personal Data Protection (DPDP) Act 2023 §9,
              processing personal data of minors requires explicit parental or guardian consent.
              Please inform HR immediately. Your onboarding will be paused until guardian consent is obtained and recorded by the HR team.
            </p>
          </CardContent>
        </Card>
      )}

      {/* DPDP Privacy Notice — DPDP Act 2023 §6: consent before data collection */}
      <Card className={`shadow-sm border ${privacyConsentAccepted ? "border-emerald-200 bg-emerald-50" : "border-indigo-200 bg-indigo-50"} rounded-xl overflow-hidden`}>
        <CardContent className="pt-4 px-5 pb-5 space-y-3">
          <p className={`font-bold text-sm flex items-center gap-2 ${privacyConsentAccepted ? "text-emerald-800" : "text-indigo-800"}`}>
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            Data Collection Notice (DPDP Act 2023)
          </p>
          <div className="text-xs text-slate-700 space-y-1.5">
            <p><strong>What we collect:</strong> Identity (Aadhaar, PAN), contact details, address, bank account, employment history, family information, statutory details (PF/ESIC), biometric attendance.</p>
            <p><strong>Why:</strong> Employment onboarding, payroll processing, statutory compliance (PF/ESIC/TDS), background verification, and HR record-keeping as required by law.</p>
            <p><strong>Who receives your data:</strong> MAS Callnet HR team; and for background verification — <strong>Luckpay</strong> (PAN, bank, UAN), <strong>Befisc</strong> (Aadhaar OTP), <strong>Crimescan</strong> (court records).</p>
            <p><strong>Retention:</strong> Employment data is retained for the duration of employment. Statutory/payroll records are retained for 8 years per legal obligation.</p>
            <p><strong>Your rights:</strong> Access, correction, nomination of representative, and withdrawal of consent (non-statutory data only) — contact HR or raise a request in employee self-service.</p>
            <p><strong>Grievance:</strong> Contact our HR Compliance Officer via the "Privacy &amp; DPDP" section after login.</p>
          </div>
          {!privacyConsentAccepted ? (
            <button
              type="button"
              onClick={onPrivacyConsent}
              className="w-full flex items-center gap-3 rounded-xl border-2 border-indigo-300 bg-white px-4 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 hover:border-indigo-400 transition-colors active:scale-[0.99]"
            >
              <span className="w-5 h-5 rounded border-2 border-indigo-400 flex-shrink-0 flex items-center justify-center">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-200" />
              </span>
              I have read and understood the data collection notice and consent to processing my personal data for employment purposes
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              Privacy consent recorded — you may proceed
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document checklist preview */}
      <Card className="shadow-sm border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
        <CardContent className="pt-4 px-5 pb-5">
          <p className="font-bold text-amber-900 mb-3 flex items-center gap-2 text-sm">
            <FileUp className="h-4 w-4" /> Documents to keep ready
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {REQUIRED_DOCS.filter((d) => d.required).map((d) => (
              <div key={d.type} className="flex items-center gap-2 text-xs text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="font-semibold">{d.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-amber-700 mt-2 font-semibold">
            Experience letters / salary slips required if you have prior work experience.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Step 2: Personal Details ───────────────────────────────────────────────────

export function Step2Personal({
  employee, setEmployee, saving, onSave,
}: {
  employee: EmployeeForm;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  saving: boolean;
  onSave: () => void;
}) {
  const upd = (k: keyof EmployeeForm, v: string) => setEmployee((p) => ({ ...p, [k]: v }));

  // Age validation helper
  const age = employee.dateOfBirth
    ? Math.floor((Date.now() - new Date(employee.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;
  const dobError = age !== null && (age < 16 || age > 60) ? `Age must be between 16–60 (currently ${age})` : "";

  return (
    <Card className="border-t-4 border-t-slate-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-slate-50 text-slate-600 flex items-center justify-center text-lg">👤</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Personal Information</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Complete your personal and contact details</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5">

        <SectionHead sub="Exactly as on Aadhaar card">Basic Details</SectionHead>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          <F label="Title" value={employee.title} onChange={(v) => upd("title", v)} opts={TITLES} />
          <div className="col-span-2 sm:col-span-2">
            <F label="Full Name" value={employee.employeeName} onChange={(v) => upd("employeeName", v)}
              required prefilled={Boolean(employee.employeeName)}
              helpText="Must match Aadhaar exactly" placeholder="As on Aadhaar" />
          </div>
          <F label="Relation Type" value={employee.relation} onChange={(v) => upd("relation", v)} opts={RELATIONS} />
          <div className="col-span-2">
            <F label="Father / Guardian Name" value={employee.fatherHusbandName} onChange={(v) => upd("fatherHusbandName", v)}
              required placeholder="Full name" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <F label="Mother's Name" value={employee.motherName} onChange={(v) => upd("motherName", v)} placeholder="Full name" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mt-4">
          <F label="Date of Birth" value={employee.dateOfBirth} onChange={(v) => upd("dateOfBirth", v)}
            type="date" required prefilled={Boolean(employee.dateOfBirth)} error={dobError}
            helpText={age !== null ? `Age: ${age} years` : undefined} />
          <F label="Gender" value={employee.gender} onChange={(v) => upd("gender", v)}
            opts={GENDERS} required prefilled={Boolean(employee.gender)} />
          <F label="Marital Status" value={employee.maritalStatus} onChange={(v) => upd("maritalStatus", v)}
            opts={MARITALS} required />
          <F label="Blood Group" value={employee.bloodGroup} onChange={(v) => upd("bloodGroup", v)} opts={BLOODS} />
          <F label="Nationality" value={employee.nationality} onChange={(v) => upd("nationality", v)} placeholder="Indian" />
        </div>

        <SectionHead sub="Primary and alternate contact">Contact Details</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Mobile Number" value={employee.mobileNumber} onChange={(v) => upd("mobileNumber", v)}
            type="tel" mode="tel" required prefilled={Boolean(employee.mobileNumber)}
            helpText="OTP will be sent to this number" />
          <F label="Alternate Mobile" value={employee.altMobileNumber} onChange={(v) => upd("altMobileNumber", v)}
            type="tel" mode="tel" placeholder="Optional" />
          <F label="Personal Email" value={employee.personalEmailId} onChange={(v) => upd("personalEmailId", v)}
            type="email" mode="email" required prefilled={Boolean(employee.personalEmailId)} />
          <F label="Official / Work Email" value={employee.officialEmailId} onChange={(v) => upd("officialEmailId", v)}
            type="email" mode="email" placeholder="If already assigned" />
        </div>

        <SectionHead sub="Someone to contact in an emergency">Emergency Contact</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Contact Name" value={employee.emergencyContactName} onChange={(v) => upd("emergencyContactName", v)}
            required placeholder="Full name" />
          <F label="Relation" value={employee.emergencyContactRelation} onChange={(v) => upd("emergencyContactRelation", v)}
            opts={RELATIONS} />
          <F label="Mobile Number" value={employee.emergencyContactMobile} onChange={(v) => upd("emergencyContactMobile", v)}
            type="tel" mode="tel" required placeholder="Active number" />
        </div>

        <SectionHead sub="For PF/ESI nomination purposes">Nominee 1 (Primary)</SectionHead>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <div className="col-span-2">
            <F label="Nominee Full Name" value={employee.nominee} onChange={(v) => upd("nominee", v)} required placeholder="Full name" />
          </div>
          <F label="Relation" value={employee.nomineeRelation} onChange={(v) => upd("nomineeRelation", v)} opts={NOM_RELS} required />
          <F label="Date of Birth" value={employee.nomineeDateOfBirth} onChange={(v) => upd("nomineeDateOfBirth", v)} type="date" />
        </div>

        <SectionHead sub="Optional — add a second nominee">Nominee 2 (Optional)</SectionHead>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <div className="col-span-2">
            <F label="Nominee 2 Name" value={employee.nominee2Name} onChange={(v) => upd("nominee2Name", v)} placeholder="Full name" />
          </div>
          <F label="Relation" value={employee.nominee2Relation} onChange={(v) => upd("nominee2Relation", v)} opts={NOM_RELS} />
          <F label="Date of Birth" value={employee.nominee2Dob} onChange={(v) => upd("nominee2Dob", v)} type="date" />
        </div>

        <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-xs text-blue-800">
          ℹ️ Share percentages are auto-calculated: {employee.nominee2Name?.trim() ? "50% each if two nominees" : "100% for primary nominee"}
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <Button
            onClick={onSave}
            disabled={saving || Boolean(dobError)}
            size="lg"
            className="min-h-[52px] px-8 text-base font-bold bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
            Save Personal Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 3: Address & KYC ─────────────────────────────────────────────────────

export function Step3AddressKyc({
  employee, setEmployee, saving, onSave, digilockerStatus, onDigilocker,
}: {
  employee: EmployeeForm;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  saving: boolean;
  onSave: () => void;
  digilockerStatus?: string;
  onDigilocker?: () => void;
}) {
  const upd = (k: keyof EmployeeForm, v: string) => setEmployee((p) => ({ ...p, [k]: v }));
  const [sameAddr, setSameAddr] = useState(() =>
    Boolean(employee.permanentAddress && employee.presentAddress &&
      employee.permanentAddress === employee.presentAddress &&
      employee.permanentState === employee.presentState &&
      employee.permanentCity === employee.presentCity &&
      employee.permanentPincode === employee.presentPincode)
  );
  const pinOk = (v: string) => !v || /^\d{6}$/.test(v);

  const syncPermanent = (field: keyof EmployeeForm, v: string) => {
    upd(field, v);
    if (sameAddr) {
      const map: Partial<Record<keyof EmployeeForm, keyof EmployeeForm>> = {
        permanentAddress: "presentAddress",
        permanentState: "presentState",
        permanentCity: "presentCity",
        permanentPincode: "presentPincode",
      };
      if (map[field]) upd(map[field]!, v);
    }
  };

  const toggleSame = (checked: boolean) => {
    setSameAddr(checked);
    if (checked) {
      setEmployee((p) => ({
        ...p,
        presentAddress: p.permanentAddress,
        presentState: p.permanentState,
        presentCity: p.permanentCity,
        presentPincode: p.permanentPincode,
      }));
    }
  };

  // PAN validation
  const panOk = !employee.panNumber || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(employee.panNumber.toUpperCase());
  const aadhaarOk = !employee.aadhaarNumber || /^\d{12}$/.test(employee.aadhaarNumber.replace(/\s/g, ""));

  return (
    <Card className="border-t-4 border-t-purple-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-lg">🔗</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">DigiLocker & KYC Details</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Connect DigiLocker first, then enter addresses</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5">

        {/* DigiLocker Section - MOVED HERE from Step 5 */}
        <SectionHead sub="Recommended — fetches Aadhaar + PAN from government">Step 1: Connect DigiLocker (Optional)</SectionHead>
        <InfoBox variant="info">
          <p className="text-xs">
            <strong>🚀 Fast Track:</strong> Connect to government DigiLocker to automatically fetch your
            Aadhaar and PAN documents. This will pre-fill your KYC details below and save you time!
            <br /><br />
            <strong>How it works:</strong> Click the button → Redirected to government portal →
            Authenticate → Return here with Aadhaar + PAN auto-filled.
          </p>
        </InfoBox>

        {digilockerStatus === "documents_received" ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-700 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-900">DigiLocker Connected ✓</p>
              <p className="text-xs text-emerald-700">Aadhaar and PAN fetched successfully. Check KYC fields below!</p>
            </div>
          </div>
        ) : (
          <Button
            onClick={onDigilocker}
            disabled={saving}
            size="lg"
            className="mt-3 min-h-[52px] px-8 text-base font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Redirecting to DigiLocker...
              </>
            ) : (
              <>🔗 Connect DigiLocker</>
            )}
          </Button>
        )}

        <SectionHead sub="As on Aadhaar / official document">Step 2: Permanent Address</SectionHead>
        <div className="space-y-3">
          <T label="Full Permanent Address" value={employee.permanentAddress}
            onChange={(v) => syncPermanent("permanentAddress", v)} required
            placeholder="House/Flat No., Street, Area, Landmark" />
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            <F label="State" value={employee.permanentState} onChange={(v) => syncPermanent("permanentState", v)}
              opts={INDIA_STATES} required />
            <F label="City / District" value={employee.permanentCity}
              onChange={(v) => syncPermanent("permanentCity", v)} required placeholder="City" />
            <F label="PIN Code" value={employee.permanentPincode}
              onChange={(v) => syncPermanent("permanentPincode", v)} mode="numeric" required placeholder="6 digits"
              error={employee.permanentPincode && !pinOk(employee.permanentPincode) ? "Must be 6 digits" : ""} />
          </div>
        </div>

        <SectionHead sub="Where you are currently staying">Present / Current Address</SectionHead>
        <label className="flex items-center gap-3 cursor-pointer p-3 bg-slate-50 rounded-xl border-2 border-slate-200 hover:border-blue-300 transition-colors mb-3 select-none">
          <input
            type="checkbox"
            id="sameAddr"
            checked={sameAddr}
            onChange={(e) => toggleSame(e.target.checked)}
            className="h-5 w-5 rounded accent-blue-600"
          />
          <span className="text-sm font-semibold text-slate-700">
            Same as permanent address
          </span>
        </label>
        {!sameAddr && (
          <div className="space-y-3">
            <T label="Full Present Address" value={employee.presentAddress}
              onChange={(v) => { setSameAddr(false); upd("presentAddress", v); }} required
              placeholder="House/Flat No., Street, Area, Landmark" />
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              <F label="State" value={employee.presentState}
                onChange={(v) => { setSameAddr(false); upd("presentState", v); }} opts={INDIA_STATES} required />
              <F label="City / District" value={employee.presentCity}
                onChange={(v) => { setSameAddr(false); upd("presentCity", v); }} required placeholder="City" />
              <F label="PIN Code" value={employee.presentPincode}
                onChange={(v) => { setSameAddr(false); upd("presentPincode", v); }} mode="numeric" required placeholder="6 digits"
                error={employee.presentPincode && !pinOk(employee.presentPincode) ? "Must be 6 digits" : ""} />
            </div>
          </div>
        )}

        <SectionHead sub="Select the document you will submit as address proof">Address Proof Type</SectionHead>
        <div className="flex flex-wrap gap-2">
          {ADDR_PROOFS.map((p) => (
            <Chip key={p} label={p} active={employee.addressProofType === p} onClick={() => upd("addressProofType", p)} />
          ))}
        </div>

        <SectionHead sub="Required for onboarding — enter carefully">Step 3: KYC Identity Numbers</SectionHead>
        <InfoBox variant={digilockerStatus === "documents_received" ? "success" : "warning"}>
          <p className="font-bold mb-1">{digilockerStatus === "documents_received" ? "✓ Auto-filled from DigiLocker" : "Security Note"}</p>
          <p className="text-xs">
            {digilockerStatus === "documents_received"
              ? "Your PAN and Aadhaar have been fetched from government DigiLocker. Verify and edit if needed."
              : "These numbers are hashed and stored securely. PAN and Aadhaar are never shown in plain text after submission."}
          </p>
        </InfoBox>
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <F label="PAN Number" value={employee.panNumber} onChange={(v) => upd("panNumber", v.toUpperCase())}
            required placeholder="ABCDE1234F"
            error={!panOk ? "Invalid PAN format (e.g. ABCDE1234F)" : ""}
            helpText={digilockerStatus === "documents_received" ? "✓ Auto-filled from DigiLocker" : "10-character PAN — required for tax compliance"}
            prefilled={digilockerStatus === "documents_received"} />
          <F label="Aadhaar Number" value={employee.aadhaarNumber} onChange={(v) => upd("aadhaarNumber", v.replace(/\D/g, ""))}
            mode="numeric" required placeholder="12-digit number"
            error={!aadhaarOk ? "Aadhaar must be exactly 12 digits" : ""}
            helpText={digilockerStatus === "documents_received" ? "✓ Auto-filled from DigiLocker" : "Your 12-digit Aadhaar — not displayed after save"}
            prefilled={digilockerStatus === "documents_received"} />
          <F label="Passport Number" value={employee.passportNo} onChange={(v) => upd("passportNo", v.toUpperCase())}
            placeholder="Optional" helpText="Leave blank if not applicable" />
          <F label="Driving License Number" value={employee.drivingLicenseNo} onChange={(v) => upd("drivingLicenseNo", v.toUpperCase())}
            placeholder="Optional" helpText="Leave blank if not applicable" />
        </div>

        <SectionHead sub="Only if you were previously employed in a formal organisation">Previous Statutory IDs</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="UAN Number" value={employee.uanNumber} onChange={(v) => upd("uanNumber", v)}
            mode="numeric" placeholder="12-digit UAN" helpText="Leave blank if fresher" />
          <F label="Previous EPF / PF Number" value={employee.epfNumber} onChange={(v) => upd("epfNumber", v)}
            placeholder="e.g. MH/BAN/12345" helpText="From previous employer" />
          <F label="Previous ESIC Number" value={employee.esicNumber} onChange={(v) => upd("esicNumber", v)}
            mode="numeric" placeholder="Optional" />
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={onSave}
            disabled={saving || !panOk || !aadhaarOk}
            size="lg"
            className="min-h-[52px] px-8 text-base font-bold bg-purple-600 hover:bg-purple-700 rounded-xl shadow-lg"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
            Save Address & KYC
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 4: Document Upload ────────────────────────────────────────────────────

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

  const uploadedTypes = new Set((status?.documents || []).map((d) => d.doc_type));

  const upload = async () => {
    if (!file) { setErr("Please select a file first"); return; }
    if (file.size > 5 * 1024 * 1024) { setErr("File size must be under 5 MB"); return; }
    setUploading(true); setErr("");
    try {
      await onUpload(file, docType, docName, pageNo);
      setFile(null);
      setPageNo("");
      setFileKey((k) => k + 1);
    } catch (e: any) {
      setErr(e.message || "Upload failed");
    } finally { setUploading(false); }
  };

  const requiredMissing = REQUIRED_DOCS.filter((d) => d.required && !uploadedTypes.has(d.type));

  return (
    <Card className="border-t-4 border-t-amber-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-lg">📄</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Document Upload</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {status?.documents.length ?? 0} document(s) uploaded
              {requiredMissing.length > 0 && ` · ${requiredMissing.length} required still pending`}
            </p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5 space-y-5">

        <InfoBox variant="info">
          <p className="text-xs">
            {status?.digilocker?.status === "documents_received" ? (
              <>
                <strong>✓ Aadhaar and PAN already fetched</strong> from DigiLocker in the previous step.
                Now upload your <strong>photo, education certificates, and any other documents</strong> required for verification.
              </>
            ) : (
              <>
                <strong>Upload at least 3 documents</strong> including your photo, Aadhaar, PAN, and education certificates.
                <br />
                <strong>Tip:</strong> Connect DigiLocker in Step 3 to skip manual Aadhaar/PAN upload!
              </>
            )}
          </p>
        </InfoBox>

        {consentAccepted && (
          <InfoBox variant="success">
            <p className="font-bold">BGV Consent Active</p>
            <p className="text-xs mt-0.5">Aadhaar and PAN uploads will automatically trigger background verification.</p>
          </InfoBox>
        )}

        {/* Required document checklist */}
        <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Document Checklist ({uploadedTypes.size} uploaded)
            </span>
            {showChecklist ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          </button>
          {showChecklist && (
            <div className="p-4 grid gap-2 sm:grid-cols-2">
              {REQUIRED_DOCS.map((d) => {
                const done = uploadedTypes.has(d.type);
                return (
                  <div key={d.type} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${done ? "bg-emerald-50 text-emerald-700" : d.required ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"}`}>
                    {done
                      ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                      : d.required
                        ? <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        : <span className="w-3.5 h-3.5 flex-shrink-0 rounded-full border-2 border-slate-300" />
                    }
                    <span className="font-semibold">{d.label}</span>
                    {d.required && !done && <span className="ml-auto text-[10px] font-black uppercase">Required</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {err && (
          <div className="rounded-xl border-2 border-red-200 bg-red-50 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-red-700">{err}</p>
          </div>
        )}

        {/* Upload form */}
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 space-y-4">
          <p className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload a Document
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-sm font-semibold text-slate-700">Document Type *</Label>
              <select
                className="mt-1 flex min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={docType}
                onChange={(e) => { setDocType(e.target.value); setDocName(e.target.value); }}
              >
                {DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-sm font-semibold text-slate-700">Document Label</Label>
              <Input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                className="mt-1 min-h-[48px] text-base rounded-xl border-2 border-slate-200"
                placeholder="e.g. Aadhaar Front"
              />
            </div>
            <div>
              <Label className="text-sm font-semibold text-slate-700">Page No. (optional)</Label>
              <Input
                value={pageNo}
                onChange={(e) => setPageNo(e.target.value)}
                inputMode="numeric"
                className="mt-1 min-h-[48px] text-base rounded-xl border-2 border-slate-200"
                placeholder="e.g. 1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">
              Select File * <span className="font-normal text-slate-500">(PDF, JPG, PNG — max 5 MB)</span>
            </Label>
            <label className="flex items-center gap-3 cursor-pointer rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 hover:bg-orange-100 transition-colors px-4 py-3 min-h-[52px]">
              <Camera className="h-5 w-5 text-orange-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-orange-700 truncate">
                {file ? file.name : "Tap to choose file or take photo"}
              </span>
              <input
                key={fileKey}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            {file && (
              <p className="text-xs text-slate-500">
                Size: {(file.size / 1024).toFixed(0)} KB
                {file.size > 5 * 1024 * 1024 && (
                  <span className="text-red-600 font-bold ml-2">⚠ Too large (max 5 MB)</span>
                )}
              </p>
            )}
          </div>

          <Button
            onClick={upload}
            disabled={saving || uploading || !file}
            size="lg"
            className="w-full min-h-[52px] text-base font-bold bg-orange-600 hover:bg-orange-700 rounded-xl shadow-md gap-2"
          >
            {(saving || uploading) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            {uploading ? "Uploading…" : "Upload Document"}
          </Button>
        </div>

        {/* Uploaded documents table */}
        {(status?.documents.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-xl border-2 border-slate-200 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b-2 border-slate-200">
                <tr>
                  {["#", "Type", "Name", "Status", "View", ""].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold uppercase text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status!.documents.map((d, i) => (
                  <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3 font-bold text-slate-500">{i + 1}</td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{d.doc_type}</td>
                    <td className="px-3 py-3 text-slate-600">{d.doc_name}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                        d.document_status === "verified"
                          ? "bg-emerald-100 text-emerald-700"
                          : d.document_status === "rejected"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}>
                        {d.document_status === "verified" ? "✓ " : ""}{d.document_status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {d.id
                        ? <a className="text-blue-600 font-bold text-xs underline hover:text-blue-800" href={`/api/ats/onboarding-full/documents/preview/${d.id}?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">View</a>
                        : <span className="text-slate-400 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(d.id)}
                        className="h-9 w-9 p-0 hover:bg-red-50 rounded-lg"
                        aria-label="Delete document"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(status?.documents.length ?? 0) === 0 && (
          <div className="text-center py-8 text-slate-400">
            <FileUp className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-semibold">No documents uploaded yet</p>
            <p className="text-xs mt-1">Upload Aadhaar, PAN and other required documents above</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Step 5: BGV Consent & Verification ────────────────────────────────────────

export function Step5Bgv({
  bgv, bgvApiAvailable, consentAccepted, saving,
  onConsent, onVerifyAadhaar, onVerifyPan, onVerifyBank, onVerifyUan, onDigilocker, digilockerStatus,
}: {
  bgv: BgvStatus | null;
  bgvApiAvailable: boolean;
  consentAccepted: boolean;
  saving: boolean;
  onConsent: () => void;
  onVerifyAadhaar: () => void;
  onVerifyPan: () => void;
  onVerifyBank: () => void;
  onVerifyUan: () => void;
  onDigilocker: () => void;
  digilockerStatus?: string;
}) {
  return (
    <Card className="border-t-4 border-t-indigo-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-lg">🛡️</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Background Verification</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Consent and optional additional verifications</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5 space-y-5">

        {/* API unavailable notice */}
        {!bgvApiAvailable && (
          <InfoBox variant="warning">
            <p className="font-bold flex items-center gap-1.5">
              <WifiOff className="h-4 w-4" /> BGV Service Temporarily Unavailable
            </p>
            <p className="text-xs mt-1">
              The digital verification service is currently offline. Your consent has been captured locally.
              HR Payroll team will complete manual BGV after your submission. <strong>This does not block your onboarding.</strong>
            </p>
          </InfoBox>
        )}

        {/* Consent */}
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-5 space-y-4">
          <div>
            <p className="font-bold text-indigo-900 mb-2">Digital Verification Consent</p>
            <p className="text-sm text-indigo-800 leading-relaxed">
              I voluntarily consent to digital verification of my identity documents (Aadhaar, PAN), bank account details,
              educational records, and employment history for the purposes of employment onboarding, payroll processing,
              statutory compliance (PF/ESI/TDS), and background verification.
              I confirm the information provided is accurate and authorize MAS Callnet and its authorised partners to perform these checks.
            </p>
          </div>
          <Button
            onClick={onConsent}
            disabled={saving || consentAccepted}
            size="lg"
            className={`min-h-[52px] px-8 text-base font-bold rounded-xl shadow-md gap-2 ${
              consentAccepted
                ? "bg-emerald-600 hover:bg-emerald-600 cursor-default"
                : "bg-indigo-700 hover:bg-indigo-800"
            }`}
          >
            <ShieldCheck className="h-5 w-5" />
            {consentAccepted ? "✓ Consent Captured" : "Give Consent & Proceed"}
          </Button>
        </div>

        {/* BGV stats */}
        {(bgv || consentAccepted) && (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {[
              { label: "BGV Score", value: `${bgv?.score ?? 0}%`, color: (bgv?.score ?? 0) >= 80 ? "text-emerald-700" : "text-amber-700" },
              { label: "Overall Status", value: bgv?.overall_status || "pending", color: "text-slate-900" },
              { label: "HR Ready", value: bgv?.employee_creation_ready ? "✓ Yes" : "Pending", color: bgv?.employee_creation_ready ? "text-emerald-700" : "text-amber-700" },
              { label: "Payroll Ready", value: bgv?.payroll_activation_ready ? "✓ Yes" : "Pending", color: bgv?.payroll_activation_ready ? "text-emerald-700" : "text-amber-700" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border-2 border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{c.label}</p>
                <p className={`mt-1.5 text-lg font-black capitalize ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Verification buttons */}
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Additional Verifications</p>
          <InfoBox variant="info">
            <p className="text-xs">
              <strong>Optional verifications:</strong> Use these buttons if you need to verify specific details.
              If you connected DigiLocker in Step 3, your Aadhaar and PAN are already fetched.
            </p>
          </InfoBox>
          <div className="grid gap-2 grid-cols-2 mt-3">
            {[
              { label: "Verify Aadhaar", onClick: onVerifyAadhaar, icon: "🪪" },
              { label: "Verify PAN", onClick: onVerifyPan, icon: "📋" },
              { label: "Verify Bank A/C", onClick: onVerifyBank, icon: "🏦" },
              { label: "Verify UAN / Employment", onClick: onVerifyUan, icon: "🏢" },
            ].map(({ label, onClick, icon, highlight }) => {
              const checkType = label.toLowerCase().includes("aadhaar") ? "aadhaar"
                : label.toLowerCase().includes("pan") ? "pan"
                : label.toLowerCase().includes("bank") ? "bank"
                : label.toLowerCase().includes("uan") ? "employment" : null;
              const check = bgv?.checks.find((c) => checkType && c.check_type?.toLowerCase() === checkType);
              const verified = check?.status === "verified";
              return (
                <Button
                  key={label}
                  variant={highlight ? "default" : "outline"}
                  onClick={onClick}
                  disabled={!consentAccepted || saving || verified}
                  size="lg"
                  className={`min-h-[52px] text-sm font-bold rounded-xl border-2 flex items-center gap-2 justify-start px-4 ${
                    verified ? "border-emerald-200 bg-emerald-50 text-emerald-700 opacity-80 cursor-default" : "border-slate-200 hover:border-indigo-300"
                  }`}
                >
                  <span>{icon}</span>
                  <span className="flex-1 text-left">{label}</span>
                  {verified && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                </Button>
              );
            })}
          </div>
          {!consentAccepted && (
            <p className="text-xs text-slate-500 mt-2 text-center">Give consent above to enable verifications</p>
          )}
        </div>

        {/* BGV checks table */}
        {(bgv?.checks.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-xl border-2 border-slate-200 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 border-b-2 border-slate-200">
                <tr>{["Check", "Status", "Score", "Summary"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-bold uppercase text-slate-600">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {bgv!.checks.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-3 font-semibold capitalize">{c.check_type?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                        c.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{c.match_score ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-500 text-xs">{c.result_summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <InfoBox variant="info">
          <p className="text-xs">
            <strong>Manual BGV path:</strong> If digital verification fails or the service is unavailable, your Payroll HR at the branch will
            complete manual background verification after submission. Your onboarding is <strong>never blocked</strong> by BGV API failures.
          </p>
        </InfoBox>
      </CardContent>
    </Card>
  );
}

// ── Step 6: Bank Details ───────────────────────────────────────────────────────

export function Step6Bank({
  bank, setBank, saving, onSave, onLookupIfsc, token,
}: {
  bank: BankForm;
  setBank: React.Dispatch<React.SetStateAction<BankForm>>;
  saving: boolean;
  onSave: () => void;
  onLookupIfsc: (ifsc: string) => void;
  token?: string;
}) {
  const upd = (k: keyof BankForm, v: string) => setBank((p) => ({ ...p, [k]: v }));
  const mismatch = Boolean(bank.accountNo && bank.confirmAccountNo && bank.accountNo !== bank.confirmAccountNo);
  const bankPreviouslySaved = Boolean(bank.bankName && !bank.accountNo);
  const ifscOk = !bank.ifscCode || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifscCode.toUpperCase());
  const nameMatch = !bank.nameOnCheque || !bank.accountHolderName ||
    bank.nameOnCheque.trim().toLowerCase() === bank.accountHolderName.trim().toLowerCase();

  return (
    <Card className="border-t-4 border-t-green-500 shadow-sm border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-green-50 text-green-600 flex items-center justify-center text-lg">🏦</span>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Bank Account Details</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">For salary credit and statutory payment compliance</p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 px-5 pb-5">
        {bankPreviouslySaved && (
          <div className="mb-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 flex items-center gap-2">
            ✓ Bank details previously saved ({bank.bankName}). Re-enter account number to update or skip to proceed.
          </div>
        )}
        <InfoBox variant="info">
          <p className="text-xs">
            The account must be a <strong>personal salary/savings account</strong> in your name.
            Joint accounts are not permitted for salary credit. Upload a cancelled cheque or passbook front page as document evidence.
          </p>
        </InfoBox>

        <SectionHead sub="Bank and branch information">Bank Details</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <F
              label="IFSC Code"
              value={bank.ifscCode}
              onChange={(v) => upd("ifscCode", v.toUpperCase())}
              onBlur={() => onLookupIfsc(bank.ifscCode)}
              placeholder="ABCD0123456"
              required
              error={!ifscOk ? "Invalid IFSC format (11 chars: ABCD0123456)" : ""}
              helpText="Bank and branch autofill on valid IFSC"
            />
          </div>
          <F label="Bank Name" value={bank.bankName} onChange={(v) => upd("bankName", v)} required prefilled={Boolean(bank.bankName)} />
          <F label="Branch Name" value={bank.branchName} onChange={(v) => upd("branchName", v)} prefilled={Boolean(bank.branchName)} />
        </div>

        <SectionHead sub="Account holder and number details">Account Details</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <F
            label="Account Holder Name"
            value={bank.accountHolderName}
            onChange={(v) => upd("accountHolderName", v)}
            required
            helpText="Exactly as on bank records"
            placeholder="Full name as on bank"
          />
          <F label="Account Type" value={bank.accountType} onChange={(v) => upd("accountType", v)} opts={ACCOUNTS} required />

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-slate-700">Account Number <span className="text-red-500">*</span></Label>
            <Input
              value={bank.accountNo || ""}
              onChange={(e) => upd("accountNo", e.target.value)}
              inputMode="numeric"
              className="min-h-[48px] text-base rounded-xl border-2 border-slate-200 hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-400"
              placeholder="Enter account number"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold text-slate-700">
              Confirm Account Number <span className="text-red-500">*</span>
            </Label>
            <Input
              value={bank.confirmAccountNo || ""}
              onChange={(e) => upd("confirmAccountNo", e.target.value)}
              inputMode="numeric"
              className={`min-h-[48px] text-base rounded-xl border-2 transition-colors ${
                mismatch ? "border-red-400 bg-red-50 focus:ring-red-400" :
                  (bank.confirmAccountNo && !mismatch) ? "border-emerald-400 bg-emerald-50" :
                    "border-slate-200 hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-400"
              }`}
              placeholder="Re-enter to confirm"
            />
            {mismatch && (
              <p className="text-sm text-red-600 font-bold flex items-center gap-1">
                <AlertCircle className="h-4 w-4" /> Account numbers do not match — please re-check
              </p>
            )}
            {bank.confirmAccountNo && !mismatch && (
              <p className="text-sm text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Account numbers match
              </p>
            )}
          </div>
        </div>

        <SectionHead sub="Name as printed on your cancelled cheque (for HR verification)">Cancelled Cheque Verification</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <F
              label="Name on Cheque"
              value={bank.nameOnCheque}
              onChange={(v) => upd("nameOnCheque", v)}
              helpText="Exactly as printed on your cheque/passbook"
              placeholder="Name as on cheque"
              error={!nameMatch ? "Name on cheque does not match account holder name" : ""}
            />
          </div>
          {!nameMatch && (
            <InfoBox variant="warning">
              <p className="font-bold text-xs">Name Mismatch</p>
              <p className="text-xs mt-0.5">
                This mismatch will be flagged for HR review. It will <strong>NOT block your submission</strong>.
                Your Payroll HR will verify manually.
              </p>
            </InfoBox>
          )}
          {nameMatch && bank.nameOnCheque && (
            <InfoBox variant="success">
              <p className="text-xs font-bold">Name matches account holder ✓</p>
            </InfoBox>
          )}
        </div>

        <div className="mt-2">
          <InfoBox variant="warning">
            <p className="text-xs">
              <strong>Upload evidence:</strong> Please also upload your cancelled cheque or bank passbook front page in the Documents step.
              Name mismatches are routed to HR Payroll for manual review — <strong>not a blocker for submission.</strong>
            </p>
          </InfoBox>
        </div>

        {/* Penny Drop Verification */}
        {token && (
          <div className="mt-6">
            <SectionHead sub="Optional — verify your account with ₹1 test transaction">Bank Account Verification</SectionHead>
            <InfoBox variant="info">
              <p className="text-xs">
                <strong>Optional:</strong> Verify your bank account with a ₹1 test transaction.
                We'll credit your account and confirm it matches your name.
                This helps prevent payroll delays but is not mandatory.
              </p>
            </InfoBox>
            <div className="mt-3">
              <PennyDropButton
                token={token}
                accountNo={bank.accountNo || ""}
                ifscCode={bank.ifscCode || ""}
                accountHolderName={bank.accountHolderName || ""}
                disabled={!bank.accountNo || !bank.ifscCode || mismatch}
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            onClick={onSave}
            disabled={saving || mismatch || !ifscOk}
            size="lg"
            className="min-h-[52px] px-8 text-base font-bold bg-green-600 hover:bg-green-700 rounded-xl shadow-lg gap-2"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            Save Bank Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
