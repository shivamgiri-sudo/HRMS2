import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, FileUp, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type ApiResponse<T> = { success?: boolean; ok?: boolean; data: T; message?: string };

type StatusData = {
  token: {
    candidate_id: string;
    candidate_code?: string;
    full_name?: string;
    mobile?: string;
    email?: string;
    gender?: string;
    date_of_birth?: string;
    branch_name?: string;
    process_name?: string;
    source_type?: string;
    source?: string;
  };
  documents: Array<{ id: string; doc_type: string; doc_name: string; page_no?: number; file_original_name?: string; file_url?: string; document_status: string; uploaded_at: string }>;
  bank?: any;
  qualifications: any[];
  family?: any;
  experience?: any;
};

type BgvStatus = {
  consent?: any;
  checks: any[];
  score: number;
  overall_status: string;
  employee_creation_ready: boolean;
  payroll_activation_ready: boolean;
  missing_mandatory_checks: string[];
};

const emptyEmployee = {
  title: "Mr", employeeName: "", relation: "Father", fatherHusbandName: "", gender: "", maritalStatus: "", dateOfBirth: "", bloodGroup: "",
  // Nominee 1
  nominee: "", nomineeRelation: "", nomineeDateOfBirth: "", nominee1SharePct: "",
  // Nominee 2 (optional)
  nominee2Name: "", nominee2Relation: "", nominee2Dob: "", nominee2SharePct: "",
  permanentAddress: "", permanentState: "", permanentCity: "", permanentPincode: "",
  presentAddress: "", presentState: "", presentCity: "", presentPincode: "",
  mobileNumber: "", altMobileNumber: "", personalEmailId: "", officialEmailId: "",
  panNumber: "", aadhaarNumber: "",
  // Identity documents (candidate fills if available — optional)
  passportNo: "", drivingLicenseNo: "",
  // Statutory IDs from previous employment (optional)
  uanNumber: "", epfNumber: "", esicNumber: "",
  sourceType: "", source: "",
};

const emptyBank = { bankName: "", branchName: "", accountHolderName: "", accountNo: "", ifscCode: "", accountType: "Savings" };
const emptyQualification = { qualification: "", specializationCourseName: "", passedOutYear: "", passedOutState: "", passedOutCity: "", passedOutPercentage: "", documentId: "" };
const emptyFamily = { annualIncome: "", countOfDependents: "" };
const emptyExperience = { workingExperience: "fresher", experienceYear: "", experienceDocType: "", experienceDocumentId: "", employerName: "", lastDesignation: "", lastCtc: "" };

export default function CandidateOnboardingFullPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [bgv, setBgv] = useState<BgvStatus | null>(null);
  const [employee, setEmployee] = useState(emptyEmployee);
  const [bank, setBank] = useState(emptyBank);
  const [qualification, setQualification] = useState(emptyQualification);
  const [family, setFamily] = useState(emptyFamily);
  const [experience, setExperience] = useState(emptyExperience);
  const [docForm, setDocForm] = useState({ docType: "Aadhaar", docName: "Aadhaar Card", pageNo: "" });
  const [file, setFile] = useState<File | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);

  const steps: Record<Step, string> = {
    1: "Welcome", 2: "Employee Details", 3: "Documents", 4: "Digital BGV", 5: "Bank Details", 6: "Qualification", 7: "Family & Experience", 8: "Review & Submit",
  };

  const apiBase = "/api/ats/onboarding-full";
  const bgvBase = "/api/ats/bgv";

  const load = async () => {
    if (!token) { setError("No onboarding token found."); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await hrmsApi.get<ApiResponse<StatusData>>(`${apiBase}/status?token=${encodeURIComponent(token)}`);
      setStatus(res.data);
      const t = res.data.token;
      const saved = t && (res.data.token as any).saved_profile;
      setEmployee((prev) => ({
        ...prev,
        employeeName: saved?.employee_name ?? t.full_name ?? "",
        mobileNumber: saved?.mobile_number ?? t.mobile ?? "",
        personalEmailId: saved?.personal_email_id ?? t.email ?? "",
        gender: saved?.gender ?? t.gender ?? "",
        dateOfBirth: saved?.date_of_birth?.slice?.(0, 10) ?? t.date_of_birth?.slice?.(0, 10) ?? "",
        sourceType: saved?.source_type ?? t.source_type ?? "",
        source: saved?.source ?? t.source ?? "",
        title: saved?.title ?? prev.title,
        relation: saved?.relation ?? prev.relation,
        fatherHusbandName: saved?.father_husband_name ?? "",
        maritalStatus: saved?.marital_status ?? "",
        bloodGroup: saved?.blood_group ?? "",
        nominee: saved?.nominee_name ?? "",
        nomineeRelation: saved?.nominee_relation ?? "",
        nomineeDateOfBirth: saved?.nominee_date_of_birth?.slice?.(0, 10) ?? "",
        permanentAddress: saved?.permanent_address ?? "",
        permanentState: saved?.permanent_state ?? "",
        permanentCity: saved?.permanent_city ?? "",
        permanentPincode: saved?.permanent_pincode ?? "",
        presentAddress: saved?.present_address ?? "",
        presentState: saved?.present_state ?? "",
        presentCity: saved?.present_city ?? "",
        presentPincode: saved?.present_pincode ?? "",
        altMobileNumber: saved?.alt_mobile_number ?? "",
        officialEmailId: saved?.official_email_id ?? "",
      }));
      if (res.data.bank) setBank((prev) => ({ ...prev, bankName: res.data.bank.bank_name ?? "", branchName: res.data.bank.branch_name ?? "", accountHolderName: res.data.bank.account_holder_name ?? "", ifscCode: res.data.bank.ifsc_code ?? "", accountType: res.data.bank.account_type ?? "Savings" }));
      const bgvRes = await hrmsApi.get<ApiResponse<BgvStatus>>(`${bgvBase}/status?token=${encodeURIComponent(token)}`);
      setBgv(bgvRes.data);
      setConsentAccepted(Boolean(bgvRes.data?.consent));
    } catch (e: any) {
      setError(e?.message || "Unable to load onboarding form.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token]);
  const updateEmployee = (key: keyof typeof emptyEmployee, value: string) => setEmployee((prev) => ({ ...prev, [key]: value }));
  const updateBank = (key: keyof typeof emptyBank, value: string) => setBank((prev) => ({ ...prev, [key]: value }));

  const saveEmployee = async () => { setSaving(true); try { await hrmsApi.post(`${apiBase}/employee-details`, { token, ...employee }); await load(); } finally { setSaving(false); } };
  const saveBank = async () => { setSaving(true); try { await hrmsApi.post(`${apiBase}/bank-details`, { token, ...bank }); await load(); } finally { setSaving(false); } };
  const addQualification = async () => { setSaving(true); try { await hrmsApi.post(`${apiBase}/qualification`, { token, ...qualification }); setQualification(emptyQualification); await load(); } finally { setSaving(false); } };
  const saveFamilyExperience = async () => { setSaving(true); try { await hrmsApi.post(`${apiBase}/family`, { token, ...family }); await hrmsApi.post(`${apiBase}/experience`, { token, ...experience }); await load(); } finally { setSaving(false); } };
  const saveFinal = async () => { setSaving(true); try { await hrmsApi.post(`${apiBase}/final-section`, { token, confirmed: true }); await load(); } finally { setSaving(false); } };

  const uploadDocument = async () => {
    if (!file) return setError("Please select a file first.");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("token", token); fd.append("docType", docForm.docType); fd.append("docName", docForm.docName); fd.append("pageNo", docForm.pageNo); fd.append("file", file);
      const res = await fetch(`${import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055"}${apiBase}/documents`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      setFile(null); setDocForm({ docType: "Aadhaar", docName: "Aadhaar Card", pageNo: "" }); await load();
    } catch (e: any) { setError(e.message || "Upload failed"); } finally { setSaving(false); }
  };

  const grantConsent = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${bgvBase}/consent`, { token, purposes: ["identity_verification", "employment_onboarding", "payroll_readiness", "statutory_compliance"] });
      await load();
    } finally { setSaving(false); }
  };
  const verifyPan = async () => { setSaving(true); try { await hrmsApi.post(`${bgvBase}/verify/pan`, { token, panNumber: employee.panNumber }); await load(); } finally { setSaving(false); } };
  const verifyBank = async () => { setSaving(true); try { await hrmsApi.post(`${bgvBase}/verify/bank`, { token, accountNo: bank.accountNo, ifscCode: bank.ifscCode, accountHolderName: bank.accountHolderName }); await load(); } finally { setSaving(false); } };
  const verifyAadhaar = async () => { const doc = status?.documents.find((d) => d.doc_type.toLowerCase().includes("aadhaar")); setSaving(true); try { await hrmsApi.post(`${bgvBase}/verify/aadhaar-offline`, { token, documentId: doc?.id, aadhaarLast4: employee.aadhaarNumber.slice(-4) }); await load(); } finally { setSaving(false); } };
  const startDigilocker = async () => { setSaving(true); try { const res = await hrmsApi.post<ApiResponse<{ authUrl: string }>>(`${bgvBase}/digilocker/start`, { token, requestedDocuments: ["AADHAAR", "PAN"] }); alert(`DigiLocker adapter initiated. URL: ${res.data.authUrl}`); await load(); } finally { setSaving(false); } };

  const submit = async () => { setSaving(true); try { await hrmsApi.post(`${apiBase}/submit`, { token }); setSubmitted(true); } catch (e: any) { setError(e.message || "Submit failed"); } finally { setSaving(false); } };

  const completion = useMemo(() => {
    let total = 0; let done = 0;
    [employee.employeeName, employee.mobileNumber, employee.personalEmailId, employee.fatherHusbandName, employee.dateOfBirth, employee.presentAddress, employee.panNumber, employee.aadhaarNumber, bank.bankName, bank.accountHolderName, bank.ifscCode].forEach((v) => { total++; if (String(v || "").trim()) done++; });
    if (status?.documents.length) done++; total++;
    if (bgv?.consent) done++; total++;
    return Math.round((done / total) * 100);
  }, [employee, bank, status, bgv]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (error && !status) return <div className="flex min-h-screen items-center justify-center p-8 text-center text-red-600">{error}</div>;
  if (submitted) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50"><CheckCircle2 className="h-16 w-16 text-emerald-500" /><h1 className="text-2xl font-black">Onboarding submitted</h1><p className="text-slate-600">HR will verify your details and continue your joining process.</p></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-3xl bg-white p-6 shadow-sm border">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.25em] text-blue-600">MAS Callnet onboarding</p><h1 className="mt-2 text-3xl font-black text-slate-950">Candidate Joining Form</h1><p className="text-slate-600">Welcome {status?.token.full_name}. Branch: {status?.token.branch_name || "N/A"} · Process: {status?.token.process_name || "N/A"}</p></div>
            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">Completion {completion}%</div>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2 md:grid-cols-8">{Object.entries(steps).map(([n, label]) => <button key={n} onClick={() => setStep(Number(n) as Step)} className={`rounded-xl px-3 py-2 text-xs font-bold ${Number(n) === step ? "bg-slate-950 text-white" : Number(n) < step ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{n}. {label}</button>)}</div>
        </div>
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

        {step === 1 && <Card><CardHeader><CardTitle>Auto-filled from ATS</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><ReadOnly label="Name" value={status?.token.full_name} /><ReadOnly label="Mobile" value={status?.token.mobile} /><ReadOnly label="Email" value={status?.token.email} /><ReadOnly label="Source type" value={status?.token.source_type} /><ReadOnly label="Source" value={status?.token.source} /><ReadOnly label="Candidate ID" value={status?.token.candidate_code || status?.token.candidate_id} /></CardContent></Card>}

        {step === 2 && <Card><CardHeader><CardTitle>Employee Details</CardTitle></CardHeader><CardContent className="space-y-6">
          {/* ── Personal Info ── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Personal Information</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Title *" value={employee.title} onChange={(v) => updateEmployee("title", v)} />
              <Field label="Full Name *" value={employee.employeeName} onChange={(v) => updateEmployee("employeeName", v)} />
              <Field label="Relation" value={employee.relation} onChange={(v) => updateEmployee("relation", v)} />
              <Field label="Father / Husband Name *" value={employee.fatherHusbandName} onChange={(v) => updateEmployee("fatherHusbandName", v)} />
              <Field label="Gender *" value={employee.gender} onChange={(v) => updateEmployee("gender", v)} />
              <Field label="Marital Status *" value={employee.maritalStatus} onChange={(v) => updateEmployee("maritalStatus", v)} />
              <Field type="date" label="Date of Birth *" value={employee.dateOfBirth} onChange={(v) => updateEmployee("dateOfBirth", v)} />
              <Field label="Blood Group" value={employee.bloodGroup} onChange={(v) => updateEmployee("bloodGroup", v)} />
              <Field label="Mobile Number *" value={employee.mobileNumber} onChange={(v) => updateEmployee("mobileNumber", v)} />
              <Field label="Alternate Mobile" value={employee.altMobileNumber} onChange={(v) => updateEmployee("altMobileNumber", v)} />
              <Field label="Personal Email *" value={employee.personalEmailId} onChange={(v) => updateEmployee("personalEmailId", v)} />
              <Field label="Official Email" value={employee.officialEmailId} onChange={(v) => updateEmployee("officialEmailId", v)} />
            </div>
          </div>
          {/* ── KYC Documents ── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">KYC &amp; Identity Documents</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="PAN Number *" value={employee.panNumber} onChange={(v) => updateEmployee("panNumber", v.toUpperCase())} />
              <Field label="Aadhaar Number *" value={employee.aadhaarNumber} onChange={(v) => updateEmployee("aadhaarNumber", v)} />
              <Field label="Passport No (if any)" value={employee.passportNo} onChange={(v) => updateEmployee("passportNo", v.toUpperCase())} />
              <Field label="Driving License No (if any)" value={employee.drivingLicenseNo} onChange={(v) => updateEmployee("drivingLicenseNo", v.toUpperCase())} />
            </div>
          </div>
          {/* ── Previous Employment (PF/ESIC) ── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Previous Employment — Statutory IDs <span className="normal-case font-medium text-slate-500">(Fill only if previously employed)</span></p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="UAN Number" value={employee.uanNumber} onChange={(v) => updateEmployee("uanNumber", v)} />
              <Field label="Previous EPF Number" value={employee.epfNumber} onChange={(v) => updateEmployee("epfNumber", v)} />
              <Field label="Previous ESIC Number" value={employee.esicNumber} onChange={(v) => updateEmployee("esicNumber", v)} />
            </div>
          </div>
          {/* ── Nominee 1 ── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Nominee 1 (Primary) *</p>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Nominee Name *" value={employee.nominee} onChange={(v) => updateEmployee("nominee", v)} />
              <Field label="Relation *" value={employee.nomineeRelation} onChange={(v) => updateEmployee("nomineeRelation", v)} />
              <Field type="date" label="Date of Birth" value={employee.nomineeDateOfBirth} onChange={(v) => updateEmployee("nomineeDateOfBirth", v)} />
              <Field label="Share %" value={employee.nominee1SharePct} onChange={(v) => updateEmployee("nominee1SharePct", v)} />
            </div>
          </div>
          {/* ── Nominee 2 ── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Nominee 2 (Optional)</p>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Nominee 2 Name" value={employee.nominee2Name} onChange={(v) => updateEmployee("nominee2Name", v)} />
              <Field label="Relation" value={employee.nominee2Relation} onChange={(v) => updateEmployee("nominee2Relation", v)} />
              <Field type="date" label="Date of Birth" value={employee.nominee2Dob} onChange={(v) => updateEmployee("nominee2Dob", v)} />
              <Field label="Share %" value={employee.nominee2SharePct} onChange={(v) => updateEmployee("nominee2SharePct", v)} />
            </div>
          </div>
          {/* ── Address ── */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Address</p>
            <div className="grid gap-4 md:grid-cols-2 mb-4">
              <Text label="Permanent Address *" value={employee.permanentAddress} onChange={(v) => updateEmployee("permanentAddress", v)} />
              <Text label="Present / Current Address *" value={employee.presentAddress} onChange={(v) => updateEmployee("presentAddress", v)} />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Permanent State" value={employee.permanentState} onChange={(v) => updateEmployee("permanentState", v)} />
              <Field label="Permanent City" value={employee.permanentCity} onChange={(v) => updateEmployee("permanentCity", v)} />
              <Field label="Permanent Pincode" value={employee.permanentPincode} onChange={(v) => updateEmployee("permanentPincode", v)} />
              <Field label="Present State" value={employee.presentState} onChange={(v) => updateEmployee("presentState", v)} />
              <Field label="Present City" value={employee.presentCity} onChange={(v) => updateEmployee("presentCity", v)} />
              <Field label="Present Pincode" value={employee.presentPincode} onChange={(v) => updateEmployee("presentPincode", v)} />
            </div>
          </div>
          <div><Button onClick={saveEmployee} disabled={saving}>Save Employee Details</Button></div>
        </CardContent></Card>}

        {step === 3 && <Card><CardHeader><CardTitle>Document Details</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-5"><Field label="Doc Type" value={docForm.docType} onChange={(v) => setDocForm({ ...docForm, docType: v })} /><Field label="Doc Name" value={docForm.docName} onChange={(v) => setDocForm({ ...docForm, docName: v })} /><Field label="Page No" value={docForm.pageNo} onChange={(v) => setDocForm({ ...docForm, pageNo: v })} /><div className="md:col-span-2"><Label>File Upload</Label><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div></div>
          <Button onClick={uploadDocument} disabled={saving} className="gap-2"><FileUp className="h-4 w-4" /> Upload Document</Button>
          <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">SNo</th><th className="p-3 text-left">Doc Type</th><th className="p-3 text-left">Doc Name</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">View</th><th className="p-3 text-left">Delete</th></tr></thead><tbody>{status?.documents.map((d, i) => <tr key={d.id} className="border-t"><td className="p-3">{i+1}</td><td className="p-3">{d.doc_type}</td><td className="p-3">{d.doc_name}</td><td className="p-3">{d.document_status}</td><td className="p-3">{d.file_url ? <a className="text-blue-600" href={d.file_url} target="_blank">View</a> : "-"}</td><td className="p-3"><Button variant="outline" size="sm"><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>
        </CardContent></Card>}

        {step === 4 && <Card><CardHeader><CardTitle>Digital BGV / Verification</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="rounded-2xl border bg-blue-50 p-4 text-sm text-blue-900"><b>Consent:</b> I consent to digital verification of my identity, PAN, bank account, documents and onboarding details for employment, payroll, statutory and BGV purposes.</div>
          <Button onClick={grantConsent} disabled={saving || consentAccepted} className="gap-2"><ShieldCheck className="h-4 w-4" /> {consentAccepted ? "Consent Captured" : "Give Consent"}</Button>
          <div className="grid gap-4 md:grid-cols-4"><VerifyCard title="BGV Score" value={`${bgv?.score ?? 0}%`} /><VerifyCard title="Overall" value={bgv?.overall_status || "pending"} /><VerifyCard title="Employee Ready" value={bgv?.employee_creation_ready ? "Yes" : "No"} /><VerifyCard title="Payroll Ready" value={bgv?.payroll_activation_ready ? "Yes" : "No"} /></div>
          <div className="grid gap-3 md:grid-cols-4"><Button onClick={verifyAadhaar} disabled={!consentAccepted || saving}>Verify Aadhaar</Button><Button onClick={verifyPan} disabled={!consentAccepted || saving}>Verify PAN</Button><Button onClick={verifyBank} disabled={!consentAccepted || saving}>Verify Bank</Button><Button onClick={startDigilocker} disabled={!consentAccepted || saving}>Connect DigiLocker</Button></div>
          <div className="rounded-2xl border"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Check</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Match</th><th className="p-3 text-left">Summary</th></tr></thead><tbody>{(bgv?.checks || []).map((c) => <tr key={c.id} className="border-t"><td className="p-3">{c.check_type}</td><td className="p-3">{c.status}</td><td className="p-3">{c.match_score ?? "-"}</td><td className="p-3">{c.result_summary}</td></tr>)}</tbody></table></div>
        </CardContent></Card>}

        {step === 5 && <Card><CardHeader><CardTitle>Bank Details</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Field label="Bank Name" value={bank.bankName} onChange={(v) => updateBank("bankName", v)} /><Field label="Branch Name" value={bank.branchName} onChange={(v) => updateBank("branchName", v)} /><Field label="Account Holder Name" value={bank.accountHolderName} onChange={(v) => updateBank("accountHolderName", v)} /><Field label="Account No" value={bank.accountNo} onChange={(v) => updateBank("accountNo", v)} /><Field label="IFSC Code" value={bank.ifscCode} onChange={(v) => updateBank("ifscCode", v.toUpperCase())} /><Field label="Account Type" value={bank.accountType} onChange={(v) => updateBank("accountType", v)} /><div className="md:col-span-3"><Button onClick={saveBank} disabled={saving}>Upload Bank Details</Button></div></CardContent></Card>}

        {step === 6 && <Card><CardHeader><CardTitle>Qualification Details</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 md:grid-cols-3"><Field label="Qualification" value={qualification.qualification} onChange={(v) => setQualification({ ...qualification, qualification: v })} /><Field label="Specialization / Course Name" value={qualification.specializationCourseName} onChange={(v) => setQualification({ ...qualification, specializationCourseName: v })} /><Field label="Passed Out Year" value={qualification.passedOutYear} onChange={(v) => setQualification({ ...qualification, passedOutYear: v })} /><Field label="Passed Out State" value={qualification.passedOutState} onChange={(v) => setQualification({ ...qualification, passedOutState: v })} /><Field label="Passed Out City" value={qualification.passedOutCity} onChange={(v) => setQualification({ ...qualification, passedOutCity: v })} /><Field label="Passed Out %" value={qualification.passedOutPercentage} onChange={(v) => setQualification({ ...qualification, passedOutPercentage: v })} /></div><Button onClick={addQualification} disabled={saving}>Add Qualification</Button><div className="grid gap-2">{status?.qualifications.map((q) => <div key={q.id} className="rounded-xl border p-3 text-sm">{q.qualification} · {q.specialization_course_name} · {q.passed_out_year}</div>)}</div></CardContent></Card>}

        {step === 7 && <Card><CardHeader><CardTitle>Family & Working Experience Details</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Field label="Annual Income" value={family.annualIncome} onChange={(v) => setFamily({ ...family, annualIncome: v })} /><Field label="Count Of Dependents" value={family.countOfDependents} onChange={(v) => setFamily({ ...family, countOfDependents: v })} /><Field label="Working Experience" value={experience.workingExperience} onChange={(v) => setExperience({ ...experience, workingExperience: v })} /><Field label="Experience Year" value={experience.experienceYear} onChange={(v) => setExperience({ ...experience, experienceYear: v })} /><Field label="Experience Doc Type" value={experience.experienceDocType} onChange={(v) => setExperience({ ...experience, experienceDocType: v })} /><Field label="Employer Name" value={experience.employerName} onChange={(v) => setExperience({ ...experience, employerName: v })} /><div className="md:col-span-3"><Button onClick={saveFamilyExperience} disabled={saving}>Save Final Section</Button></div></CardContent></Card>}

        {step === 8 && <Card><CardHeader><CardTitle>Review & Submit</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><ReadOnly label="Name" value={employee.employeeName} /><ReadOnly label="PAN" value={employee.panNumber ? `${employee.panNumber.slice(0,3)}XXXX${employee.panNumber.slice(-2)}` : ""} /><ReadOnly label="Documents" value={`${status?.documents.length || 0} uploaded`} /><ReadOnly label="BGV" value={bgv?.overall_status} /><ReadOnly label="Bank" value={bank.bankName} /><ReadOnly label="Completion" value={`${completion}%`} /></div><div className="flex gap-3"><Button variant="outline" onClick={saveFinal} disabled={saving}>Save Final Section</Button><Button onClick={submit} disabled={saving}>Submit</Button></div></CardContent></Card>}

        <div className="flex justify-between"><Button variant="outline" disabled={step===1} onClick={() => setStep((s) => Math.max(1, s-1) as Step)}>Back</Button><Button disabled={step===8} onClick={() => setStep((s) => Math.min(8, s+1) as Step)}>Next</Button></div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <div><Label>{label}</Label><Input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} /></div>; }
function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <div><Label>{label}</Label><Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} /></div>; }
function ReadOnly({ label, value }: { label: string; value?: any }) { return <div className="rounded-2xl border bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{value || "-"}</p></div>; }
function VerifyCard({ title, value }: { title: string; value: string }) { return <div className="rounded-2xl border bg-white p-4"><p className="text-xs font-black uppercase text-slate-500">{title}</p><p className="mt-2 text-xl font-black text-slate-950 capitalize">{value}</p></div>; }
