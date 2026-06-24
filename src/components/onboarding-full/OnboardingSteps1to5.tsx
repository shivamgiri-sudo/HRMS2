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

// ── tiny primitives ────────────────────────────────────────────────────────────
function F({ label, value, onChange, type = "text", opts, mode, onBlur, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; opts?: string[]; mode?: string; onBlur?: () => void;
  placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <Label>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</Label>
      {opts
        ? <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={value || ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        : <Input type={type} inputMode={mode as any} value={value || ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} />
      }
    </div>
  );
}
function T({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><Label>{label}</Label><Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} /></div>;
}
function RO({ label, value }: { label: string; value?: any }) {
  return <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900 text-sm">{value || "—"}</p></div>;
}
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-bold border transition-colors ${active ? "bg-slate-950 text-white border-slate-950" : "bg-white text-slate-700 border-slate-300 hover:border-slate-500"}`}>{label}</button>;
}
function SectionHead({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-5 mb-3">{children}</p>;
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
    <Card>
      <CardHeader><CardTitle>Welcome — Auto-filled from ATS</CardTitle></CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
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
        <p className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Please fill all sections carefully. Your details will be used for payroll, PF, ESI and HR records.
          Use the step tabs above to navigate. All sections autosave as you type.
        </p>
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
    <Card>
      <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
      <CardContent>
        <SectionHead>Basic Details</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <F label="Title" value={employee.title} onChange={(v) => upd("title", v)} opts={TITLES} />
          <F label="Full Name" value={employee.employeeName} onChange={(v) => upd("employeeName", v)} required />
          <F label="Relation" value={employee.relation} onChange={(v) => upd("relation", v)} opts={RELATIONS} />
          <F label="Father / Guardian Name" value={employee.fatherHusbandName} onChange={(v) => upd("fatherHusbandName", v)} required />
          <F label="Mother Name" value={employee.motherName} onChange={(v) => upd("motherName", v)} />
          <F label="Date of Birth" value={employee.dateOfBirth} onChange={(v) => upd("dateOfBirth", v)} type="date" required />
          <F label="Gender" value={employee.gender} onChange={(v) => upd("gender", v)} opts={GENDERS} required />
          <F label="Marital Status" value={employee.maritalStatus} onChange={(v) => upd("maritalStatus", v)} opts={MARITALS} />
          <F label="Blood Group" value={employee.bloodGroup} onChange={(v) => upd("bloodGroup", v)} opts={BLOODS} />
        </div>

        <SectionHead>Contact</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <F label="Mobile Number" value={employee.mobileNumber} onChange={(v) => upd("mobileNumber", v)} type="tel" required />
          <F label="Alternate Mobile" value={employee.altMobileNumber} onChange={(v) => upd("altMobileNumber", v)} type="tel" />
          <F label="Personal Email" value={employee.personalEmailId} onChange={(v) => upd("personalEmailId", v)} type="email" required />
          <F label="Official Email" value={employee.officialEmailId} onChange={(v) => upd("officialEmailId", v)} type="email" />
        </div>

        <SectionHead>Emergency Contact</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Emergency Contact Name" value={employee.emergencyContactName} onChange={(v) => upd("emergencyContactName", v)} />
          <F label="Relation" value={employee.emergencyContactRelation} onChange={(v) => upd("emergencyContactRelation", v)} />
          <F label="Emergency Mobile" value={employee.emergencyContactMobile} onChange={(v) => upd("emergencyContactMobile", v)} type="tel" />
        </div>

        <SectionHead>Background (Optional)</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Nationality" value={employee.nationality} onChange={(v) => upd("nationality", v)} />
          <F label="Religion" value={employee.religion} onChange={(v) => upd("religion", v)} opts={RELIGIONS} />
          <F label="Category" value={employee.category} onChange={(v) => upd("category", v)} opts={CATEGORIES} />
        </div>

        <SectionHead>Nominee 1 (Primary)</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <F label="Nominee Name" value={employee.nominee} onChange={(v) => upd("nominee", v)} required />
          <F label="Relation" value={employee.nomineeRelation} onChange={(v) => upd("nomineeRelation", v)} opts={NOM_RELS} />
          <F label="Date of Birth" value={employee.nomineeDateOfBirth} onChange={(v) => upd("nomineeDateOfBirth", v)} type="date" />
          <F label="Share %" value={employee.nominee1SharePct} onChange={(v) => upd("nominee1SharePct", v)} mode="numeric" />
        </div>

        <SectionHead>Nominee 2 (Optional)</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <F label="Nominee 2 Name" value={employee.nominee2Name} onChange={(v) => upd("nominee2Name", v)} />
          <F label="Relation" value={employee.nominee2Relation} onChange={(v) => upd("nominee2Relation", v)} opts={NOM_RELS} />
          <F label="Date of Birth" value={employee.nominee2Dob} onChange={(v) => upd("nominee2Dob", v)} type="date" />
          <F label="Share %" value={employee.nominee2SharePct} onChange={(v) => upd("nominee2SharePct", v)} mode="numeric" />
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Personal Details"}
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
    <Card>
      <CardHeader><CardTitle>Address & KYC</CardTitle></CardHeader>
      <CardContent>
        <SectionHead>Permanent Address</SectionHead>
        <div className="grid gap-4 md:grid-cols-2 mb-2">
          <T label="Permanent Address *" value={employee.permanentAddress} onChange={(v) => syncPresent("permanentAddress", v)} />
          <div className="space-y-2">
            <div className="flex items-center gap-2 mt-1">
              <input type="checkbox" id="sameAddr" checked={sameAddr} onChange={(e) => toggleSame(e.target.checked)} className="h-4 w-4 rounded" />
              <label htmlFor="sameAddr" className="text-sm font-medium cursor-pointer">Same as permanent address</label>
            </div>
            <T label="Present / Current Address *" value={employee.presentAddress} onChange={(v) => { setSameAddr(false); upd("presentAddress", v); }} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-6">
          <F label="Perm. State" value={employee.permanentState} onChange={(v) => syncPresent("permanentState", v)} />
          <F label="Perm. City" value={employee.permanentCity} onChange={(v) => syncPresent("permanentCity", v)} />
          <F label="Perm. Pincode" value={employee.permanentPincode} onChange={(v) => syncPresent("permanentPincode", v)} mode="numeric" />
          <F label="Present State" value={employee.presentState} onChange={(v) => { setSameAddr(false); upd("presentState", v); }} />
          <F label="Present City" value={employee.presentCity} onChange={(v) => { setSameAddr(false); upd("presentCity", v); }} />
          <F label="Present Pincode" value={employee.presentPincode} onChange={(v) => { setSameAddr(false); upd("presentPincode", v); }} mode="numeric" />
        </div>

        <SectionHead>Address Proof Type</SectionHead>
        <div className="flex flex-wrap gap-2">
          {ADDR_PROOFS.map((p) => (
            <Chip key={p} label={p} active={employee.addressProofType === p} onClick={() => upd("addressProofType", p)} />
          ))}
        </div>

        <SectionHead>KYC — Identity Numbers</SectionHead>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <F label="PAN Number *" value={employee.panNumber} onChange={(v) => upd("panNumber", v.toUpperCase())} placeholder="ABCDE1234F" required />
          <F label="Aadhaar Number *" value={employee.aadhaarNumber} onChange={(v) => upd("aadhaarNumber", v)} mode="numeric" required />
          <F label="Passport No" value={employee.passportNo} onChange={(v) => upd("passportNo", v.toUpperCase())} />
          <F label="Driving License No" value={employee.drivingLicenseNo} onChange={(v) => upd("drivingLicenseNo", v.toUpperCase())} />
        </div>

        <SectionHead>Previous Statutory IDs (if previously employed)</SectionHead>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="UAN Number" value={employee.uanNumber} onChange={(v) => upd("uanNumber", v)} mode="numeric" />
          <F label="Previous EPF Number" value={employee.epfNumber} onChange={(v) => upd("epfNumber", v)} />
          <F label="Previous ESIC Number" value={employee.esicNumber} onChange={(v) => upd("esicNumber", v)} />
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Address & KYC"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 4: Document Upload ────────────────────────────────────────────────────
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
    <Card>
      <CardHeader><CardTitle>Document Upload</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {consentAccepted && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
            ✓ BGV consent given — Aadhaar & PAN will auto-trigger verification on upload
          </p>
        )}
        {err && <p className="text-sm font-bold text-red-600">{err}</p>}

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label>Document Type</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={docType}
              onChange={(e) => { setDocType(e.target.value); setDocName(e.target.value); }}
            >
              {DOC_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <Label>Document Name</Label>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} />
          </div>
          <div>
            <Label>Page No</Label>
            <Input value={pageNo} onChange={(e) => setPageNo(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <Label>File (PDF/JPG/PNG)</Label>
            <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <Button onClick={upload} disabled={saving || uploading} className="gap-2">
          {(saving || uploading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          Upload Document
        </Button>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>{["#", "Type", "Name", "Status", "View", ""].map((h) => <th key={h} className="p-3 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!status?.documents.length && <tr><td colSpan={6} className="p-4 text-center text-slate-500 text-xs">No documents uploaded yet</td></tr>}
              {status?.documents.map((d, i) => (
                <tr key={d.id} className="border-t">
                  <td className="p-3">{i + 1}</td>
                  <td className="p-3">{d.doc_type}</td>
                  <td className="p-3">{d.doc_name}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${d.document_status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {d.document_status}
                    </span>
                  </td>
                  <td className="p-3">{d.file_url ? <a className="text-blue-600 font-medium" href={d.file_url} target="_blank" rel="noreferrer">View</a> : "—"}</td>
                  <td className="p-3">
                    <Button variant="ghost" size="sm" onClick={() => onDelete(d.id)}>
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

// ── Step 5 (renumbered as Step 6 in flow): BGV ────────────────────────────────
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
    <Card>
      <CardHeader><CardTitle>Digital Verification (BGV)</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl border bg-blue-50 p-4 text-sm text-blue-900">
          I consent to digital verification of my identity, PAN, bank account and documents for employment, payroll, statutory and BGV purposes.
        </div>
        <Button onClick={onConsent} disabled={saving || consentAccepted} className="gap-2">
          <ShieldCheck className="h-4 w-4" />
          {consentAccepted ? "✓ Consent Captured" : "Give Consent"}
        </Button>

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {[
            { label: "BGV Score", value: `${bgv?.score ?? 0}%` },
            { label: "Overall", value: bgv?.overall_status || "pending" },
            { label: "HR Ready", value: bgv?.employee_creation_ready ? "Yes" : "No" },
            { label: "Payroll Ready", value: bgv?.payroll_activation_ready ? "Yes" : "No" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border bg-white p-4">
              <p className="text-[11px] font-black uppercase text-slate-500">{c.label}</p>
              <p className="mt-2 text-xl font-black text-slate-950 capitalize">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Button variant="outline" onClick={onVerifyAadhaar} disabled={!consentAccepted || saving}>Verify Aadhaar</Button>
          <Button variant="outline" onClick={onVerifyPan} disabled={!consentAccepted || saving}>Verify PAN</Button>
          <Button variant="outline" onClick={onVerifyBank} disabled={!consentAccepted || saving}>Verify Bank A/C</Button>
          <Button variant="outline" onClick={onDigilocker} disabled={!consentAccepted || saving}>Connect DigiLocker</Button>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>{["Check", "Status", "Match Score", "Summary"].map((h) => <th key={h} className="p-3 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!bgv?.checks.length && <tr><td colSpan={4} className="p-4 text-center text-slate-500 text-xs">No checks run yet — upload Aadhaar & PAN first</td></tr>}
              {(bgv?.checks || []).map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3">{c.check_type}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{c.status}</span></td>
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
    <Card>
      <CardHeader><CardTitle>Bank Account Details</CardTitle></CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <F label="IFSC Code *" value={bank.ifscCode} onChange={(v) => upd("ifscCode", v.toUpperCase())} onBlur={() => onLookupIfsc(bank.ifscCode)} placeholder="ABCD0123456" required />
          <F label="Bank Name *" value={bank.bankName} onChange={(v) => upd("bankName", v)} required />
          <F label="Branch Name" value={bank.branchName} onChange={(v) => upd("branchName", v)} />
          <F label="Account Holder Name *" value={bank.accountHolderName} onChange={(v) => upd("accountHolderName", v)} required />
          <div>
            <Label>Account Number *<span className="text-red-500 ml-0.5">*</span></Label>
            <Input value={bank.accountNo || ""} onChange={(e) => upd("accountNo", e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <Label>Confirm Account Number *<span className="text-red-500 ml-0.5">*</span></Label>
            <Input value={bank.confirmAccountNo || ""} onChange={(e) => upd("confirmAccountNo", e.target.value)} inputMode="numeric" className={mismatch ? "border-red-400" : ""} />
            {mismatch && <p className="text-xs text-red-500 mt-1">Account numbers do not match</p>}
          </div>
          <F label="Account Type *" value={bank.accountType} onChange={(v) => upd("accountType", v)} opts={ACCOUNTS} required />
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onSave} disabled={saving || Boolean(mismatch)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Bank Details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
