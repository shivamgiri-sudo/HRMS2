import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, FileText, Loader2, RefreshCw, Search, ShieldCheck, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { SecureDocumentList } from "@/components/documents/SecureDocumentList";
import { OnboardingTabBar } from "@/components/onboarding/OnboardingTabBar";
import { AddressBgvPanel } from "@/components/bgv/AddressBgvPanel";
import { INDIA_STATES } from "@/data/indiaStatesCities";

type QueueRow = {
  candidate_id: string;
  candidate_code?: string;
  full_name: string;
  mobile?: string;
  email?: string;
  applied_for_branch?: string;
  applied_for_process?: string;
  onboarding_status?: string;
  bgv_status?: string;
  payroll_status?: string;
  jclr_status?: string;
  jclr_approval_status?: string;
  statutory_status?: string;
  dpdp_required_status?: string;
  employee_code?: string;
  aging_days?: number;
  readiness_status: string;
  next_action: string;
  blockers: string[];
};

type OfferData = {
  emp_type?: string;
  date_of_joining?: string;
  date_of_salary?: string;
  department_name?: string;
  designation_name?: string;
  cost_centre_name?: string;
  manager_name?: string;
  salary_band?: string;
  gross?: number;
  basic?: number;
  hra?: number;
  conveyance?: number;
  special_allowance?: number;
  pf_employee?: number;
  pf_employer?: number;
  esic_employee?: number;
  esic_employer?: number;
  net_in_hand?: number;
  status?: string;
};

type ProvisioningTask = {
  task_code: string;
  task_label: string;
  assigned_role: string;
  status: string;
  assigned_to_name?: string;
  completed_at?: string;
  sla_due?: string;
};

/**
 * What the candidate themselves filled in on the onboarding portal.
 *
 * The backend has always returned this block — profile, bank, qualifications and
 * experience, all four queried in `getJoiningControlRoomCandidate` — and this page
 * threw every field away: `onboarding` was typed `any` and referenced nowhere in the
 * JSX. So HR looked at a Joining Control Room that knew the candidate's date of birth,
 * father's name, PAN, address, bank and UAN, and displayed none of it, while the
 * Statutory tab sat empty waiting for someone to retype half of it by hand.
 */
type OnboardingProfile = Record<string, any> | null;

type OnboardingBlock = {
  profile: OnboardingProfile;
  bank: Record<string, any> | null;
  qualifications: Record<string, any>[];
  experience: Record<string, any>[];
};

type EsignDocument = {
  document_code: string;
  document_name: string;
  owner_type?: string | null;
  action_type?: string | null;
  status?: string | null;
  bucket: "completed" | "in_progress" | "not_started";
  fill_status?: string | null;
  signature_mode?: string | null;
  mandatory: boolean;
  due_at?: string | null;
  completed_at?: string | null;
  verification_status?: string | null;
  employee_review_status?: string | null;
  hr_remarks?: string | null;
  updated_at?: string | null;
};

type EsignBlock = {
  documents: EsignDocument[];
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
  signable_total: number;
  signable_completed: number;
  kit_status?: string | null;
  kit_completion_pct?: string | number | null;
  kit_completed_at?: string | null;
  digilocker_status?: string | null;
  penny_drop_status?: string | null;
};

type Detail = {
  summary: QueueRow;
  onboarding: OnboardingBlock;
  offer?: OfferData;
  payroll: any;
  salaryProposal: any;
  salarySteps: any[];
  jclr: any;
  statutory: any;
  dpdp: any[];
  withdrawals: any[];
  esign?: EsignBlock;
  employee: any;
  provisioningTasks?: ProvisioningTask[];
};

const blankJclr = {
  joining_location: "",
  joining_floor: "",
  work_station: "",
  system_required: true,
  headset_required: false,
  id_card_required: true,
  training_batch: "",
  trainer_name: "",
  induction_slot: "",
  transport_required: false,
  transport_route: "",
  joining_coordinator_id: "",
  jclr_status: "pending",
  blocker_reason: "",
  remarks: "",
};

const blankStatutory = {
  epf_member: "unknown",
  uan: "",
  pf_applicable: true,
  esi_applicable: false,
  professional_tax_state: "",
  nominee_name: "",
  nominee_relationship: "",
  nominee_dob: "",
  declaration_status: "pending",
  rejection_reason: "",
  remarks: "",
};

const blankDates = {
  salary_start_date: "",
  attendance_effective_from: "",
  statutory_effective_from: "",
  payroll_month_effective: "",
  salary_effective_date_reason: "",
  joining_remarks: "",
};

/**
 * Nominee relationships actually present in `candidate_onboarding_profile` — Father 8,503,
 * Mother 4,091, Brother 2,730, Sister 1,198, Wife 703, Husband 604, Son 88, Daughter 72,
 * Spouse 8. Built from the observed domain rather than invented, per the Form Input Rule,
 * and kept in the same order so the common picks sit at the top of the list.
 */
const NOMINEE_RELATIONSHIPS = ["Father", "Mother", "Brother", "Sister", "Wife", "Husband", "Son", "Daughter", "Spouse"];

const EPF_MEMBER_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "yes", label: "Yes — previously an EPF member" },
  { value: "no", label: "No — first-time member" },
];

const DECLARATION_STATUS_OPTIONS = ["pending", "submitted", "verified", "rejected"];

/** MySQL DATE/DATETIME arrives as an ISO string; `<input type="date">` wants `YYYY-MM-DD`. */
function toDateInput(value: unknown): string {
  if (!value) return "";
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : "";
}

function firstFilled(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

/**
 * Seed the Statutory form from what the candidate already submitted.
 *
 * `statutory_declaration` holds ZERO rows across the whole production database, so this
 * form opened blank for every candidate in the 34,430-row queue — and "EPF/statutory
 * declaration is not verified" is therefore a standing blocker on all of them. Meanwhile
 * `candidate_onboarding_profile` already carries the nominee for 20,016 candidates, plus
 * UAN, EPF/ESIC numbers and the previous-PF-member flag. HR was retyping data the
 * candidate had personally entered on the portal.
 *
 * Precedence is saved-row-first, candidate-second: a value HR has already reviewed and
 * stored always wins, and the candidate's answer only fills a field that is still blank.
 * Nothing is written to the database until HR presses Save Statutory, so this is a
 * suggestion on an empty form, never a silent overwrite of a verified declaration.
 */
function seedStatutoryForm(saved: any, profile: OnboardingProfile) {
  const row = saved || {};
  const p = profile || {};

  // `previous_pf_member` is a nullable tinyint. Only 0/1 answer the question — a NULL means
  // the candidate was never asked, which is 'unknown', not 'no'.
  const pfFlag = p.previous_pf_member;
  const epfFromProfile = pfFlag === null || pfFlag === undefined ? "" : Number(pfFlag) === 1 ? "yes" : "no";

  return {
    ...blankStatutory,
    ...row,
    epf_member: firstFilled(row.epf_member === "unknown" ? "" : row.epf_member, epfFromProfile) || "unknown",
    uan: firstFilled(row.uan, p.uan_number, p.epf_number),
    professional_tax_state: firstFilled(row.professional_tax_state, p.present_state, p.permanent_state),
    nominee_name: firstFilled(row.nominee_name, p.nominee_name),
    nominee_relationship: firstFilled(row.nominee_relationship, p.nominee_relation),
    nominee_dob: toDateInput(firstFilled(row.nominee_dob, p.nominee_date_of_birth)),
    // An ESIC number on the profile is positive evidence the candidate is covered. Its
    // absence proves nothing (coverage is a wage test), so it can only turn the flag on.
    esi_applicable: row.id ? Boolean(row.esi_applicable) : Boolean(firstFilled(p.esic_number)) || blankStatutory.esi_applicable,
    declaration_status: firstFilled(row.declaration_status) || "pending",
  };
}

/** True when the saved statutory row is absent, i.e. everything on screen is a suggestion. */
function isStatutoryUnsaved(saved: any): boolean {
  return !saved?.id;
}

function statusBadge(value?: string) {
  const status = value || "pending";
  const good = ["verified", "validated", "ready", "approved", "employee_created", "completed", "granted", "active"].includes(status);
  const bad = ["blocked", "rejected", "withdrawn", "failed", "overdue"].includes(status);
  return <Badge variant={good ? "default" : bad ? "destructive" : "outline"}>{status}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ form, setForm, name, type = "text", disabled = false }: { form: any; setForm: (next: any) => void; name: string; type?: string; disabled?: boolean }) {
  return <Input type={type} value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} disabled={disabled} />;
}

function Toggle({ form, setForm, name }: { form: any; setForm: (next: any) => void; name: string }) {
  return <input type="checkbox" className="h-4 w-4" checked={Boolean(form[name])} onChange={(event) => setForm({ ...form, [name]: event.target.checked })} />;
}

function ReadOnlyField({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="text-xs uppercase text-blue-500 tracking-wide font-semibold">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value ?? "-"}</div>
    </div>
  );
}

/**
 * A titled block of read-only candidate-supplied fields.
 *
 * Empty entries render as "—" rather than being dropped: on this screen a blank field is
 * itself the finding ("the candidate never gave us an ESIC number"), and hiding it would
 * make an incomplete profile look complete.
 */
function DetailSection({ title, note, fields }: { title: string; note?: string; fields: [string, unknown][] }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
            <div className="text-xs uppercase text-blue-500 tracking-wide font-semibold">{label}</div>
            <div className="mt-1 break-words font-semibold text-slate-900">{formatValue(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  if (!text) return "—";
  // Dates arrive as full ISO timestamps; nobody needs the time on a date of birth.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  return text;
}

/**
 * A "not provided" placeholder that names the screen the data should have come from,
 * so an empty tab is a next action rather than a dead end.
 */
function EmptySection({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{title}</div>
      <p>{hint}</p>
    </div>
  );
}

const ESIGN_BUCKET_STYLES: Record<EsignDocument["bucket"], string> = {
  completed: "border-emerald-200 bg-emerald-50",
  in_progress: "border-amber-200 bg-amber-50",
  not_started: "border-slate-200 bg-white",
};

function EsignDocumentRow({ doc }: { doc: EsignDocument }) {
  return (
    <div className={`rounded-xl border p-4 ${ESIGN_BUCKET_STYLES[doc.bucket]}`}>
      <div className="flex items-start gap-3">
        <div className={doc.bucket === "completed" ? "text-emerald-600" : doc.bucket === "in_progress" ? "text-amber-600" : "text-slate-400"}>
          {doc.bucket === "completed" ? <CheckCircle2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{doc.document_name}</span>
            {doc.mandatory && <Badge variant="outline" className="text-[10px]">Mandatory</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {statusBadge(doc.status || undefined)}
            <span className="text-slate-500">
              {doc.action_type === "esign" ? "E-sign" : doc.action_type === "upload" ? "Upload" : doc.action_type || "—"}
              {doc.owner_type ? ` · ${doc.owner_type}` : ""}
            </span>
          </div>
          {/* The signature mode is the part HR actually needs for an audit: an Aadhaar
              e-sign is legally different from a scanned wet signature. */}
          {doc.signature_mode && <div className="mt-1 text-xs text-emerald-700">Signed via {doc.signature_mode.replaceAll("_", " ")}</div>}
          {doc.completed_at && <div className="mt-1 text-xs text-slate-500">Completed {new Date(doc.completed_at).toLocaleString()}</div>}
          {!doc.completed_at && doc.due_at && <div className="mt-1 text-xs text-slate-500">Due {new Date(doc.due_at).toLocaleDateString()}</div>}
          {doc.hr_remarks && <div className="mt-1 text-xs text-slate-600">HR: {doc.hr_remarks}</div>}
        </div>
      </div>
    </div>
  );
}

function ProvisioningTaskCard({ task }: { task: ProvisioningTask }) {
  const icons: Record<string, React.ReactNode> = {
    ADMIN_BIOMETRIC_ID_CARD: <ShieldCheck className="h-5 w-5" />,
    APPOINTMENT_LETTER_ESIGN: <FileText className="h-5 w-5" />,
  };
  const isComplete = task.status === "completed";
  const isOverdue = task.sla_due && new Date(task.sla_due) < new Date() && !isComplete;

  return (
    <div className={`rounded-xl border p-4 ${isComplete ? "border-emerald-200 bg-emerald-50" : isOverdue ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <div className={isComplete ? "text-emerald-600" : isOverdue ? "text-amber-600" : "text-slate-400"}>
          {icons[task.task_code] || <ClipboardCheck className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <div className="font-semibold text-slate-900">{task.task_label}</div>
          <div className="mt-1 text-sm text-slate-600">
            {task.assigned_to_name ? `Assigned to: ${task.assigned_to_name}` : `Assigned role: ${task.assigned_role}`}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {statusBadge(isOverdue ? "overdue" : task.status)}
            {task.sla_due && <span className="text-xs text-slate-500">SLA: {new Date(task.sla_due).toLocaleDateString()}</span>}
          </div>
          {isComplete && task.completed_at && (
            <div className="mt-1 text-xs text-emerald-700">Completed: {new Date(task.completed_at).toLocaleString()}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NativeJoiningControlRoom() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dateForm, setDateForm] = useState<any>(blankDates);
  const [jclrForm, setJclrForm] = useState<any>(blankJclr);
  const [statutoryForm, setStatutoryForm] = useState<any>(blankStatutory);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => queue.find((row) => row.candidate_id === selectedId) || null, [queue, selectedId]);

  const loadQueue = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: QueueRow[] }>(`/api/ats/joining-control-room/queue?search=${encodeURIComponent(search)}`);
      setQueue(res.data || []);
      if (!selectedId && res.data?.[0]) setSelectedId(res.data[0].candidate_id);
    } catch (err: any) {
      setError(err.message || "Unable to load joining control room");
    } finally {
      setBusy(false);
    }
  };

  const loadDetail = async (candidateId: string) => {
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Detail }>(`/api/ats/joining-control-room/candidates/${candidateId}`);
      setDetail(res.data);
      setDateForm({
        ...blankDates,
        salary_start_date: res.data.offer?.date_of_salary || res.data.payroll?.salary_start_date || "",
        attendance_effective_from: res.data.payroll?.attendance_effective_from || "",
        statutory_effective_from: res.data.payroll?.statutory_effective_from || "",
        payroll_month_effective: res.data.payroll?.payroll_month_effective || "",
        salary_effective_date_reason: res.data.payroll?.salary_effective_date_reason || "",
        joining_remarks: res.data.payroll?.joining_remarks || "",
      });
      setJclrForm({ ...blankJclr, ...(res.data.jclr || {}) });
      setStatutoryForm(seedStatutoryForm(res.data.statutory, res.data.onboarding?.profile));
    } catch (err: any) {
      setError(err.message || "Unable to load candidate");
    }
  };

  useEffect(() => { loadQueue(); }, []);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  const saveDates = async () => {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await hrmsApi.put<{ success: boolean; data: Detail }>(`/api/ats/joining-control-room/candidates/${selectedId}/payroll`, dateForm);
      setDetail(res.data);
      setMessage("Effective dates saved");
      await loadQueue();
    } catch (err: any) {
      setError(err.message || "Unable to save dates");
    } finally {
      setBusy(false);
    }
  };

  const saveSection = async (section: "jclr" | "statutory", body: any) => {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await hrmsApi.put<{ success: boolean; data: Detail }>(`/api/ats/joining-control-room/candidates/${selectedId}/${section}`, body);
      setDetail(res.data);
      setMessage(`${section.toUpperCase()} saved`);
      await loadQueue();
    } catch (err: any) {
      setError(err.message || `Unable to save ${section}`);
    } finally {
      setBusy(false);
    }
  };

  const action = async (path: string, body: any = {}, ok = "Action completed") => {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await hrmsApi.post(`/api/ats/joining-control-room/candidates/${selectedId}/${path}`, body);
      setMessage(ok);
      await loadDetail(selectedId);
      await loadQueue();
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const offer = detail?.offer;
  const hasEmployeeCode = !!(detail?.employee?.employee_code || detail?.summary.employee_code);
  const profile = detail?.onboarding?.profile ?? null;
  const bank = detail?.onboarding?.bank ?? null;
  const qualifications = detail?.onboarding?.qualifications ?? [];
  const experience = detail?.onboarding?.experience ?? [];
  const esign = detail?.esign;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-600 text-white p-6 mb-4 shadow-lg">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-200">HR · Onboarding</p>
              <h1 className="text-2xl font-bold text-white">Joining Control Room</h1>
              <p className="text-sm text-blue-100 mt-1">Monitor onboarding status, JCLR logistics, statutory, DPDP consent, and provisioning tasks.</p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/60" />
                <Input className="w-64 pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/20" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search candidate" onKeyDown={(event) => event.key === "Enter" && loadQueue()} />
              </div>
              <Button type="button" variant="outline" onClick={loadQueue} disabled={busy} className="border-white/30 bg-white/10 text-white hover:bg-white/20 min-h-[44px]"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            </div>
          </div>
        </div>

        <OnboardingTabBar />

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

        <div className="grid gap-4 xl:grid-cols-[440px_1fr]">
          <div className="rounded-2xl border border-blue-200 bg-white shadow-sm">
            <div className="border-b border-blue-100 bg-blue-50 px-4 py-3 font-semibold text-blue-800 rounded-t-2xl flex items-center justify-between">
              <span>Onboarding Queue</span>
              {queue.length >= 50 && <span className="text-xs font-normal text-blue-500">Showing 50 most recent — search to find others</span>}
            </div>
            <div className="max-h-[76vh] overflow-auto">
              {queue.map((row) => {
                const rs = row.readiness_status?.toLowerCase() || "";
                const isReady = rs.includes("ready") || rs.includes("complete");
                const isBlocked = rs.includes("blocked");
                const agingDays = row.aging_days ?? 0;
                const agingColor = agingDays > 7 ? "text-red-600" : agingDays > 3 ? "text-amber-600" : "text-emerald-600";
                const dotColor = isReady ? "bg-emerald-500" : isBlocked ? "bg-amber-500" : "bg-blue-500";
                return (
                <button
                  key={row.candidate_id}
                  type="button"
                  onClick={() => setSelectedId(row.candidate_id)}
                  className={`grid w-full gap-2 border-b border-slate-100 px-4 py-3 text-left hover:bg-blue-50/50 transition-colors ${selectedId === row.candidate_id ? "bg-blue-50 border-l-4 border-l-blue-600" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                      <div>
                        <div className="font-semibold text-slate-950">{row.full_name}</div>
                        <div className="text-xs text-slate-500">{row.candidate_code || row.mobile || row.email}</div>
                      </div>
                    </div>
                    {statusBadge(row.readiness_status)}
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[11px] text-slate-600">
                    <span>Form {row.onboarding_status || "pending"}</span>
                    <span>BGV {row.bgv_status || "pending"}</span>
                    <span>Offer {row.payroll_status || "pending"}</span>
                    <span>JCLR {row.jclr_status || "pending"}</span>
                  </div>
                  {row.employee_code && (
                    <div className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <UserCheck className="h-3 w-3" />{row.employee_code}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-700">{row.next_action}</span>
                    <span className={`shrink-0 font-semibold ${agingColor}`}>{agingDays}d</span>
                  </div>
                </button>
                );
              })}
              {!queue.length && <div className="p-8 text-center text-sm text-slate-500">No candidates found.</div>}
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-blue-200 bg-white shadow-sm">
            {!selected || !detail ? (
              <div className="grid min-h-[520px] place-items-center text-sm text-slate-500">Select a candidate to continue.</div>
            ) : (
              <>
                <div className="border-b border-blue-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="border-l-4 border-l-blue-500 pl-3">
                      <div className="text-xl font-bold text-slate-950">{selected.full_name}</div>
                      <div className="text-sm text-slate-600">{selected.email} | {selected.mobile}</div>
                      {hasEmployeeCode && (
                        <div className="mt-1 flex items-center gap-2 text-emerald-700">
                          <UserCheck className="h-4 w-4" />
                          <span className="font-semibold">{detail.employee?.employee_code || detail.summary.employee_code}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {statusBadge(detail.summary.onboarding_status)}
                      {statusBadge(detail.summary.bgv_status)}
                      {offer?.status && <Badge variant={offer.status === "approved" ? "default" : "outline"}>Offer: {offer.status}</Badge>}
                      <span title="BM / Branch Head JCLR Approval">{statusBadge(detail.summary.jclr_approval_status)}</span>
                      <span title="Payroll HR JCLR Entry">{statusBadge(detail.summary.jclr_status)}</span>
                      {/* E-sign was invisible on this screen entirely — HR had to open the
                          Joining Documents Tracker to find out whether anything was signed. */}
                      {esign && esign.total > 0 && (
                        <span title="Joining documents signed">
                          <Badge variant={esign.completed === esign.total ? "default" : esign.completed > 0 ? "outline" : "destructive"}>
                            E-Sign {esign.completed}/{esign.total}
                          </Badge>
                        </span>
                      )}
                    </div>
                  </div>
                  {detail.summary.blockers?.length ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Pending blockers</div>
                      <div className="grid gap-1">{detail.summary.blockers.map((item) => <span key={item}>{item}</span>)}</div>
                    </div>
                  ) : hasEmployeeCode ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />Employee created. Provisioning tasks dispatched.
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      <Loader2 className="h-4 w-4 animate-spin" />Awaiting Branch Head approval to auto-generate employee code.
                    </div>
                  )}
                </div>

                <Tabs defaultValue="summary" className="p-4">
                  <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
                    {[
                      ["summary", "Summary"],
                      ["personal", "Personal Details"],
                      ["bank", "Bank & Education"],
                      ["offer", "Offer Details"],
                      ["dates", "Effective Dates"],
                      ["documents", "Documents"],
                      ["esign", "E-Sign Status"],
                      ["bgv", "BGV"],
                      ["jclr", "JCLR Logistics"],
                      ["statutory", "Statutory"],
                      ["provisioning", "Provisioning"],
                      ["dpdp", "DPDP"],
                    ].map(([tab, label]) => (
                      <TabsTrigger key={tab} value={tab}>{label}</TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value="summary" className="grid gap-4 md:grid-cols-3">
                    {[
                      ["Candidate", detail.summary.candidate_code || detail.summary.candidate_id],
                      ["Branch", detail.summary.applied_for_branch || "-"],
                      ["Process", detail.summary.applied_for_process || "-"],
                      ["Next action", detail.summary.next_action],
                      ["Employee code", detail.summary.employee_code || "Pending BH approval"],
                      ["Aging", `${detail.summary.aging_days ?? 0} days`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                        <div className="text-xs uppercase text-blue-500 tracking-wide font-semibold">{label}</div>
                        <div className="mt-1 font-semibold text-slate-900">{value}</div>
                      </div>
                    ))}
                  </TabsContent>

                  {/* Everything below comes straight from the candidate's own onboarding
                      submission. The API has always returned it; this page used to discard it. */}
                  <TabsContent value="personal" className="grid gap-4">
                    {profile ? (
                      <>
                        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                          Submitted by the candidate on the onboarding portal
                          {profile.submitted_at ? ` on ${new Date(profile.submitted_at).toLocaleString()}` : ""} · form status{" "}
                          <span className="font-semibold">{profile.profile_status || "pending"}</span>. Read-only here — corrections are made on the
                          candidate onboarding form.
                        </div>
                        <DetailSection
                          title="Identity"
                          fields={[
                            ["Full name", profile.employee_name || detail.summary.full_name],
                            ["Father / Husband", profile.father_husband_name],
                            ["Mother", profile.mother_name],
                            ["Date of birth", profile.date_of_birth],
                            ["Gender", profile.gender],
                            ["Marital status", profile.marital_status],
                            ["Blood group", profile.blood_group],
                            ["Nationality", profile.nationality],
                            ["Religion", profile.religion],
                            ["Category", profile.category],
                            ["PAN", profile.pan_number_masked],
                            ["Aadhaar", profile.aadhaar_number_masked],
                          ]}
                          note="PAN and Aadhaar are shown masked"
                        />
                        <DetailSection
                          title="Contact"
                          fields={[
                            ["Mobile", profile.mobile_number || detail.summary.mobile],
                            ["Alternate mobile", profile.alt_mobile_number],
                            ["Personal email", profile.personal_email_id || detail.summary.email],
                            ["Official email", profile.official_email_id || detail.employee?.official_email],
                            ["Emergency contact", profile.emergency_contact_name],
                            ["Emergency relation", profile.emergency_contact_relation],
                            ["Emergency mobile", profile.emergency_contact_mobile],
                            ["Landline", profile.landline_number],
                          ]}
                        />
                        <DetailSection
                          title="Address"
                          fields={[
                            ["Present address", profile.present_address],
                            ["Present city", profile.present_city],
                            ["Present state", profile.present_state],
                            ["Present pincode", profile.present_pincode],
                            ["Permanent address", profile.permanent_address],
                            ["Permanent city", profile.permanent_city],
                            ["Permanent state", profile.permanent_state],
                            ["Permanent pincode", profile.permanent_pincode],
                            ["Address proof", profile.address_proof_type],
                          ]}
                        />
                        <DetailSection
                          title="Statutory Identifiers Declared by Candidate"
                          note="Pre-fills the Statutory tab"
                          fields={[
                            ["UAN", profile.uan_number],
                            ["EPF number", profile.epf_number],
                            ["ESIC number", profile.esic_number],
                            ["Previously a PF member", profile.previous_pf_member === null || profile.previous_pf_member === undefined ? null : Number(profile.previous_pf_member) === 1],
                            ["EPS member", profile.eps_member === null || profile.eps_member === undefined ? null : Number(profile.eps_member) === 1],
                            ["International worker", profile.international_worker === null || profile.international_worker === undefined ? null : Number(profile.international_worker) === 1],
                            ["Nominee", profile.nominee_name],
                            ["Nominee relation", profile.nominee_relation],
                            ["Nominee DOB", profile.nominee_date_of_birth],
                            ["Nominee 1 share %", profile.nominee1_share_pct],
                            ["Nominee 2", profile.nominee2_name],
                            ["Nominee 2 share %", profile.nominee2_share_pct],
                          ]}
                        />
                        <DetailSection
                          title="Other Identity Documents"
                          fields={[
                            ["Passport", profile.passport_number || profile.passport_no],
                            ["Driving licence", profile.dl_number || profile.driving_license_no],
                            ["Location type", profile.emp_location_type],
                            ["Work status", profile.work_status],
                          ]}
                        />
                      </>
                    ) : (
                      <EmptySection
                        title="Candidate has not submitted the onboarding form"
                        hint="Personal details appear here once the candidate completes the onboarding portal form. Until then there is nothing to pre-fill the Statutory tab from."
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="bank" className="grid gap-4">
                    {bank && hasEmployeeCode && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-slate-600">
                            Nothing copies this verified account into payroll's payment records automatically for an
                            employee created before this button existed — that is what it does.
                          </span>
                          <Button
                            type="button" variant="outline" size="sm"
                            onClick={() => action("bank-detail/sync", {}, "Bank details sent to payroll")}
                            disabled={busy}
                          >
                            Send to payroll for salary transfer
                          </Button>
                        </div>
                      </div>
                    )}
                    {bank ? (
                      <DetailSection
                        title="Bank Account"
                        note={bank.verification_status ? `Verification: ${bank.verification_status}` : undefined}
                        fields={[
                          ["Bank", bank.bank_name],
                          ["Branch", bank.branch_name],
                          ["Account holder", bank.account_holder_name],
                          ["Account number", bank.account_no_masked],
                          ["IFSC", bank.ifsc_code],
                          ["Account type", bank.account_type],
                          ["Name on cheque", bank.name_on_cheque],
                          ["Name match", bank.name_validation_status],
                          ["Penny drop", detail.esign?.penny_drop_status ?? bank.verification_status],
                          ["Verified at", bank.verified_at],
                          ["HR validation", bank.validation_status],
                          ["Rejection remarks", bank.rejection_remarks],
                        ]}
                      />
                    ) : (
                      <EmptySection title="No bank account submitted" hint="The candidate has not completed the bank step of the onboarding form. Salary cannot be paid until this exists and passes penny drop." />
                    )}

                    {qualifications.length ? (
                      qualifications.map((q, index) => (
                        <DetailSection
                          key={q.id || index}
                          title={qualifications.length > 1 ? `Qualification ${index + 1}` : "Qualification"}
                          fields={[
                            ["Qualification", q.qualification],
                            ["Specialisation", q.specialization_course_name],
                            ["Institution", q.institution_name],
                            ["Board / University", q.board_type],
                            ["Year passed", q.passed_out_year],
                            ["State", q.passed_out_state],
                            ["City", q.passed_out_city],
                            ["Percentage", q.passed_out_percentage],
                          ]}
                        />
                      ))
                    ) : (
                      <EmptySection title="No qualification recorded" hint="The candidate has not completed the education step of the onboarding form." />
                    )}

                    {experience.length ? (
                      experience.map((e, index) => (
                        <DetailSection
                          key={e.id || index}
                          title={experience.length > 1 ? `Experience ${index + 1}` : "Previous Experience"}
                          fields={[
                            ["Employer", e.employer_name],
                            ["Last designation", e.last_designation],
                            ["From", e.from_date],
                            ["To", e.to_date],
                            ["Total experience", e.working_experience],
                            ["Years", e.experience_year],
                            ["Last CTC", e.last_ctc ? `₹${Number(e.last_ctc).toLocaleString("en-IN")}` : null],
                            ["Proof type", e.experience_doc_type],
                            ["Reporting manager", e.reporting_manager_name],
                            ["Manager mobile", e.reporting_manager_mobile],
                            ["Reason for leaving", e.reason_for_leaving],
                          ]}
                        />
                      ))
                    ) : (
                      <EmptySection title="No previous experience recorded" hint="Either the candidate is a fresher or the experience step of the onboarding form is incomplete." />
                    )}
                  </TabsContent>

                  <TabsContent value="esign" className="grid gap-4">
                    {/* The background poller backs off to as much as an hour between
                        checks on a transaction, deliberately, to keep the vendor's
                        per-call billing sane — so a signature completed a few minutes
                        ago can still read as pending here. This asks the provider
                        directly instead of waiting for the schedule. */}
                    <Button
                      type="button" variant="outline" className="w-fit"
                      onClick={() => action("esign/recheck", {}, "Checked with the provider")}
                      disabled={busy}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />Check e-sign status now
                    </Button>
                    {esign && esign.total > 0 ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-4">
                          <ReadOnlyField label="Signed" value={`${esign.completed} of ${esign.total}`} />
                          <ReadOnlyField label="In progress" value={esign.in_progress} />
                          <ReadOnlyField label="Not started" value={esign.not_started} />
                          <ReadOnlyField label="Kit completion" value={esign.kit_completion_pct != null ? `${Number(esign.kit_completion_pct).toFixed(0)}%` : "-"} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm">
                          <span className="font-semibold text-slate-900">Joining kit</span>
                          {statusBadge(esign.kit_status || undefined)}
                          <span className="text-slate-500">DigiLocker</span>
                          {statusBadge(esign.digilocker_status || undefined)}
                          <span className="text-slate-500">Penny drop</span>
                          {statusBadge(esign.penny_drop_status || undefined)}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {esign.documents.map((doc) => (
                            <EsignDocumentRow key={doc.document_code || doc.document_name} doc={doc} />
                          ))}
                        </div>
                        <Button type="button" variant="outline" size="sm" className="w-fit" asChild>
                          <Link to="/ats/joining-documents-tracker"><FileText className="mr-2 h-4 w-4" />Open Joining Documents Tracker</Link>
                        </Button>
                      </>
                    ) : (
                      <EmptySection
                        title="No joining document checklist yet"
                        hint="The e-sign checklist is created when the joining kit is assembled, which happens after the employee code is generated on Branch Head approval."
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="offer" className="grid gap-4">
                    {offer ? (
                      <>
                        <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="font-semibold text-slate-900">Employment Offer</h3>
                            {statusBadge(offer.status)}
                          </div>
                          <div className="grid gap-3 md:grid-cols-4">
                            <ReadOnlyField label="Employment Type" value={offer.emp_type} />
                            <ReadOnlyField label="Date of Joining" value={offer.date_of_joining} />
                            <ReadOnlyField label="Salary Start Date" value={offer.date_of_salary} />
                            <ReadOnlyField label="Salary Band" value={offer.salary_band} />
                            <ReadOnlyField label="Department" value={offer.department_name} />
                            <ReadOnlyField label="Designation" value={offer.designation_name} />
                            <ReadOnlyField label="Cost Centre" value={offer.cost_centre_name} />
                            <ReadOnlyField label="Reporting Manager" value={offer.manager_name} />
                          </div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
                          <h3 className="mb-3 font-semibold text-slate-900">Salary Breakdown (from Offer)</h3>
                          <div className="grid gap-3 md:grid-cols-5">
                            <ReadOnlyField label="Gross" value={offer.gross ? `₹${offer.gross.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="Basic" value={offer.basic ? `₹${offer.basic.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="HRA" value={offer.hra ? `₹${offer.hra.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="Conveyance" value={offer.conveyance ? `₹${offer.conveyance.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="Special Allowance" value={offer.special_allowance ? `₹${offer.special_allowance.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="PF (Employee)" value={offer.pf_employee ? `₹${offer.pf_employee.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="PF (Employer)" value={offer.pf_employer ? `₹${offer.pf_employer.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="ESIC (Employee)" value={offer.esic_employee ? `₹${offer.esic_employee.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="ESIC (Employer)" value={offer.esic_employer ? `₹${offer.esic_employer.toLocaleString()}` : undefined} />
                            <ReadOnlyField label="Net In-Hand" value={offer.net_in_hand ? `₹${offer.net_in_hand.toLocaleString()}` : undefined} />
                          </div>
                        </div>
                        <p className="text-sm text-slate-500">
                          Salary was configured during the Employment Offer stage in{" "}
                          <Link to="/ats/onboarding-requests" className="text-blue-600 hover:underline">Onboarding Requests</Link>.
                          To modify, edit the offer there before Branch Head approval.
                        </p>
                      </>
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                        <AlertTriangle className="mb-2 h-5 w-5" />
                        No employment offer found. Submit an offer from{" "}
                        <Link to="/ats/onboarding-requests" className="font-medium underline">Onboarding Requests</Link> first.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="dates" className="grid gap-4">
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      If the joining date is delayed or preponed, update the effective dates below. This affects when attendance, statutory deductions, and first payroll month begin.
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="salary_start_date" className="text-xs font-medium text-slate-600">
                          Salary Start Date
                        </Label>
                        <TextInput form={dateForm} setForm={setDateForm} name="salary_start_date" type="date" />
                        <p className="text-[11px] text-slate-400">
                          Date salary generation begins. Defaults to joining date if left blank.
                        </p>
                      </div>
                      <Field label="Attendance Effective From">
                        <TextInput form={dateForm} setForm={setDateForm} name="attendance_effective_from" type="date" />
                      </Field>
                      <Field label="Statutory Effective From">
                        <TextInput form={dateForm} setForm={setDateForm} name="statutory_effective_from" type="date" />
                      </Field>
                      <Field label="First Payroll Month (YYYY-MM)">
                        <TextInput form={dateForm} setForm={setDateForm} name="payroll_month_effective" />
                      </Field>
                    </div>
                    <Field label="Reason for date change (if different from DOJ)">
                      <Textarea value={dateForm.salary_effective_date_reason || ""} onChange={(e) => setDateForm({ ...dateForm, salary_effective_date_reason: e.target.value })} placeholder="e.g., Joining delayed due to notice period extension" />
                    </Field>
                    <Field label="Joining Remarks">
                      <Textarea value={dateForm.joining_remarks || ""} onChange={(e) => setDateForm({ ...dateForm, joining_remarks: e.target.value })} />
                    </Field>
                    <Button type="button" className="w-fit" onClick={saveDates} disabled={busy}>Save Effective Dates</Button>
                  </TabsContent>

                  <TabsContent value="documents"><SecureDocumentList candidateId={selectedId} /></TabsContent>

                  <TabsContent value="bgv" className="grid gap-4">
                    {/* PDF shortcut — same button present in BGV Verification Center */}
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <span className="text-sm font-semibold text-slate-700">BGV Report PDF</span>
                      <a href={`/bgv-report-view/${detail.summary.candidate_id}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="gap-2">
                          <FileText className="h-4 w-4" />
                          View / Download PDF
                        </Button>
                      </a>
                    </div>
                    <AddressBgvPanel candidateId={detail.summary.candidate_id} />
                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                      <div className="text-sm font-semibold">Name/Document Match</div>
                      <div className="mt-2 text-sm text-slate-600">Review per-document name match in Documents tab.</div>
                    </div>
                    {detail.summary.bgv_status !== "verified" && detail.summary.bgv_status !== "completed" && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <div className="mb-2 font-semibold text-amber-900">BGV Not Complete</div>
                        <p className="mb-3 text-sm text-amber-800">
                          For Aadhaar/PAN/Bank/Criminal checks or DigiLocker, use the full{" "}
                          <a href={`/ats/bgv`} className="font-medium underline">BGV Verification Center</a>.
                        </p>
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href="/ats/bgv"><ExternalLink className="mr-2 h-4 w-4" />Open BGV Verification Center</a>
                        </Button>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="jclr" className="grid gap-4">
                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm">
                      <div className="font-semibold text-slate-900">Joining-day logistics</div>
                      <div className="mt-2 text-slate-600">
                        Workstation, ID card, transport and training batch for Payroll HR to record.
                        This is operational handoff information — it does not block onboarding
                        readiness or offer approval, which are tracked separately above.
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      {["joining_location", "joining_floor", "work_station", "training_batch", "trainer_name", "induction_slot", "transport_route", "joining_coordinator_id"].map((name) => (
                        <Field key={name} label={name.replaceAll("_", " ")}><TextInput form={jclrForm} setForm={setJclrForm} name={name} type={name === "induction_slot" ? "datetime-local" : "text"} /></Field>
                      ))}
                      <Field label="JCLR Status">
                        <select className="h-10 rounded border px-3" value={jclrForm.jclr_status || "pending"} onChange={(e) => setJclrForm({ ...jclrForm, jclr_status: e.target.value })}>
                          <option value="pending">Pending</option>
                          <option value="in_progress">In progress</option>
                          <option value="ready">Ready</option>
                          <option value="blocked">Blocked</option>
                          <option value="completed">Completed</option>
                        </select>
                      </Field>
                      {["system_required", "headset_required", "id_card_required", "transport_required"].map((name) => (
                        <Field key={name} label={name.replaceAll("_", " ")}><Toggle form={jclrForm} setForm={setJclrForm} name={name} /></Field>
                      ))}
                    </div>
                    <Field label="Blocker reason"><Textarea value={jclrForm.blocker_reason || ""} onChange={(e) => setJclrForm({ ...jclrForm, blocker_reason: e.target.value })} /></Field>
                    <Button type="button" className="w-fit" onClick={() => saveSection("jclr", jclrForm)} disabled={busy}>
                      <ClipboardCheck className="mr-2 h-4 w-4" />Save JCLR Entry
                    </Button>
                  </TabsContent>

                  <TabsContent value="statutory" className="grid gap-4">
                    {isStatutoryUnsaved(detail.statutory) && profile ? (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                        Pre-filled from what the candidate submitted on the onboarding portal. Nothing is stored until you press
                        <span className="font-semibold"> Save Statutory</span> — review each field first, then save to clear the
                        "EPF/statutory declaration is not verified" blocker.
                      </div>
                    ) : isStatutoryUnsaved(detail.statutory) ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        No statutory declaration on file and no candidate onboarding form to pre-fill it from. Enter the details manually.
                      </div>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="EPF Member">
                        <select className="h-10 rounded border px-3" value={statutoryForm.epf_member || "unknown"} onChange={(e) => setStatutoryForm({ ...statutoryForm, epf_member: e.target.value })}>
                          {EPF_MEMBER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="UAN"><TextInput form={statutoryForm} setForm={setStatutoryForm} name="uan" /></Field>
                      {/* Professional tax is levied per state — a closed set, so a dropdown,
                          not the free-text Input this used to be. */}
                      <Field label="Professional Tax State">
                        <select className="h-10 rounded border px-3" value={statutoryForm.professional_tax_state || ""} onChange={(e) => setStatutoryForm({ ...statutoryForm, professional_tax_state: e.target.value })}>
                          <option value="">Select state</option>
                          {INDIA_STATES.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}
                          {/* A pre-filled value from an older free-text row may not be in the
                              master list; keep it selectable rather than silently blanking it. */}
                          {statutoryForm.professional_tax_state && !INDIA_STATES.includes(statutoryForm.professional_tax_state) && (
                            <option value={statutoryForm.professional_tax_state}>{statutoryForm.professional_tax_state} (as recorded)</option>
                          )}
                        </select>
                      </Field>
                      <Field label="Nominee Name"><TextInput form={statutoryForm} setForm={setStatutoryForm} name="nominee_name" /></Field>
                      <Field label="Nominee Relationship">
                        <select className="h-10 rounded border px-3" value={statutoryForm.nominee_relationship || ""} onChange={(e) => setStatutoryForm({ ...statutoryForm, nominee_relationship: e.target.value })}>
                          <option value="">Select relationship</option>
                          {NOMINEE_RELATIONSHIPS.map((relation) => (
                            <option key={relation} value={relation}>{relation}</option>
                          ))}
                          {statutoryForm.nominee_relationship && !NOMINEE_RELATIONSHIPS.includes(statutoryForm.nominee_relationship) && (
                            <option value={statutoryForm.nominee_relationship}>{statutoryForm.nominee_relationship} (as recorded)</option>
                          )}
                        </select>
                      </Field>
                      <Field label="Nominee DOB"><TextInput form={statutoryForm} setForm={setStatutoryForm} name="nominee_dob" type="date" /></Field>
                      <Field label="Status">
                        <select className="h-10 rounded border px-3" value={statutoryForm.declaration_status || "pending"} onChange={(e) => setStatutoryForm({ ...statutoryForm, declaration_status: e.target.value })}>
                          {DECLARATION_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="PF Applicable"><Toggle form={statutoryForm} setForm={setStatutoryForm} name="pf_applicable" /></Field>
                      <Field label="ESI Applicable"><Toggle form={statutoryForm} setForm={setStatutoryForm} name="esi_applicable" /></Field>
                    </div>
                    <Field label="Remarks"><Textarea value={statutoryForm.remarks || ""} onChange={(e) => setStatutoryForm({ ...statutoryForm, remarks: e.target.value })} /></Field>
                    <Button type="button" className="w-fit" onClick={() => saveSection("statutory", statutoryForm)} disabled={busy}>Save Statutory</Button>
                  </TabsContent>

                  <TabsContent value="provisioning" className="grid gap-4">
                    {hasEmployeeCode ? (
                      <>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                          Employee code generated. Provisioning tasks have been auto-dispatched to IT, Admin, WFM, and HR.
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          {detail.provisioningTasks?.length ? (
                            detail.provisioningTasks.map((task) => (
                              <ProvisioningTaskCard key={task.task_code} task={task} />
                            ))
                          ) : (
                            <div className="col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                              Provisioning tasks are being dispatched — refresh in a moment.
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" asChild>
                            <Link to="/ats/joining-documents-tracker"><FileText className="mr-2 h-4 w-4" />Joining Documents Tracker</Link>
                          </Button>
                          <Button type="button" variant="outline" size="sm" asChild>
                            <Link to="/ats/bgv"><ShieldCheck className="mr-2 h-4 w-4" />Open BGV Center</Link>
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm text-slate-600">
                        Provisioning tasks will be auto-dispatched after employee code is generated (on Branch Head approval).
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="dpdp" className="grid gap-4">
                    <div className="grid gap-2 md:grid-cols-4">
                      {["candidate_onboarding", "bgv_verification", "document_review", "payroll_processing"].map((purpose) => (
                        <Button key={purpose} type="button" variant="outline" onClick={() => action("dpdp-consent", { purpose_code: purpose, consent_status: "granted" }, `${purpose} consent granted`)}>{purpose.replaceAll("_", " ")}</Button>
                      ))}
                    </div>
                    <Button type="button" variant="outline" className="w-fit" onClick={() => action("dpdp-withdrawal", { purpose_code: "document_review", reason: "Withdrawal requested from HR control room" }, "Withdrawal logged")}>Log withdrawal request</Button>
                    <pre className="max-h-[360px] overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify({ consent: detail.dpdp, withdrawals: detail.withdrawals }, null, 2)}</pre>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
