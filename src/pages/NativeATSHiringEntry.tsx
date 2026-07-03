import { useEffect, useMemo, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Bot, CheckCircle2, FileUp, Loader2, RefreshCw, Save, Send, Ticket, UserPlus, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type HiringActivityRow = Record<string, any>;
type ImportResult = {
  batchId: string;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRows: number;
  failedRows: number;
  errors: Array<{ row_number: number; column_name: string | null; error_message: string }>;
};

type Interviewer = {
  id: string;
  employee_code?: string;
  name?: string;
  email?: string;
  mobile?: string;
  branch_name?: string;
  designation_name?: string;
};

const emptyForm = {
  activity_date: new Date().toISOString().slice(0, 10),
  activity_month: "",
  recruiter_name_snapshot: "",
  recruiter_id: "",
  recruiter_employee_id: "",
  recruiter_code: "",
  hiring_source: "",
  wp_group: "",
  position_name: "",
  location_name: "",
  branch_name: "",
  process_name: "",
  candidate_name: "",
  gender: "",
  mobile: "",
  candidate_email: "",
  education_qualification: "",
  experience_level: "",
  candidate_location: "",
  recruiter_remarks: "",
  recruiter_rejection_reason: "",
  pi_hr_interviewer_date: "",
  pi_hr_interviewer_name: "",
  hr_interview_status: "",
  hr_rejection_reason: "",
  ai_assessment_score: "",
  ai_interview_result: "",
  ops_interviewer_employee_id: "",
  ops_interviewer_name: "",
  ops_interviewer_branch_snapshot: "",
  ops_interview_status: "",
  ops_rejection_reason: "",
  salary_package_inr: "",
  offer_letter_status: "",
  joining_status: "",
  batch_no: "",
  current_status: "",
  joined_candidate_emp_code: "",
  emp_referral_details: "",
  referee_employee_id: "",
  referee_employee_code: "",
  referee_name: "",
  referee_branch: "",
  referee_process: "",
  referral_relationship: "",
  referral_remarks: "",
  referral_validation_status: "",
  walkin_flag: "0",
  final_selection_flag: "0",
  joined_flag: "0",
  contacted_flag: "0",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </label>
  );
}

function Input(props: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return <input {...props} className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 ${props.className ?? ""}`} />;
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { className?: string }) {
  return <select {...props} className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 ${props.className ?? ""}`} />;
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />;
}

function Button({ icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button {...props} className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold ${props.disabled ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-950 text-white hover:bg-slate-800"} ${props.className ?? ""}`}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

export default function NativeATSHiringEntry() {
  const [form, setForm] = useState({ ...emptyForm });
  const [rows, setRows] = useState<HiringActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<"" | "save" | "candidate" | "token" | "onboarding" | "import">("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [duplicateMode, setDuplicateMode] = useState("insert_duplicates_with_warning");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [opsQuery, setOpsQuery] = useState("");
  const [opsSearch, setOpsSearch] = useState<Interviewer[]>([]);

  const isCalling = useMemo(() => window.location.pathname.includes("/calling-entry"), []);

  const loadRows = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: HiringActivityRow[] }>("/api/ats/recruiter/hiring-activity?limit=20&page=1");
      setRows(res.data ?? []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load hiring activity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  useEffect(() => {
    const term = opsQuery.trim();
    if (!term) {
      setOpsSearch([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const branchName = form.branch_name || form.location_name || "";
        const res = await hrmsApi.get<{ success: boolean; data: Interviewer[] }>(
          `/api/ats/interviewers?branchName=${encodeURIComponent(branchName)}&q=${encodeURIComponent(term)}&roundType=ops_round&limit=10`
        );
        setOpsSearch(res.data ?? []);
      } catch {
        setOpsSearch([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [opsQuery, form.branch_name, form.location_name]);

  const update = (key: keyof typeof emptyForm, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setForm({ ...emptyForm, activity_date: new Date().toISOString().slice(0, 10) });
    setMessage("");
    setImportResult(null);
    setImportFile(null);
    setOpsQuery("");
    setOpsSearch([]);
  };

  const submit = async (nextAction: "save" | "candidate" | "token" | "onboarding") => {
    setBusyAction(nextAction);
    setMessage("");
    try {
      const payload = { ...form, source_system: "HRMS" };
      const res = await hrmsApi.post<{ success: boolean; data: { row: HiringActivityRow } }>("/api/ats/recruiter/hiring-activity", payload);
      const activityId = res.data?.row?.id;
      if (!activityId) throw new Error("Saved row did not return an id");

      if (nextAction === "candidate") {
        await hrmsApi.post(`/api/ats/recruiter/hiring-activity/${activityId}/create-candidate`, {});
      }
      if (nextAction === "token") {
        await hrmsApi.post(`/api/ats/recruiter/hiring-activity/${activityId}/generate-token`, {});
      }
      if (nextAction === "onboarding") {
        await hrmsApi.post(`/api/ats/recruiter/hiring-activity/${activityId}/send-onboarding`, {});
      }

      setMessage(nextAction === "save" ? "Saved." : "Saved and action completed.");
      await loadRows();
    } catch (err: any) {
      setMessage(err?.message || "Request failed");
    } finally {
      setBusyAction("");
    }
  };

  const uploadImport = async () => {
    if (!importFile) {
      setMessage("Choose an Excel or CSV file first.");
      return;
    }
    setBusyAction("import");
    setMessage("");
    setImportResult(null);
    try {
      const body = new FormData();
      body.append("file", importFile);
      body.append("duplicateMode", duplicateMode);
      const res = await hrmsApi.postForm<{ success: boolean; data: ImportResult }>("/api/ats/recruiter/hiring-activity/import", body);
      setImportResult(res.data);
      setMessage("Import completed.");
      await loadRows();
    } catch (err: any) {
      setMessage(err.message || "Import failed");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">{isCalling ? "Calling Entry" : "Recruiter Hiring Entry"}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{isCalling ? "Recruiter Calling Entry" : "Recruiter Hiring Tracker"}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">Enter or import the main recruiter sheet here. The same row can create a candidate, mint a walk-in token, and bridge to onboarding without leaving HRMS.</p>
          </div>
          <div className="flex gap-2">
            <Button icon={<RefreshCw className="h-4 w-4" />} onClick={loadRows} type="button">Refresh</Button>
            <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={reset} type="button" className="bg-slate-100 text-slate-900 hover:bg-slate-200">Clear Form</Button>
          </div>
        </div>

        {message && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">{message}</div>}

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><Users className="h-4 w-4" /> Calling Basic Details</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Date"><Input type="date" value={form.activity_date} onChange={(e) => update("activity_date", e.target.value)} /></Field>
                <Field label="Month"><Input value={form.activity_month} onChange={(e) => update("activity_month", e.target.value)} placeholder="Apr'25" /></Field>
                <Field label="HR Recruiter"><Input value={form.recruiter_name_snapshot} onChange={(e) => update("recruiter_name_snapshot", e.target.value)} /></Field>
                <Field label="Hiring Source"><Input value={form.hiring_source} onChange={(e) => update("hiring_source", e.target.value)} placeholder="Employee Referral / Walk-In / Portal" /></Field>
                <Field label="WP Groups"><Input value={form.wp_group} onChange={(e) => update("wp_group", e.target.value)} /></Field>
                <Field label="Position"><Input value={form.position_name} onChange={(e) => update("position_name", e.target.value)} /></Field>
                <Field label="Location"><Input value={form.location_name} onChange={(e) => update("location_name", e.target.value)} /></Field>
                <Field label="Branch"><Input value={form.branch_name} onChange={(e) => update("branch_name", e.target.value)} /></Field>
                <Field label="Process Name"><Input value={form.process_name} onChange={(e) => update("process_name", e.target.value)} /></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><UserPlus className="h-4 w-4" /> Candidate Details</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Candidate Name"><Input value={form.candidate_name} onChange={(e) => update("candidate_name", e.target.value)} /></Field>
                <Field label="Gender"><Input value={form.gender} onChange={(e) => update("gender", e.target.value)} /></Field>
                <Field label="Mobile No."><Input value={form.mobile} onChange={(e) => update("mobile", e.target.value)} /></Field>
                <Field label="Candidate Email Address"><Input value={form.candidate_email} onChange={(e) => update("candidate_email", e.target.value)} /></Field>
                <Field label="Candidate Education Qualification"><Input value={form.education_qualification} onChange={(e) => update("education_qualification", e.target.value)} /></Field>
                <Field label="Experience Level"><Input value={form.experience_level} onChange={(e) => update("experience_level", e.target.value)} /></Field>
                <Field label="Candidate Location"><Input value={form.candidate_location} onChange={(e) => update("candidate_location", e.target.value)} /></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><Bot className="h-4 w-4" /> Recruiter Result / Interview</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="HR Recruiter Remarks"><Input value={form.recruiter_remarks} onChange={(e) => update("recruiter_remarks", e.target.value)} placeholder="Shortlisted / Rejected / Not Contacted" /></Field>
                <Field label="HR Recruiter Rejection Reasons"><Input value={form.recruiter_rejection_reason} onChange={(e) => update("recruiter_rejection_reason", e.target.value)} /></Field>
                <Field label="Contacted"><Select value={form.contacted_flag} onChange={(e) => update("contacted_flag", e.target.value)}><option value="0">No</option><option value="1">Yes</option></Select></Field>
                <Field label="Walkin"><Select value={form.walkin_flag} onChange={(e) => update("walkin_flag", e.target.value)}><option value="0">No</option><option value="1">Yes</option></Select></Field>
                <Field label="PI_HR Interviewer Date"><Input type="date" value={form.pi_hr_interviewer_date} onChange={(e) => update("pi_hr_interviewer_date", e.target.value)} /></Field>
                <Field label="PI_HR Interviewer"><Input value={form.pi_hr_interviewer_name} onChange={(e) => update("pi_hr_interviewer_name", e.target.value)} /></Field>
                <Field label="HR Interview Status"><Input value={form.hr_interview_status} onChange={(e) => update("hr_interview_status", e.target.value)} /></Field>
                <Field label="HR Rejection Reason"><Input value={form.hr_rejection_reason} onChange={(e) => update("hr_rejection_reason", e.target.value)} /></Field>
                <Field label="AI Assessment Score"><Input value={form.ai_assessment_score} onChange={(e) => update("ai_assessment_score", e.target.value)} /></Field>
                <Field label="AI Interview Result"><Input value={form.ai_interview_result} onChange={(e) => update("ai_interview_result", e.target.value)} /></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><Ticket className="h-4 w-4" /> Ops Interview</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Ops Interviewer Name">
                  <Input value={form.ops_interviewer_name} onChange={(e) => { update("ops_interviewer_name", e.target.value); setOpsQuery(e.target.value); }} placeholder="Search same-branch interviewer" />
                </Field>
                <Field label="Ops Interviewer Branch"><Input value={form.ops_interviewer_branch_snapshot} onChange={(e) => update("ops_interviewer_branch_snapshot", e.target.value)} /></Field>
                <Field label="Ops Interview Status"><Input value={form.ops_interview_status} onChange={(e) => update("ops_interview_status", e.target.value)} /></Field>
                <Field label="Ops Rejection Reason"><Input value={form.ops_rejection_reason} onChange={(e) => update("ops_rejection_reason", e.target.value)} /></Field>
                <Field label="Selected interviewer ID"><Input value={form.ops_interviewer_employee_id} onChange={(e) => update("ops_interviewer_employee_id", e.target.value)} /></Field>
              </div>
              {opsSearch.length > 0 && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Same-branch matches</div>
                  <div className="space-y-2">
                    {opsSearch.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          update("ops_interviewer_employee_id", item.id);
                          update("ops_interviewer_name", item.name || "");
                          update("ops_interviewer_branch_snapshot", item.branch_name || form.branch_name);
                        }}
                      >
                        <span className="font-semibold text-slate-900">{item.name || item.employee_code}</span>
                        <span className="text-xs text-slate-500">{item.branch_name || "Branch"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><Send className="h-4 w-4" /> Offer, Joining & Referral</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Salary Package in INR"><Input value={form.salary_package_inr} onChange={(e) => update("salary_package_inr", e.target.value)} /></Field>
                <Field label="Offer Letter"><Input value={form.offer_letter_status} onChange={(e) => update("offer_letter_status", e.target.value)} /></Field>
                <Field label="Joining Status"><Input value={form.joining_status} onChange={(e) => update("joining_status", e.target.value)} /></Field>
                <Field label="Batch No."><Input value={form.batch_no} onChange={(e) => update("batch_no", e.target.value)} /></Field>
                <Field label="Current Status"><Input value={form.current_status} onChange={(e) => update("current_status", e.target.value)} /></Field>
                <Field label="Joined Candidate's Emp Code"><Input value={form.joined_candidate_emp_code} onChange={(e) => update("joined_candidate_emp_code", e.target.value)} /></Field>
                <Field label="Emp Referral Details"><Textarea value={form.emp_referral_details} onChange={(e) => update("emp_referral_details", e.target.value)} /></Field>
                <Field label="FInal Selection"><Select value={form.final_selection_flag} onChange={(e) => update("final_selection_flag", e.target.value)}><option value="0">No</option><option value="1">Yes</option></Select></Field>
                <Field label="Joined"><Select value={form.joined_flag} onChange={(e) => update("joined_flag", e.target.value)}><option value="0">No</option><option value="1">Yes</option></Select></Field>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <Button icon={busyAction === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} onClick={() => void submit("save")} disabled={!!busyAction}>Save</Button>
              <Button icon={busyAction === "candidate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} onClick={() => void submit("candidate")} disabled={!!busyAction}>Save & Create Candidate</Button>
              <Button icon={busyAction === "token" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />} onClick={() => void submit("token")} disabled={!!busyAction}>Save & Generate Walk-in Token</Button>
              <Button icon={busyAction === "onboarding" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} onClick={() => void submit("onboarding")} disabled={!!busyAction}>Save & Send to Onboarding</Button>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><FileUp className="h-4 w-4" /> Import Sheet</div>
              <div className="space-y-3">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
                <Select value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value)}>
                  <option value="insert_duplicates_with_warning">Insert duplicates with warning</option>
                  <option value="update_existing">Update existing</option>
                  <option value="skip_duplicates">Skip duplicates</option>
                </Select>
                <Button icon={busyAction === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} onClick={() => void uploadImport()} disabled={!!busyAction}>Upload & Import</Button>
                {importResult && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="font-bold text-slate-900">Batch {importResult.batchId}</div>
                    <div className="mt-1 text-slate-600">Rows: {importResult.totalRows} | Inserted: {importResult.insertedRows} | Updated: {importResult.updatedRows} | Duplicates: {importResult.duplicateRows} | Failed: {importResult.failedRows}</div>
                    {importResult.errors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {importResult.errors.slice(0, 4).map((err) => (
                          <div key={`${err.row_number}-${err.error_message}`} className="text-xs text-rose-700">Row {err.row_number}: {err.error_message}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Users className="h-4 w-4" /> Recent Rows</div>
              {loading ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading rows...</div>
              ) : !rows.length ? (
                <div className="py-8 text-center text-sm text-slate-500">No hiring activity yet.</div>
              ) : (
                <div className="space-y-3">
                  {rows.slice(0, 8).map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-950">{row.candidate_name || row.full_name || "Candidate"}</div>
                          <div className="text-xs text-slate-500">{row.process_name} | {row.recruiter_name_snapshot}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <div>{row.activity_date}</div>
                          <div>{row.current_status || row.joining_status || "Open"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
