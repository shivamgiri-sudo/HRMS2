import { useState } from "react";
import { FileUp, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  EmployeeForm, BankForm, StatusData, BgvStatus,
} from "./useOnboardingFull";

// ── Mobile-first form primitives with touch-friendly sizing ───────────────────
function F({ label, value, onChange, type = "text", opts, mode, onBlur, placeholder, required, prefilled }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; opts?: string[]; mode?: string; onBlur?: () => void;
  placeholder?: string; required?: boolean; prefilled?: boolean;
}) {
  return (
    <div>
      <Label className="text-sm font-semibold">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {prefilled && <span className="ml-2 text-[10px] text-emerald-600 font-bold uppercase">✓ Pre-filled</span>}
      </Label>
      {opts
        ? <select className="flex min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={value || ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        : <Input type={type} inputMode={mode as any} value={value || ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} className={`min-h-[44px] text-base ${prefilled ? 'bg-emerald-50 border-emerald-200' : ''}`} />
      }
    </div>
  );
}
function T({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><Label className="text-sm font-semibold">{label}</Label><Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} className="min-h-[88px] text-base" /></div>;
}
function RO({ label, value }: { label: string; value?: any }) {
  return <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-4"><p className="text-[11px] font-bold uppercase text-emerald-700">{label}</p><p className="mt-1.5 font-semibold text-slate-900 text-base">{value || "—"}</p></div>;
}
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-4 py-2.5 text-sm font-bold border-2 transition-all min-h-[44px] ${active ? "bg-slate-950 text-white border-slate-950 scale-105" : "bg-white text-slate-700 border-slate-300 hover:border-slate-600"}`}>{label}</button>;
}
function SectionHead({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500 mt-6 mb-4 pb-2 border-b border-slate-200">{children}</p>;
}

const TITLES = ["Mr", "Mrs", "Ms", "Dr"];
const GENDERS = ["Male", "Female", "Other"];
const MARITALS = ["Single", "Married", "Divorced", "Widowed"];
const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONS = ["Father", "Husband", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister"];
const NOM_RELS = ["Father", "Mother", "Spouse", "Son", "Daughter", "Brother", "Sister", "Guardian"];
const CATEGORIES = ["General", "SC", "ST", "OBC", "OBC-NCL", "EWS", "Other"];
const RELIGIONS = ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Parsi", "Other"];
const ADDR_PROOFS = ["Aadhaar", "Driving License", "Voter ID", "Passport", "Rent Agreement", "Utility Bill"];
const ACCOUNTS = ["Savings", "Current", "Salary"];
const DOC_TYPES = ["Aadhaar", "PAN Card", "Passport", "Driving License", "Voter ID", "10th Marksheet", "12th Marksheet", "Degree Certificate", "Experience Letter", "Offer Letter", "Salary Slip", "Relieving Letter", "Other"];

// ── Step 1: Welcome ────────────────────────────────────────────────────────────
export function Step1Welcome({ status }: { status: StatusData | null }) {
  const t = status?.token;
  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Welcome to MAS Callnet</CardTitle>
        <p className="text-sm text-blue-100 mt-1">Your details from registration are pre-filled below</p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RO label="Full Name" value={t?.full_name} />
          <RO label="Mobile" value={t?.mobile} />
          <RO label="Email" value={t?.email} />
          <RO label="Branch" value={t?.branch_name} />
          <RO label="Process" value={t?.process_name} />
          <RO label="Candidate Code" value={t?.candidate_code || t?.candidate_id} />
          <RO label="Source" value={t?.source_type} />
          <RO label="Source Detail" value={t?.source} />
          <RO label="Gender" value={t?.gender} />
        </div>
        <div className="mt-6 rounded-xl border-2 border-blue-200 bg-blue-50 p-5 text-sm leading-relaxed text-blue-900">
          <p className="font-bold text-base mb-2">📋 Important Instructions</p>
          <ul className="list-disc list-inside space-y-1.5 ml-1">
            <li>Fill all sections carefully — your details are used for payroll, PF, ESI and HR records</li>
            <li>Use the step tabs above to navigate between sections</li>
            <li>All sections autosave as you type — no data will be lost</li>
            <li>Fields marked with * are mandatory</li>
          </ul>
        </div>
      </CardContent>
    </Card>
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

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-t-lg">
        <CardTitle className="text-xl">Personal Information</CardTitle>
        <p className="text-sm text-slate-300 mt-1">Complete your personal and contact details</p>
      </CardHeader>
      <CardContent className="pt-5">
        <SectionHead>Basic Details</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Title" value={employee.title} onChange={(v) => upd("title", v)} opts={TITLES} />
          <F label="Full Name" value={employee.employeeName} onChange={(v) => upd("employeeName", v)} required prefilled={Boolean(employee.employeeName)} />
          <F label="Relation" value={employee.relation} onChange={(v) => upd("relation", v)} opts={RELATIONS} />
          <F label="Father / Guardian Name" value={employee.fatherHusbandName} onChange={(v) => upd("fatherHusbandName", v)} required />
          <F label="Mother Name" value={employee.motherName} onChange={(v) => upd("motherName", v)} />
          <F label="Date of Birth" value={employee.dateOfBirth} onChange={(v) => upd("dateOfBirth", v)} type="date" required prefilled={Boolean(employee.dateOfBirth)} />
          <F label="Gender" value={employee.gender} onChange={(v) => upd("gender", v)} opts={GENDERS} required prefilled={Boolean(employee.gender)} />
          <F label="Marital Status" value={employee.maritalStatus} onChange={(v) => upd("maritalStatus", v)} opts={MARITALS} />
          <F label="Blood Group" value={employee.bloodGroup} onChange={(v) => upd("bloodGroup", v)} opts={BLOODS} />
        </div>

        <SectionHead>Contact</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Mobile Number" value={employee.mobileNumber} onChange={(v) => upd("mobileNumber", v)} type="tel" mode="tel" required prefilled={Boolean(employee.mobileNumber)} />
          <F label="Alternate Mobile" value={employee.altMobileNumber} onChange={(v) => upd("altMobileNumber", v)} type="tel" mode="tel" />
          <F label="Personal Email" value={employee.personalEmailId} onChange={(v) => upd("personalEmailId", v)} type="email" mode="email" required prefilled={Boolean(employee.personalEmailId)} />
          <F label="Official Email" value={employee.officialEmailId} onChange={(v) => upd("officialEmailId", v)} type="email" mode="email" />
        </div>

        <SectionHead>Emergency Contact</SectionHead>
        <div className="grid gap-5 sm:grid-cols-3">
          <F label="Emergency Contact Name" value={employee.emergencyContactName} onChange={(v) => upd("emergencyContactName", v)} />
          <F label="Relation" value={employee.emergencyContactRelation} onChange={(v) => upd("emergencyContactRelation", v)} />
          <F label="Emergency Mobile" value={employee.emergencyContactMobile} onChange={(v) => upd("emergencyContactMobile", v)} type="tel" mode="tel" />
        </div>

        <SectionHead>Background (Optional)</SectionHead>
        <div className="grid gap-5 sm:grid-cols-3">
          <F label="Nationality" value={employee.nationality} onChange={(v) => upd("nationality", v)} />
          <F label="Religion" value={employee.religion} onChange={(v) => upd("religion", v)} opts={RELIGIONS} />
          <F label="Category" value={employee.category} onChange={(v) => upd("category", v)} opts={CATEGORIES} />
        </div>

        <SectionHead>Nominee 1 (Primary)</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Nominee Name" value={employee.nominee} onChange={(v) => upd("nominee", v)} required />
          <F label="Relation" value={employee.nomineeRelation} onChange={(v) => upd("nomineeRelation", v)} opts={NOM_RELS} />
          <F label="Date of Birth" value={employee.nomineeDateOfBirth} onChange={(v) => upd("nomineeDateOfBirth", v)} type="date" />
          <F label="Share %" value={employee.nominee1SharePct} onChange={(v) => upd("nominee1SharePct", v)} mode="numeric" />
        </div>

        <SectionHead>Nominee 2 (Optional)</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Nominee 2 Name" value={employee.nominee2Name} onChange={(v) => upd("nominee2Name", v)} />
          <F label="Relation" value={employee.nominee2Relation} onChange={(v) => upd("nominee2Relation", v)} opts={NOM_RELS} />
          <F label="Date of Birth" value={employee.nominee2Dob} onChange={(v) => upd("nominee2Dob", v)} type="date" />
          <F label="Share %" value={employee.nominee2SharePct} onChange={(v) => upd("nominee2SharePct", v)} mode="numeric" />
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={saving} size="lg" className="min-h-[48px] px-8 text-base font-semibold">
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Save Personal Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 3: Address & KYC ─────────────────────────────────────────────────────
export function Step3AddressKyc({
  employee, setEmployee, saving, onSave,
}: {
  employee: EmployeeForm;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  saving: boolean;
  onSave: () => void;
}) {
  const upd = (k: keyof EmployeeForm, v: string) => setEmployee((p) => ({ ...p, [k]: v }));
  const [sameAddr, setSameAddr] = useState(false);

  const syncPresent = (field: keyof EmployeeForm, v: string) => {
    upd(field, v);
    if (sameAddr) {
      const map: Partial<Record<keyof EmployeeForm, keyof EmployeeForm>> = {
        permanentAddress: "presentAddress", permanentState: "presentState",
        permanentCity: "presentCity", permanentPincode: "presentPincode",
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

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Address & KYC Details</CardTitle>
        <p className="text-sm text-purple-100 mt-1">Your addresses and identity documents</p>
      </CardHeader>
      <CardContent className="pt-5">
        <SectionHead>Permanent Address</SectionHead>
        <div className="grid gap-5 md:grid-cols-2 mb-3">
          <T label="Permanent Address *" value={employee.permanentAddress} onChange={(v) => syncPresent("permanentAddress", v)} />
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border">
              <input type="checkbox" id="sameAddr" checked={sameAddr} onChange={(e) => toggleSame(e.target.checked)} className="h-5 w-5 rounded" />
              <label htmlFor="sameAddr" className="text-sm font-semibold cursor-pointer select-none">Present address is same as permanent address</label>
            </div>
            <T label="Present / Current Address *" value={employee.presentAddress} onChange={(v) => { setSameAddr(false); upd("presentAddress", v); }} />
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <F label="Perm. State" value={employee.permanentState} onChange={(v) => syncPresent("permanentState", v)} />
          <F label="Perm. City" value={employee.permanentCity} onChange={(v) => syncPresent("permanentCity", v)} />
          <F label="Perm. Pincode" value={employee.permanentPincode} onChange={(v) => syncPresent("permanentPincode", v)} mode="numeric" />
          <F label="Present State" value={employee.presentState} onChange={(v) => { setSameAddr(false); upd("presentState", v); }} />
          <F label="Present City" value={employee.presentCity} onChange={(v) => { setSameAddr(false); upd("presentCity", v); }} />
          <F label="Present Pincode" value={employee.presentPincode} onChange={(v) => { setSameAddr(false); upd("presentPincode", v); }} mode="numeric" />
        </div>

        <SectionHead>Address Proof Type</SectionHead>
        <div className="flex flex-wrap gap-3">
          {ADDR_PROOFS.map((p) => (
            <Chip key={p} label={p} active={employee.addressProofType === p} onClick={() => upd("addressProofType", p)} />
          ))}
        </div>

        <SectionHead>KYC — Identity Numbers</SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <F label="PAN Number" value={employee.panNumber} onChange={(v) => upd("panNumber", v.toUpperCase())} placeholder="ABCDE1234F" required />
          <F label="Aadhaar Number" value={employee.aadhaarNumber} onChange={(v) => upd("aadhaarNumber", v)} mode="numeric" required />
          <F label="Passport No" value={employee.passportNo} onChange={(v) => upd("passportNo", v.toUpperCase())} />
          <F label="Driving License No" value={employee.drivingLicenseNo} onChange={(v) => upd("drivingLicenseNo", v.toUpperCase())} />
        </div>

        <SectionHead>Previous Statutory IDs (if previously employed)</SectionHead>
        <div className="grid gap-5 sm:grid-cols-3">
          <F label="UAN Number" value={employee.uanNumber} onChange={(v) => upd("uanNumber", v)} mode="numeric" />
          <F label="Previous EPF Number" value={employee.epfNumber} onChange={(v) => upd("epfNumber", v)} />
          <F label="Previous ESIC Number" value={employee.esicNumber} onChange={(v) => upd("esicNumber", v)} />
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={saving} size="lg" className="min-h-[48px] px-8 text-base font-semibold">
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Save Address & KYC
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 4/5: Document Upload ──────────────────────────────────────────────────
export function Step5Documents({
  status, saving, consentAccepted, onUpload, onDelete,
}: {
  status: StatusData | null;
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

  const upload = async () => {
    if (!file) { setErr("Select a file first"); return; }
    setUploading(true); setErr("");
    try { await onUpload(file, docType, docName, pageNo); setFile(null); }
    catch (e: any) { setErr(e.message || "Upload failed"); }
    finally { setUploading(false); }
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-orange-600 to-orange-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Document Upload</CardTitle>
        <p className="text-sm text-orange-100 mt-1">Upload identity docs, certificates, and proofs</p>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        {consentAccepted && (
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>BGV consent given — Aadhaar & PAN will auto-trigger verification on upload</span>
          </div>
        )}
        {err && <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{err}</div>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Label className="text-sm font-semibold">Document Type</Label>
            <select
              className="flex min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={docType}
              onChange={(e) => { setDocType(e.target.value); setDocName(e.target.value); }}
            >
              {DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-sm font-semibold">Document Name</Label>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} className="min-h-[44px] text-base" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Page No</Label>
            <Input value={pageNo} onChange={(e) => setPageNo(e.target.value)} inputMode="numeric" className="min-h-[44px] text-base" />
          </div>
          <div>
            <Label className="text-sm font-semibold">File (PDF/JPG/PNG)</Label>
            <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-h-[44px] text-base" />
          </div>
        </div>
        <Button onClick={upload} disabled={saving || uploading} size="lg" className="min-h-[48px] px-6 text-base font-semibold gap-2">
          {(saving || uploading) ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}
          Upload Document
        </Button>

        <div className="overflow-x-auto rounded-xl border shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 border-b">
              <tr>{["#", "Type", "Name", "Status", "View", ""].map((h) => <th key={h} className="p-3 text-left font-bold text-slate-700">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!status?.documents.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500 text-sm">No documents uploaded yet</td></tr>}
              {status?.documents.map((d, i) => (
                <tr key={d.id} className="border-t hover:bg-slate-50">
                  <td className="p-3 font-semibold">{i + 1}</td>
                  <td className="p-3">{d.doc_type}</td>
                  <td className="p-3">{d.doc_name}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${d.document_status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {d.document_status}
                    </span>
                  </td>
                  <td className="p-3">{d.file_url ? <a className="text-blue-600 font-semibold underline" href={d.file_url} target="_blank" rel="noreferrer">View</a> : "—"}</td>
                  <td className="p-3">
                    <Button variant="ghost" size="sm" onClick={() => onDelete(d.id)} className="min-h-[40px]">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 6: BGV ────────────────────────────────────────────────────────────────
export function Step6Bgv({
  bgv, consentAccepted, saving,
  onConsent, onVerifyAadhaar, onVerifyPan, onVerifyBank, onDigilocker,
}: {
  bgv: BgvStatus | null;
  consentAccepted: boolean;
  saving: boolean;
  onConsent: () => void;
  onVerifyAadhaar: () => void;
  onVerifyPan: () => void;
  onVerifyBank: () => void;
  onDigilocker: () => void;
}) {
  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Digital Verification (BGV)</CardTitle>
        <p className="text-sm text-indigo-100 mt-1">Consent and verify your identity documents</p>
      </CardHeader>
      <CardContent className="pt-5 space-y-6">
        <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-5 text-sm leading-relaxed text-blue-900">
          <p className="font-bold mb-2">📜 Consent Statement</p>
          <p>I consent to digital verification of my identity, PAN, bank account and documents for employment, payroll, statutory and BGV purposes.</p>
        </div>
        <Button onClick={onConsent} disabled={saving || consentAccepted} size="lg" className="min-h-[48px] px-8 text-base font-semibold gap-2">
          <ShieldCheck className="h-5 w-5" />
          {consentAccepted ? "✓ Consent Captured" : "Give Consent"}
        </Button>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "BGV Score", value: `${bgv?.score ?? 0}%` },
            { label: "Overall", value: bgv?.overall_status || "pending" },
            { label: "HR Ready", value: bgv?.employee_creation_ready ? "Yes" : "No" },
            { label: "Payroll Ready", value: bgv?.payroll_activation_ready ? "Yes" : "No" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border-2 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase text-slate-500">{c.label}</p>
              <p className="mt-2 text-2xl font-black text-slate-950 capitalize">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Button variant="outline" onClick={onVerifyAadhaar} disabled={!consentAccepted || saving} size="lg" className="min-h-[48px] text-base font-semibold">Verify Aadhaar</Button>
          <Button variant="outline" onClick={onVerifyPan} disabled={!consentAccepted || saving} size="lg" className="min-h-[48px] text-base font-semibold">Verify PAN</Button>
          <Button variant="outline" onClick={onVerifyBank} disabled={!consentAccepted || saving} size="lg" className="min-h-[48px] text-base font-semibold">Verify Bank A/C</Button>
          <Button variant="outline" onClick={onDigilocker} disabled={!consentAccepted || saving} size="lg" className="min-h-[48px] text-base font-semibold">Connect DigiLocker</Button>
        </div>

        <div className="overflow-x-auto rounded-xl border shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 border-b">
              <tr>{["Check", "Status", "Match Score", "Summary"].map((h) => <th key={h} className="p-3 text-left font-bold text-slate-700">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!bgv?.checks.length && <tr><td colSpan={4} className="p-6 text-center text-slate-500 text-sm">No checks run yet — upload Aadhaar & PAN first</td></tr>}
              {(bgv?.checks || []).map((c) => (
                <tr key={c.id} className="border-t hover:bg-slate-50">
                  <td className="p-3 font-semibold">{c.check_type}</td>
                  <td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${c.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{c.status}</span></td>
                  <td className="p-3">{c.match_score ?? "—"}</td>
                  <td className="p-3 text-slate-600">{c.result_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 7: Bank Details ───────────────────────────────────────────────────────
export function Step7Bank({
  bank, setBank, saving, onSave, onLookupIfsc,
}: {
  bank: BankForm;
  setBank: React.Dispatch<React.SetStateAction<BankForm>>;
  saving: boolean;
  onSave: () => void;
  onLookupIfsc: (ifsc: string) => void;
}) {
  const upd = (k: keyof BankForm, v: string) => setBank((p) => ({ ...p, [k]: v }));
  const mismatch = bank.accountNo && bank.confirmAccountNo && bank.accountNo !== bank.confirmAccountNo;

  return (
    <Card className="shadow-md">
      <CardHeader className="bg-gradient-to-r from-green-600 to-green-700 text-white rounded-t-lg">
        <CardTitle className="text-xl">Bank Account Details</CardTitle>
        <p className="text-sm text-green-100 mt-1">For salary credit and statutory payments</p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <F label="IFSC Code" value={bank.ifscCode} onChange={(v) => upd("ifscCode", v.toUpperCase())} onBlur={() => onLookupIfsc(bank.ifscCode)} placeholder="ABCD0123456" required />
          <F label="Bank Name" value={bank.bankName} onChange={(v) => upd("bankName", v)} required />
          <F label="Branch Name" value={bank.branchName} onChange={(v) => upd("branchName", v)} />
          <F label="Account Holder Name" value={bank.accountHolderName} onChange={(v) => upd("accountHolderName", v)} required />
          <div>
            <Label className="text-sm font-semibold">Account Number *<span className="text-red-500 ml-0.5">*</span></Label>
            <Input value={bank.accountNo || ""} onChange={(e) => upd("accountNo", e.target.value)} inputMode="numeric" className="min-h-[44px] text-base" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Confirm Account Number *<span className="text-red-500 ml-0.5">*</span></Label>
            <Input value={bank.confirmAccountNo || ""} onChange={(e) => upd("confirmAccountNo", e.target.value)} inputMode="numeric" className={`min-h-[44px] text-base ${mismatch ? "border-red-400 border-2" : ""}`} />
            {mismatch && <p className="text-sm text-red-600 mt-1.5 font-semibold">⚠ Account numbers do not match</p>}
          </div>
          <F label="Account Type" value={bank.accountType} onChange={(v) => upd("accountType", v)} opts={ACCOUNTS} required />
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={saving || Boolean(mismatch)} size="lg" className="min-h-[48px] px-8 text-base font-semibold">
            {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Save Bank Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
