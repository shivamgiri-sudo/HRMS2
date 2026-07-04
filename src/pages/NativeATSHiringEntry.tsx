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

type DashboardPayload = {
  metrics: Record<string, number>;
};

type HiringContext = {
  mobile: string;
  latestActivity?: HiringActivityRow | null;
  candidate?: Record<string, any> | null;
  latestSubmission?: Record<string, any> | null;
  onboarding?: Record<string, any> | null;
  suggestions?: {
    alreadySelected?: boolean;
    alreadyOnboarded?: boolean;
    alreadyRostered?: boolean;
    suggestedStatus?: string | null;
  };
} | null;

const statusOptions = [
  "Fresh Lead",
  "Callback Pending",
  "Confirmed for Interview",
  "Turned Up",
  "Interview In Progress",
  "Selected",
  "Onboarding In Progress",
  "Rostered",
] as const;

const reasonOptions = [
  "No answer",
  "Switched off",
  "Wrong number",
  "Location issue",
  "Salary mismatch",
  "Candidate not interested",
  "Callback requested",
  "Duplicate lead",
] as const;

const interviewDecisionOptions = ["Pending", "Selected", "Rejected", "Hold"] as const;

const sourceOptions = [
  "Employee Referral",
  "Walk-In",
  "Job Portal",
  "Social Media",
  "Campus",
  "Consultant",
] as const;

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

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
        {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

function Input(props: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return <input {...props} className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 ${props.className ?? ""}`} />;
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { className?: string }) {
  return <select {...props} className={`h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 ${props.className ?? ""}`} />;
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400" />;
}

function Button({ icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      {...props}
      className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
        props.disabled ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-950 text-white hover:bg-slate-800"
      } ${props.className ?? ""}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function MetricCard({ label, value, tone, foot }: { label: string; value: string | number; tone: string; foot: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.18em]">{label}</div>
      <div className="mt-3 text-3xl font-black tracking-tight">{value}</div>
      <div className="mt-2 text-xs font-medium opacity-80">{foot}</div>
    </div>
  );
}

function monthLabelFromDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(/\s+/g, "-");
}

function normalizeMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function formatMobile(value: string): string {
  const digits = normalizeMobile(value);
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function getQuickValidationIssues(form: typeof emptyForm): string[] {
  const issues: string[] = [];
  if (!form.activity_date) issues.push("Date");
  if (!form.hiring_source.trim()) issues.push("Hiring Source");
  if (!form.position_name.trim()) issues.push("Position");
  if (!form.location_name.trim()) issues.push("Location");
  if (!form.process_name.trim()) issues.push("Process");
  if (!form.candidate_name.trim()) issues.push("Candidate Name");
  if (normalizeMobile(form.mobile).length !== 10) issues.push("Valid Mobile");

  if (form.contacted_flag === "0" && !form.recruiter_rejection_reason.trim()) {
    issues.push("No-contact reason");
  }

  if ((form.current_status === "Callback Pending" || form.current_status === "Confirmed for Interview") && !form.pi_hr_interviewer_date) {
    issues.push(form.current_status === "Callback Pending" ? "Callback date" : "Expected interview date");
  }

  if (form.hr_interview_status === "Rejected" && !form.hr_rejection_reason.trim()) {
    issues.push("HR rejection reason");
  }

  if (form.ops_interview_status === "Rejected" && !form.ops_rejection_reason.trim()) {
    issues.push("Ops rejection reason");
  }

  if ((form.final_selection_flag === "1" || form.joined_flag === "1" || form.current_status === "Rostered") && !form.joined_candidate_emp_code.trim()) {
    issues.push("Employee code");
  }

  if (form.hiring_source === "Employee Referral" && !form.emp_referral_details.trim()) {
    issues.push("Referral details");
  }

  if (/issued|sent|offer/i.test(form.offer_letter_status) && !form.salary_package_inr.trim()) {
    issues.push("Salary package");
  }

  return issues;
}

function withFallback(current: string, fallback: unknown) {
  return current.trim() ? current : String(fallback ?? "").trim();
}

export default function NativeATSHiringEntry() {
  const [form, setForm] = useState({ ...emptyForm });
  const [rows, setRows] = useState<HiringActivityRow[]>([]);
  const [insights, setInsights] = useState<DashboardPayload | null>(null);
  const [context, setContext] = useState<HiringContext>(null);
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<"" | "save" | "candidate" | "token" | "onboarding" | "import">("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [duplicateMode, setDuplicateMode] = useState("insert_duplicates_with_warning");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [opsQuery, setOpsQuery] = useState("");
  const [opsSearch, setOpsSearch] = useState<Interviewer[]>([]);
  const validationIssues = useMemo(() => getQuickValidationIssues(form), [form]);
  const canSubmit = validationIssues.length === 0;
  const normalizedMobile = useMemo(() => normalizeMobile(form.mobile), [form.mobile]);
  const isCalling = useMemo(() => window.location.pathname.includes("/calling-entry"), []);

  const showInterviewSection = form.walkin_flag === "1" || !!form.hr_interview_status || !!form.ai_interview_result || !!form.ops_interview_status;
  const showOfferSection = form.final_selection_flag === "1" || form.joined_flag === "1" || ["Selected", "Onboarding In Progress", "Rostered"].includes(form.current_status);

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

  const loadInsights = async () => {
    try {
      const path = isCalling ? "/api/ats/recruiter/calling-dashboard" : "/api/ats/recruiter/hiring-dashboard";
      const res = await hrmsApi.get<{ success: boolean; data: DashboardPayload }>(path);
      setInsights(res.data ?? null);
    } catch {
      setInsights(null);
    }
  };

  useEffect(() => {
    void Promise.all([loadRows(), loadInsights()]);
  }, []);

  useEffect(() => {
    const term = opsQuery.trim();
    if (!term || !showInterviewSection) {
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
  }, [opsQuery, form.branch_name, form.location_name, showInterviewSection]);

  useEffect(() => {
    if (normalizedMobile.length !== 10) {
      setContext(null);
      return;
    }
    const t = setTimeout(async () => {
      setContextLoading(true);
      try {
        const res = await hrmsApi.get<{ success: boolean; data: HiringContext }>(
          `/api/ats/recruiter/hiring-activity/context?mobile=${encodeURIComponent(normalizedMobile)}`
        );
        setContext(res.data ?? null);
      } catch {
        setContext(null);
      } finally {
        setContextLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [normalizedMobile]);

  const update = (key: keyof typeof emptyForm, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: key === "mobile" ? normalizeMobile(value) : value };

      if (key === "activity_date" && !next.activity_month) {
        next.activity_month = monthLabelFromDate(value);
      }

      if (key === "location_name" && !prev.branch_name.trim()) {
        next.branch_name = value;
      }

      if (key === "contacted_flag") {
        if (value === "0") {
          next.walkin_flag = "0";
          if (!next.current_status || next.current_status === "Fresh Lead") {
            next.current_status = "Callback Pending";
          }
        } else if (!next.current_status) {
          next.current_status = "Confirmed for Interview";
        }
      }

      if (key === "current_status") {
        if (value === "Callback Pending" || value === "Confirmed for Interview") {
          next.contacted_flag = "1";
        }
        if (value === "Turned Up" || value === "Interview In Progress") {
          next.contacted_flag = "1";
          next.walkin_flag = "1";
        }
        if (value === "Selected" || value === "Onboarding In Progress") {
          next.contacted_flag = "1";
          next.walkin_flag = "1";
          next.final_selection_flag = "1";
        }
        if (value === "Rostered") {
          next.contacted_flag = "1";
          next.walkin_flag = "1";
          next.final_selection_flag = "1";
          next.joined_flag = "1";
        }
      }

      if (key === "walkin_flag" && value === "1") {
        next.contacted_flag = "1";
        if (!next.current_status || next.current_status === "Fresh Lead" || next.current_status === "Confirmed for Interview") {
          next.current_status = "Turned Up";
        }
      }

      if (key === "final_selection_flag" && value === "1" && next.current_status !== "Rostered") {
        next.current_status = "Selected";
      }

      if (key === "joined_flag" && value === "1") {
        next.current_status = "Rostered";
        next.contacted_flag = "1";
        next.walkin_flag = "1";
        next.final_selection_flag = "1";
      }

      if (key === "hiring_source" && value !== "Employee Referral") {
        next.emp_referral_details = "";
        next.referee_employee_id = "";
        next.referee_employee_code = "";
        next.referee_name = "";
      }

      return next;
    });
  };

  const applyContextReuse = () => {
    if (!context?.latestActivity) return;
    const activity = context.latestActivity ?? {};
    const candidate = context.candidate ?? {};
    const submission = context.latestSubmission ?? {};
    const onboarding = context.onboarding ?? {};

    setForm((prev) => ({
      ...prev,
      recruiter_name_snapshot: withFallback(prev.recruiter_name_snapshot, activity.recruiter_name_snapshot),
      recruiter_id: withFallback(prev.recruiter_id, activity.recruiter_id),
      recruiter_employee_id: withFallback(prev.recruiter_employee_id, activity.recruiter_employee_id),
      recruiter_code: withFallback(prev.recruiter_code, activity.recruiter_code),
      hiring_source: withFallback(prev.hiring_source, activity.hiring_source),
      position_name: withFallback(prev.position_name, activity.position_name),
      location_name: withFallback(prev.location_name, activity.location_name),
      branch_name: withFallback(prev.branch_name, activity.branch_name),
      process_name: withFallback(prev.process_name, activity.process_name ?? candidate.applied_for_process),
      candidate_name: withFallback(prev.candidate_name, activity.candidate_name ?? candidate.full_name),
      candidate_email: withFallback(prev.candidate_email, activity.candidate_email ?? candidate.email),
      education_qualification: withFallback(prev.education_qualification, activity.education_qualification),
      experience_level: withFallback(prev.experience_level, activity.experience_level),
      candidate_location: withFallback(prev.candidate_location, activity.candidate_location),
      current_status: withFallback(prev.current_status, context.suggestions?.suggestedStatus ?? activity.current_status),
      recruiter_remarks: withFallback(prev.recruiter_remarks, activity.recruiter_remarks),
      recruiter_rejection_reason: withFallback(prev.recruiter_rejection_reason, activity.recruiter_rejection_reason),
      pi_hr_interviewer_date: withFallback(prev.pi_hr_interviewer_date, activity.pi_hr_interviewer_date),
      pi_hr_interviewer_name: withFallback(prev.pi_hr_interviewer_name, activity.pi_hr_interviewer_name),
      hr_interview_status: withFallback(prev.hr_interview_status, activity.hr_interview_status),
      ai_interview_result: withFallback(prev.ai_interview_result, activity.ai_interview_result),
      ops_interviewer_employee_id: withFallback(prev.ops_interviewer_employee_id, activity.ops_interviewer_employee_id),
      ops_interviewer_name: withFallback(prev.ops_interviewer_name, activity.ops_interviewer_name ?? submission.second_round_interviewer_name_snapshot),
      ops_interviewer_branch_snapshot: withFallback(prev.ops_interviewer_branch_snapshot, activity.ops_interviewer_branch_snapshot),
      ops_interview_status: withFallback(prev.ops_interview_status, activity.ops_interview_status ?? submission.round2_result),
      salary_package_inr: withFallback(prev.salary_package_inr, activity.salary_package_inr),
      offer_letter_status: withFallback(prev.offer_letter_status, activity.offer_letter_status),
      joining_status: withFallback(prev.joining_status, activity.joining_status ?? onboarding.status),
      joined_candidate_emp_code: withFallback(prev.joined_candidate_emp_code, activity.joined_candidate_emp_code),
      emp_referral_details: withFallback(prev.emp_referral_details, activity.emp_referral_details),
      referee_employee_code: withFallback(prev.referee_employee_code, activity.referee_employee_code),
      referee_name: withFallback(prev.referee_name, activity.referee_name),
      contacted_flag: prev.contacted_flag === "0" && activity.contacted_flag === 1 ? "1" : prev.contacted_flag,
      walkin_flag: prev.walkin_flag === "0" && activity.walkin_flag === 1 ? "1" : prev.walkin_flag,
      final_selection_flag: prev.final_selection_flag === "0" && Number(activity.final_selection_flag ?? 0) === 1 ? "1" : prev.final_selection_flag,
      joined_flag: prev.joined_flag === "0" && (Number(activity.joined_flag ?? 0) === 1 || context.suggestions?.alreadyRostered) ? "1" : prev.joined_flag,
    }));
    setMessage("Previous candidate context reused to save typing.");
  };

  const reset = () => {
    setForm({ ...emptyForm, activity_date: new Date().toISOString().slice(0, 10) });
    setMessage("");
    setImportResult(null);
    setImportFile(null);
    setOpsQuery("");
    setOpsSearch([]);
    setContext(null);
  };

  const submit = async (nextAction: "save" | "candidate" | "token" | "onboarding") => {
    if (!canSubmit) {
      setMessage(`Add the missing core fields first: ${validationIssues.slice(0, 5).join(", ")}${validationIssues.length > 5 ? "..." : ""}`);
      return;
    }

    setBusyAction(nextAction);
    setMessage("");
    try {
      const payload = {
        ...form,
        mobile: normalizedMobile,
        activity_month: form.activity_month || monthLabelFromDate(form.activity_date),
        source_system: "HRMS",
      };

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

      setMessage(nextAction === "save" ? "Calling entry saved." : "Entry saved and next action completed.");
      await Promise.all([loadRows(), loadInsights()]);
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
      await Promise.all([loadRows(), loadInsights()]);
    } catch (err: any) {
      setMessage(err.message || "Import failed");
    } finally {
      setBusyAction("");
    }
  };

  const metrics = insights?.metrics ?? {};
  const calledCount = Number(metrics.total_records ?? 0);
  const contactedCount = Number(metrics.total_contacted ?? 0);
  const confirmedCount = Number(metrics.confirmed_for_interview ?? 0);
  const turnedUpCount = Number(metrics.turned_up ?? 0);
  const selectedCount = Number(metrics.final_selected ?? 0);
  const onboardedCount = Number(metrics.onboarded ?? 0);
  const rosteredCount = Number(metrics.rostered ?? 0);
  const turnupRate = confirmedCount ? Math.round((turnedUpCount / confirmedCount) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(135deg,_#fff_0%,_#f8fafc_55%,_#eef6ff_100%)] p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-sky-700">{isCalling ? "Calling Entry" : "Recruiter Hiring Entry"}</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{isCalling ? "Calling-first Recruiter Desk" : "Recruiter Hiring Funnel"}</h1>
              <p className="mt-2 max-w-4xl text-sm text-slate-600">
                Start at calling, reuse one mobile-based record through interview, selection, onboarding, and rostering. The form below is tuned for fast recruiter entry instead of sheet-style retyping.
              </p>
            </div>
            <div className="flex gap-2">
              <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => void Promise.all([loadRows(), loadInsights()])} type="button">Refresh</Button>
              <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={reset} type="button" className="bg-slate-100 text-slate-900 hover:bg-slate-200">Clear Form</Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Leads Added" value={calledCount} foot="Calling sheet entries created" tone="border-sky-200 bg-sky-50 text-sky-900" />
            <MetricCard label="Contacted" value={contactedCount} foot={`${metrics.contacted_pct ?? 0}% connect rate`} tone="border-emerald-200 bg-emerald-50 text-emerald-900" />
            <MetricCard label="Confirmed" value={confirmedCount} foot="Promised they will come" tone="border-cyan-200 bg-cyan-50 text-cyan-900" />
            <MetricCard label="Turned Up" value={turnedUpCount} foot={`${turnupRate}% of confirmed leads`} tone="border-violet-200 bg-violet-50 text-violet-900" />
            <MetricCard label="Selected" value={selectedCount} foot="Moved to selected pipeline" tone="border-amber-200 bg-amber-50 text-amber-900" />
            <MetricCard label="Onboarded / Rostered" value={`${onboardedCount} / ${rosteredCount}`} foot="Onboarding completed vs employee-ready" tone="border-rose-200 bg-rose-50 text-rose-900" />
          </div>
        </div>

        {message ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">{message}</div> : null}

        {!canSubmit ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Smart validation is holding just the missing essentials: <span className="font-bold">{validationIssues.slice(0, 6).join(", ")}</span>
            {validationIssues.length > 6 ? "..." : ""}
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
            Entry is clean. You can save it now, or jump directly into candidate creation, token generation, or onboarding.
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.28fr_0.72fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                <Users className="h-4 w-4" />
                Calling Starter
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Date"><Input type="date" value={form.activity_date} onChange={(e) => update("activity_date", e.target.value)} required /></Field>
                <Field label="Month" hint="Auto-fills from date"><Input value={form.activity_month} onChange={(e) => update("activity_month", e.target.value)} placeholder={monthLabelFromDate(form.activity_date) || "Apr-25"} /></Field>
                <Field label="Hiring Source">
                  <Select value={form.hiring_source} onChange={(e) => update("hiring_source", e.target.value)} required>
                    <option value="">Select source</option>
                    {sourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </Select>
                </Field>
                <Field label="Position"><Input value={form.position_name} onChange={(e) => update("position_name", e.target.value)} placeholder="Telecaller / Sales / Ops" required /></Field>
                <Field label="Location"><Input value={form.location_name} onChange={(e) => update("location_name", e.target.value)} placeholder="Recruitment branch or site" required /></Field>
                <Field label="Branch"><Input value={form.branch_name} onChange={(e) => update("branch_name", e.target.value)} placeholder="Auto-filled from location if left blank" /></Field>
                <Field label="Process Name"><Input value={form.process_name} onChange={(e) => update("process_name", e.target.value)} placeholder="Onfido / BBB / GS1" required /></Field>
                <Field label="HR Recruiter"><Input value={form.recruiter_name_snapshot} onChange={(e) => update("recruiter_name_snapshot", e.target.value)} placeholder="Optional snapshot if you want to store it" /></Field>
                <Field label="WP Groups"><Input value={form.wp_group} onChange={(e) => update("wp_group", e.target.value)} placeholder="Optional campaign / group" /></Field>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                <UserPlus className="h-4 w-4" />
                Candidate Identity
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Candidate Name"><Input value={form.candidate_name} onChange={(e) => update("candidate_name", e.target.value)} required /></Field>
                <Field label="Mobile No." hint={normalizedMobile.length === 10 ? formatMobile(normalizedMobile) : "10 digits"}>
                  <Input value={form.mobile} onChange={(e) => update("mobile", e.target.value)} inputMode="numeric" placeholder="9876543210" required />
                </Field>
                <Field label="Candidate Email"><Input value={form.candidate_email} onChange={(e) => update("candidate_email", e.target.value)} /></Field>
                <Field label="Gender"><Input value={form.gender} onChange={(e) => update("gender", e.target.value)} /></Field>
                <Field label="Education"><Input value={form.education_qualification} onChange={(e) => update("education_qualification", e.target.value)} placeholder="Graduate / 12th / Diploma" /></Field>
                <Field label="Experience"><Input value={form.experience_level} onChange={(e) => update("experience_level", e.target.value)} placeholder="Fresher / 1 year / 3 years" /></Field>
                <Field label="Candidate Location"><Input value={form.candidate_location} onChange={(e) => update("candidate_location", e.target.value)} /></Field>
              </div>

              {contextLoading ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Checking whether this mobile already has recruiter context...</div>
              ) : context?.latestActivity ? (
                <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">Previous recruiter trail found for {context.mobile}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Last status: <span className="font-semibold">{context.suggestions?.suggestedStatus || context.latestActivity.current_status || "Open"}</span>
                        {" | "}
                        Last process: <span className="font-semibold">{context.latestActivity.process_name || context.candidate?.applied_for_process || "-"}</span>
                        {" | "}
                        Candidate: <span className="font-semibold">{context.candidate?.candidate_code || "not created yet"}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        Selected: {context.suggestions?.alreadySelected ? "Yes" : "No"} | Onboarded: {context.suggestions?.alreadyOnboarded ? "Yes" : "No"} | Rostered: {context.suggestions?.alreadyRostered ? "Yes" : "No"}
                      </div>
                    </div>
                    <Button type="button" className="bg-blue-700 hover:bg-blue-800" onClick={applyContextReuse}>Reuse Previous Details</Button>
                  </div>
                </div>
              ) : normalizedMobile.length === 10 ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">No previous recruiter record was found for this mobile, so this entry will start fresh.</div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                <Bot className="h-4 w-4" />
                Calling Outcome
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Contacted">
                  <Select value={form.contacted_flag} onChange={(e) => update("contacted_flag", e.target.value)}>
                    <option value="0">No</option>
                    <option value="1">Yes</option>
                  </Select>
                </Field>
                <Field label="Current Status">
                  <Select value={form.current_status} onChange={(e) => update("current_status", e.target.value)}>
                    <option value="">Select stage</option>
                    {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </Select>
                </Field>
                <Field label={form.contacted_flag === "0" ? "No-contact reason" : "Calling reason / exception"}>
                  <Select value={form.recruiter_rejection_reason} onChange={(e) => update("recruiter_rejection_reason", e.target.value)}>
                    <option value="">Select reason</option>
                    {reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </Select>
                </Field>
                <Field label="Expected Interview Date" hint="Required for callback or confirmed">
                  <Input type="date" value={form.pi_hr_interviewer_date} onChange={(e) => update("pi_hr_interviewer_date", e.target.value)} />
                </Field>
                <Field label="Turned Up for Interview">
                  <Select value={form.walkin_flag} onChange={(e) => update("walkin_flag", e.target.value)}>
                    <option value="0">No</option>
                    <option value="1">Yes</option>
                  </Select>
                </Field>
                <Field label="Calling Notes">
                  <Input value={form.recruiter_remarks} onChange={(e) => update("recruiter_remarks", e.target.value)} placeholder="Quick note for the next recruiter action" />
                </Field>
              </div>
            </section>

            {showInterviewSection ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                  <Ticket className="h-4 w-4" />
                  Interview Follow-through
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="PI_HR Interviewer"><Input value={form.pi_hr_interviewer_name} onChange={(e) => update("pi_hr_interviewer_name", e.target.value)} placeholder="Recruiter or first interviewer" /></Field>
                  <Field label="HR Interview Status">
                    <Select value={form.hr_interview_status} onChange={(e) => update("hr_interview_status", e.target.value)}>
                      <option value="">Select</option>
                      {interviewDecisionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </Select>
                  </Field>
                  <Field label="HR Rejection Reason"><Input value={form.hr_rejection_reason} onChange={(e) => update("hr_rejection_reason", e.target.value)} /></Field>
                  <Field label="AI Assessment Score"><Input value={form.ai_assessment_score} onChange={(e) => update("ai_assessment_score", e.target.value)} /></Field>
                  <Field label="AI Interview Result"><Input value={form.ai_interview_result} onChange={(e) => update("ai_interview_result", e.target.value)} placeholder="Pass / Fail / Pending" /></Field>
                  <Field label="Ops Interview Status">
                    <Select value={form.ops_interview_status} onChange={(e) => update("ops_interview_status", e.target.value)}>
                      <option value="">Select</option>
                      {interviewDecisionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </Select>
                  </Field>
                  <Field label="Ops Interviewer" hint="Search branch employee + code">
                    <Input
                      value={form.ops_interviewer_name}
                      onChange={(e) => {
                        update("ops_interviewer_name", e.target.value);
                        setOpsQuery(e.target.value);
                      }}
                      placeholder="Type employee name"
                    />
                  </Field>
                  <Field label="Ops Interviewer Branch"><Input value={form.ops_interviewer_branch_snapshot} onChange={(e) => update("ops_interviewer_branch_snapshot", e.target.value)} /></Field>
                  <Field label="Ops Rejection Reason"><Input value={form.ops_rejection_reason} onChange={(e) => update("ops_rejection_reason", e.target.value)} /></Field>
                </div>

                {opsSearch.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Branch employee matches</div>
                    <div className="space-y-2">
                      {opsSearch.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:bg-slate-50"
                          onClick={() => {
                            update("ops_interviewer_employee_id", item.id);
                            update("ops_interviewer_name", `${item.name || ""}${item.employee_code ? ` (${item.employee_code})` : ""}`.trim());
                            update("ops_interviewer_branch_snapshot", item.branch_name || form.branch_name);
                            setOpsSearch([]);
                          }}
                        >
                          <span className="font-semibold text-slate-900">{item.name || item.employee_code}</span>
                          <span className="text-xs text-slate-500">{item.employee_code || ""}{item.branch_name ? ` · ${item.branch_name}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {showOfferSection ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                  <Send className="h-4 w-4" />
                  Offer, Onboarding & Referral
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="Final Selection">
                    <Select value={form.final_selection_flag} onChange={(e) => update("final_selection_flag", e.target.value)}>
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </Select>
                  </Field>
                  <Field label="Offer Letter"><Input value={form.offer_letter_status} onChange={(e) => update("offer_letter_status", e.target.value)} placeholder="Issued / Shared / Pending" /></Field>
                  <Field label="Salary Package"><Input value={form.salary_package_inr} onChange={(e) => update("salary_package_inr", e.target.value)} placeholder="4,20,000" /></Field>
                  <Field label="Joining Status"><Input value={form.joining_status} onChange={(e) => update("joining_status", e.target.value)} placeholder="Onboarding Complete / Pending" /></Field>
                  <Field label="Batch No."><Input value={form.batch_no} onChange={(e) => update("batch_no", e.target.value)} /></Field>
                  <Field label="Employee Code"><Input value={form.joined_candidate_emp_code} onChange={(e) => update("joined_candidate_emp_code", e.target.value)} placeholder="Required when rostered" /></Field>
                  <Field label="Rostered">
                    <Select value={form.joined_flag} onChange={(e) => update("joined_flag", e.target.value)}>
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </Select>
                  </Field>
                  <Field label="Referral Details" hint={form.hiring_source === "Employee Referral" ? "Required for referral source" : "Optional"}>
                    <Textarea value={form.emp_referral_details} onChange={(e) => update("emp_referral_details", e.target.value)} />
                  </Field>
                </div>
              </section>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button icon={busyAction === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} onClick={() => void submit("save")} disabled={!!busyAction || !canSubmit}>Save Lead</Button>
              <Button icon={busyAction === "candidate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} onClick={() => void submit("candidate")} disabled={!!busyAction || !canSubmit}>Save + Create Candidate</Button>
              <Button icon={busyAction === "token" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />} onClick={() => void submit("token")} disabled={!!busyAction || !canSubmit}>Save + Generate Token</Button>
              <Button icon={busyAction === "onboarding" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} onClick={() => void submit("onboarding")} disabled={!!busyAction || !canSubmit}>Save + Send Onboarding</Button>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                <FileUp className="h-4 w-4" />
                Sheet Import
              </div>
              <div className="space-y-3">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
                <Select value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value)}>
                  <option value="insert_duplicates_with_warning">Insert duplicates with warning</option>
                  <option value="update_existing">Update existing</option>
                  <option value="skip_duplicates">Skip duplicates</option>
                </Select>
                <Button icon={busyAction === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} onClick={() => void uploadImport()} disabled={!!busyAction}>Upload & Import</Button>
                {importResult ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="font-bold text-slate-900">Batch {importResult.batchId}</div>
                    <div className="mt-1 text-slate-600">
                      Rows: {importResult.totalRows} | Inserted: {importResult.insertedRows} | Updated: {importResult.updatedRows} | Duplicates: {importResult.duplicateRows} | Failed: {importResult.failedRows}
                    </div>
                    {importResult.errors.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {importResult.errors.slice(0, 4).map((err) => (
                          <div key={`${err.row_number}-${err.error_message}`} className="text-xs text-rose-700">
                            Row {err.row_number}: {err.error_message}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                <Users className="h-4 w-4" />
                Funnel Readout
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Calling Conversion</div>
                  <div className="mt-2 text-sm text-slate-700">
                    Called <span className="font-black text-slate-900">{calledCount}</span> {"->"} Contacted <span className="font-black text-slate-900">{contactedCount}</span> {"->"} Confirmed <span className="font-black text-slate-900">{confirmedCount}</span> {"->"} Turned Up <span className="font-black text-slate-900">{turnedUpCount}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Hiring Conversion</div>
                  <div className="mt-2 text-sm text-slate-700">
                    Interviewed <span className="font-black text-slate-900">{metrics.interviewed ?? 0}</span> {"->"} Selected <span className="font-black text-slate-900">{selectedCount}</span> {"->"} Onboarded <span className="font-black text-slate-900">{onboardedCount}</span> {"->"} Rostered <span className="font-black text-slate-900">{rosteredCount}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
                  Callback Pending: <span className="font-black text-slate-900">{metrics.callback_pending ?? 0}</span>
                  {" | "}
                  Not Contacted: <span className="font-black text-slate-900">{metrics.not_contacted ?? 0}</span>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                <Users className="h-4 w-4" />
                Recent Rows
              </div>
              {loading ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading rows...</div>
              ) : !rows.length ? (
                <div className="py-8 text-center text-sm text-slate-500">No hiring activity yet.</div>
              ) : (
                <div className="space-y-3">
                  {rows.slice(0, 8).map((row) => (
                    <div key={row.id} className="rounded-2xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-950">{row.candidate_name || row.full_name || "Candidate"}</div>
                          <div className="text-xs text-slate-500">{row.process_name} | {row.recruiter_name_snapshot || "Recruiter snapshot missing"}</div>
                          <div className="mt-2 text-xs text-slate-500">{formatMobile(String(row.mobile || ""))}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <div>{row.activity_date}</div>
                          <div className="mt-2 rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-700">{row.current_status || row.joining_status || "Open"}</div>
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
