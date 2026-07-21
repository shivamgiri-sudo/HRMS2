import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, ExternalLink, FileText, Loader2, RefreshCw, Search, Server, ShieldCheck, UserCheck } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { SecureDocumentList } from "@/components/documents/SecureDocumentList";

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

type Detail = {
  summary: QueueRow;
  onboarding: any;
  offer?: OfferData;
  payroll: any;
  salaryProposal: any;
  salarySteps: any[];
  jclr: any;
  statutory: any;
  dpdp: any[];
  withdrawals: any[];
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
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-900">{value ?? "-"}</div>
    </div>
  );
}

function ProvisioningTaskCard({ task }: { task: ProvisioningTask }) {
  const icons: Record<string, React.ReactNode> = {
    WFM_PROCESS_ALIGNMENT: <Clock className="h-5 w-5" />,
    IT_EMAIL_DOMAIN_ASSET: <Server className="h-5 w-5" />,
    ADMIN_BIOMETRIC_ID_CARD: <ShieldCheck className="h-5 w-5" />,
    APPOINTMENT_LETTER_ESIGN: <FileText className="h-5 w-5" />,
  };
  const isComplete = task.status === "completed";
  const isOverdue = task.sla_due && new Date(task.sla_due) < new Date() && !isComplete;

  return (
    <div className={`rounded border p-4 ${isComplete ? "border-emerald-200 bg-emerald-50" : isOverdue ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
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
      setStatutoryForm({ ...blankStatutory, ...(res.data.statutory || {}) });
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

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">Joining Control Room</h1>
            <p className="text-sm text-slate-600">Monitor onboarding status, JCLR logistics, statutory, DPDP consent, and provisioning tasks.</p>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="w-72 pl-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search candidate" onKeyDown={(event) => event.key === "Enter" && loadQueue()} />
            </div>
            <Button type="button" variant="outline" onClick={loadQueue} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </div>

        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

        <div className="grid gap-4 xl:grid-cols-[440px_1fr]">
          <div className="rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 font-semibold">Onboarding Queue</div>
            <div className="max-h-[76vh] overflow-auto">
              {queue.map((row) => (
                <button
                  key={row.candidate_id}
                  type="button"
                  onClick={() => setSelectedId(row.candidate_id)}
                  className={`grid w-full gap-2 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selectedId === row.candidate_id ? "bg-slate-100" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-950">{row.full_name}</div>
                      <div className="text-xs text-slate-500">{row.candidate_code || row.mobile || row.email}</div>
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
                    <span className="shrink-0 text-slate-500">{row.aging_days ?? 0}d</span>
                  </div>
                </button>
              ))}
              {!queue.length && <div className="p-8 text-center text-sm text-slate-500">No candidates found.</div>}
            </div>
          </div>

          <div className="min-w-0 rounded border border-slate-200 bg-white">
            {!selected || !detail ? (
              <div className="grid min-h-[520px] place-items-center text-sm text-slate-500">Select a candidate to continue.</div>
            ) : (
              <>
                <div className="border-b border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
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
                    </div>
                  </div>
                  {detail.summary.blockers?.length ? (
                    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Pending blockers</div>
                      <div className="grid gap-1">{detail.summary.blockers.map((item) => <span key={item}>{item}</span>)}</div>
                    </div>
                  ) : hasEmployeeCode ? (
                    <div className="mt-3 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />Employee created. Provisioning tasks dispatched.
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      <Loader2 className="h-4 w-4 animate-spin" />Awaiting Branch Head approval to auto-generate employee code.
                    </div>
                  )}
                </div>

                <Tabs defaultValue="summary" className="p-4">
                  <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
                    {[
                      ["summary", "Summary"],
                      ["offer", "Offer Details"],
                      ["dates", "Effective Dates"],
                      ["documents", "Documents"],
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
                      <div key={label} className="rounded border border-slate-200 p-4">
                        <div className="text-xs uppercase text-slate-500">{label}</div>
                        <div className="mt-1 font-semibold text-slate-900">{value}</div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="offer" className="grid gap-4">
                    {offer ? (
                      <>
                        <div className="rounded border border-slate-200 p-4">
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
                        <div className="rounded border border-slate-200 p-4">
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
                          <a href="/ats/onboarding-requests" className="text-blue-600 hover:underline">Onboarding Requests</a>.
                          To modify, edit the offer there before Branch Head approval.
                        </p>
                      </>
                    ) : (
                      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                        <AlertTriangle className="mb-2 h-5 w-5" />
                        No employment offer found. Submit an offer from{" "}
                        <a href="/ats/onboarding-requests" className="font-medium underline">Onboarding Requests</a> first.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="dates" className="grid gap-4">
                    <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      If the joining date is delayed or preponed, update the effective dates below. This affects when attendance, statutory deductions, and first payroll month begin.
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="Salary Start Date">
                        <TextInput form={dateForm} setForm={setDateForm} name="salary_start_date" type="date" />
                      </Field>
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded border border-slate-200 p-4">
                        <div className="text-sm font-semibold">BGV Status</div>
                        <div className="mt-2">{statusBadge(detail.summary.bgv_status)}</div>
                      </div>
                      <div className="rounded border border-slate-200 p-4">
                        <div className="text-sm font-semibold">Name/Document Match</div>
                        <div className="mt-2 text-sm text-slate-600">Review per-document name match in Documents tab.</div>
                      </div>
                    </div>
                    {detail.summary.bgv_status !== "verified" && detail.summary.bgv_status !== "completed" && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-4">
                        <div className="mb-2 font-semibold text-amber-900">BGV Not Complete</div>
                        <p className="mb-3 text-sm text-amber-800">
                          If automated BGV failed or is unavailable, you can manually verify and override from the{" "}
                          <a href={`/ats/bgv-enhanced`} className="font-medium underline">Enhanced BGV</a> page.
                        </p>
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href="/ats/bgv-enhanced"><ExternalLink className="mr-2 h-4 w-4" />Open BGV Enhanced</a>
                        </Button>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="jclr" className="grid gap-4">
                    <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
                      <div className="font-semibold text-slate-900">BM / Branch Head JCLR Approval</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {statusBadge(detail.summary.jclr_approval_status)}
                        <span className="text-slate-600">JCLR Entry can be completed only after this approval.</span>
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
                    <Button type="button" className="w-fit" onClick={() => saveSection("jclr", jclrForm)} disabled={busy || detail.summary.jclr_approval_status !== "approved"}>
                      <ClipboardCheck className="mr-2 h-4 w-4" />Save JCLR Entry
                    </Button>
                  </TabsContent>

                  <TabsContent value="statutory" className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="EPF Member">
                        <select className="h-10 rounded border px-3" value={statutoryForm.epf_member || "unknown"} onChange={(e) => setStatutoryForm({ ...statutoryForm, epf_member: e.target.value })}>
                          <option value="unknown">Unknown</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </Field>
                      {["uan", "professional_tax_state", "nominee_name", "nominee_relationship", "nominee_dob"].map((name) => (
                        <Field key={name} label={name.replaceAll("_", " ")}><TextInput form={statutoryForm} setForm={setStatutoryForm} name={name} type={name === "nominee_dob" ? "date" : "text"} /></Field>
                      ))}
                      <Field label="Status">
                        <select className="h-10 rounded border px-3" value={statutoryForm.declaration_status || "pending"} onChange={(e) => setStatutoryForm({ ...statutoryForm, declaration_status: e.target.value })}>
                          <option value="pending">Pending</option>
                          <option value="submitted">Submitted</option>
                          <option value="verified">Verified</option>
                          <option value="rejected">Rejected</option>
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
                        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                          Employee code generated. Provisioning tasks have been auto-dispatched to IT, Admin, WFM, and HR.
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          {(detail.provisioningTasks?.length ? detail.provisioningTasks : [
                            { task_code: "WFM_PROCESS_ALIGNMENT", task_label: "WFM Process Alignment", assigned_role: "wfm", status: "pending" },
                            { task_code: "IT_EMAIL_DOMAIN_ASSET", task_label: "IT Email, Domain & Asset", assigned_role: "it", status: "pending" },
                            { task_code: "ADMIN_BIOMETRIC_ID_CARD", task_label: "Admin Biometric & ID Card", assigned_role: "admin", status: "pending" },
                            { task_code: "APPOINTMENT_LETTER_ESIGN", task_label: "Appointment Letter E-Sign", assigned_role: "hr", status: "pending" },
                          ]).map((task) => (
                            <ProvisioningTaskCard key={task.task_code} task={task} />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" asChild>
                            <a href="/provisioning/it"><Server className="mr-2 h-4 w-4" />IT Provisioning</a>
                          </Button>
                          <Button type="button" variant="outline" size="sm" asChild>
                            <a href="/provisioning/admin"><ShieldCheck className="mr-2 h-4 w-4" />Admin Provisioning</a>
                          </Button>
                          <Button type="button" variant="outline" size="sm" asChild>
                            <a href="/provisioning/wfm-alignment"><Clock className="mr-2 h-4 w-4" />WFM Alignment</a>
                          </Button>
                          <Button type="button" variant="outline" size="sm" asChild>
                            <a href="/provisioning/appointment-letter"><FileText className="mr-2 h-4 w-4" />Appointment Letters</a>
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
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
