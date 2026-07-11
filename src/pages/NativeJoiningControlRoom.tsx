import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, Save, Search, UserCheck } from "lucide-react";
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

type Detail = {
  summary: QueueRow;
  onboarding: any;
  payroll: any;
  salaryProposal: any;
  salarySteps: any[];
  jclr: any;
  statutory: any;
  dpdp: any[];
  withdrawals: any[];
  employee: any;
};

const blankPayroll = {
  joining_date: "",
  salary_start_date: "",
  attendance_effective_from: "",
  statutory_effective_from: "",
  payroll_month_effective: "",
  salary_effective_date_reason: "",
  employment_type: "onroll",
  company_id: "",
  designation_id: "",
  department_id: "",
  process_id: "",
  cost_centre_id: "",
  reporting_manager_id: "",
  salary_slab_id: "",
  gross_salary: "",
  proposed_gross_salary: "",
  proposal_reason: "",
  profile: "",
  band_grade: "",
  employee_location: "",
  kpi: "",
  billable_status: "billable",
  type_of_employee: "",
  shift_id: "",
  remarks: "",
  joining_remarks: "",
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

function statusBadge(value?: string) {
  const status = value || "pending";
  const good = ["verified", "validated", "ready", "approved", "employee_created", "completed", "granted"].includes(status);
  const bad = ["blocked", "rejected", "withdrawn", "failed"].includes(status);
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

function TextInput({ form, setForm, name, type = "text" }: { form: any; setForm: (next: any) => void; name: string; type?: string }) {
  return <Input type={type} value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} />;
}

function Toggle({ form, setForm, name }: { form: any; setForm: (next: any) => void; name: string }) {
  return <input type="checkbox" className="h-4 w-4" checked={Boolean(form[name])} onChange={(event) => setForm({ ...form, [name]: event.target.checked })} />;
}

export default function NativeJoiningControlRoom() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [payrollForm, setPayrollForm] = useState<any>(blankPayroll);
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
      setPayrollForm({ ...blankPayroll, ...(res.data.payroll || {}) });
      setJclrForm({ ...blankJclr, ...(res.data.jclr || {}) });
      setStatutoryForm({ ...blankStatutory, ...(res.data.statutory || {}) });
    } catch (err: any) {
      setError(err.message || "Unable to load candidate");
    }
  };

  useEffect(() => { loadQueue(); }, []);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  const saveSection = async (section: "payroll" | "jclr" | "statutory", body: any) => {
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

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">Joining Control Room</h1>
            <p className="text-sm text-slate-600">Candidate onboarding, Payroll HR validation, BM / Branch Head JCLR approval, Payroll HR JCLR entry, statutory, DPDP, readiness, and employee-code gate.</p>
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
                    <span>Payroll {row.payroll_status || "pending"}</span>
                    <span>JCLR Entry {row.jclr_status || "pending"}</span>
                  </div>
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
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {statusBadge(detail.summary.onboarding_status)}
                      {statusBadge(detail.summary.bgv_status)}
                      {statusBadge(detail.summary.payroll_status)}
                      <span title="BM / Branch Head JCLR Approval">{statusBadge(detail.summary.jclr_approval_status)}</span>
                      <span title="Payroll HR JCLR Entry">{statusBadge(detail.summary.jclr_status)}</span>
                      {statusBadge(detail.summary.statutory_status)}
                      {statusBadge(detail.summary.dpdp_required_status)}
                    </div>
                  </div>
                  {detail.summary.blockers?.length ? (
                    <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Pending blockers</div>
                      <div className="grid gap-1">{detail.summary.blockers.map((item) => <span key={item}>{item}</span>)}</div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" />Ready for employee code gate.</div>
                  )}
                </div>

                <Tabs defaultValue="summary" className="p-4">
                  <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
                    {[
                      ["summary","summary"],
                      ["form","form"],
                      ["documents","documents"],
                      ["bgv","bgv"],
                      ["payroll","payroll"],
                      ["salary","salary"],
                      ["jclr","JCLR entry"],
                      ["statutory","statutory"],
                      ["approvals","approvals"],
                      ["readiness","readiness"],
                      ["employee","employee"],
                      ["provisioning","provisioning"],
                      ["appointment","appointment"],
                      ["dpdp","dpdp"],
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
                      ["Employee code", detail.summary.employee_code || "Not generated"],
                      ["Aging", `${detail.summary.aging_days ?? 0} days`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded border border-slate-200 p-4">
                        <div className="text-xs uppercase text-slate-500">{label}</div>
                        <div className="mt-1 font-semibold text-slate-900">{value}</div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="form">
                    <pre className="max-h-[560px] overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(detail.onboarding, null, 2)}</pre>
                  </TabsContent>

                  <TabsContent value="documents"><SecureDocumentList candidateId={selectedId} /></TabsContent>

                  <TabsContent value="bgv" className="grid gap-4 md:grid-cols-2">
                    <div className="rounded border border-slate-200 p-4"><div className="text-sm font-semibold">BGV status</div><div className="mt-2">{statusBadge(detail.summary.bgv_status)}</div></div>
                    <div className="rounded border border-slate-200 p-4"><div className="text-sm font-semibold">Name/document match</div><div className="mt-2 text-sm text-slate-600">Review per-document name match in Uploaded Documents.</div></div>
                  </TabsContent>

                  <TabsContent value="payroll" className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="DOJ"><TextInput form={payrollForm} setForm={setPayrollForm} name="joining_date" type="date" /></Field>
                      <Field label="Salary effective from"><TextInput form={payrollForm} setForm={setPayrollForm} name="salary_start_date" type="date" /></Field>
                      <Field label="Attendance effective"><TextInput form={payrollForm} setForm={setPayrollForm} name="attendance_effective_from" type="date" /></Field>
                      <Field label="Statutory effective"><TextInput form={payrollForm} setForm={setPayrollForm} name="statutory_effective_from" type="date" /></Field>
                      <Field label="Payroll month"><TextInput form={payrollForm} setForm={setPayrollForm} name="payroll_month_effective" /></Field>
                      <Field label="Employment type"><select className="h-10 rounded border px-3" value={payrollForm.employment_type || "onroll"} onChange={(e) => setPayrollForm({ ...payrollForm, employment_type: e.target.value })}><option value="onroll">On roll</option><option value="offrole">Off roll</option></select></Field>
                      {["company_id","department_id","designation_id","process_id","cost_centre_id","reporting_manager_id","salary_slab_id","gross_salary","profile","band_grade","employee_location","kpi","type_of_employee"].map((name) => (
                        <Field key={name} label={name.replaceAll("_", " ")}><TextInput form={payrollForm} setForm={setPayrollForm} name={name} type={name.includes("salary") ? "number" : "text"} /></Field>
                      ))}
                      <Field label="Billable"><select className="h-10 rounded border px-3" value={payrollForm.billable_status || "billable"} onChange={(e) => setPayrollForm({ ...payrollForm, billable_status: e.target.value })}><option value="billable">Billable</option><option value="non_billable">Non billable</option><option value="support">Support</option></select></Field>
                    </div>
                    <Field label="Salary effective date reason"><Textarea value={payrollForm.salary_effective_date_reason || ""} onChange={(e) => setPayrollForm({ ...payrollForm, salary_effective_date_reason: e.target.value })} /></Field>
                    <Field label="Joining remarks"><Textarea value={payrollForm.joining_remarks || ""} onChange={(e) => setPayrollForm({ ...payrollForm, joining_remarks: e.target.value })} /></Field>
                    <Button type="button" className="w-fit" onClick={() => saveSection("payroll", payrollForm)} disabled={busy}><Save className="mr-2 h-4 w-4" />Save Payroll HR</Button>
                  </TabsContent>

                  <TabsContent value="salary" className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Proposal salary"><TextInput form={payrollForm} setForm={setPayrollForm} name="proposed_gross_salary" type="number" /></Field>
                      <Field label="Proposal reason"><Input value={payrollForm.proposal_reason || ""} onChange={(e) => setPayrollForm({ ...payrollForm, proposal_reason: e.target.value })} /></Field>
                      <div className="flex items-end gap-2">
                        <Button type="button" onClick={() => saveSection("payroll", payrollForm)}>Save Proposal</Button>
                        <Button type="button" variant="outline" onClick={() => action("salary-register/lock", {}, "Salary register locked")}>Lock Register</Button>
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 p-4 text-sm">
                      <div className="mb-2 font-semibold">Salary Proposal Approval Stages</div>
                      <div className="grid gap-2 md:grid-cols-4">
                        <Button type="button" variant="outline" onClick={() => action("salary-proposal/approve", { approval_level: "bm", action: "approved" }, "BM / Branch Head salary approval completed")}>BM / Branch Head</Button>
                        <Button type="button" variant="outline" onClick={() => action("salary-proposal/approve", { approval_level: "operations", action: "approved" }, "Operations Head salary approval completed")}>Operations Head</Button>
                        <Button type="button" variant="outline" onClick={() => action("salary-proposal/approve", { approval_level: "payroll", action: "approved" }, "Payroll Head salary approval completed")}>Payroll Head</Button>
                        <Button type="button" variant="outline" onClick={() => action("salary-proposal/approve", { approval_level: "finance", action: "approved" }, "Finance Head salary approval completed")}>Finance Head</Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="jclr" className="grid gap-4">
                    <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
                      <div className="font-semibold text-slate-900">BM / Branch Head JCLR Approval</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {statusBadge(detail.summary.jclr_approval_status)}
                        <span className="text-slate-600">Payroll HR can complete JCLR Entry only after this approval is approved.</span>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      {["joining_location","joining_floor","work_station","training_batch","trainer_name","induction_slot","transport_route","joining_coordinator_id"].map((name) => (
                        <Field key={name} label={name.replaceAll("_", " ")}><TextInput form={jclrForm} setForm={setJclrForm} name={name} type={name === "induction_slot" ? "datetime-local" : "text"} /></Field>
                      ))}
                      <Field label="Payroll HR JCLR Entry status"><select className="h-10 rounded border px-3" value={jclrForm.jclr_status || "pending"} onChange={(e) => setJclrForm({ ...jclrForm, jclr_status: e.target.value })}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="ready">Ready</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></Field>
                      {["system_required","headset_required","id_card_required","transport_required"].map((name) => <Field key={name} label={name.replaceAll("_", " ")}><Toggle form={jclrForm} setForm={setJclrForm} name={name} /></Field>)}
                    </div>
                    <Field label="Blocker reason"><Textarea value={jclrForm.blocker_reason || ""} onChange={(e) => setJclrForm({ ...jclrForm, blocker_reason: e.target.value })} /></Field>
                    <Button type="button" className="w-fit" onClick={() => saveSection("jclr", jclrForm)} disabled={busy || detail.summary.jclr_approval_status !== "approved"}><ClipboardCheck className="mr-2 h-4 w-4" />Save Payroll HR JCLR Entry</Button>
                  </TabsContent>

                  <TabsContent value="statutory" className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="EPF member"><select className="h-10 rounded border px-3" value={statutoryForm.epf_member || "unknown"} onChange={(e) => setStatutoryForm({ ...statutoryForm, epf_member: e.target.value })}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
                      {["uan","professional_tax_state","nominee_name","nominee_relationship","nominee_dob"].map((name) => (
                        <Field key={name} label={name.replaceAll("_", " ")}><TextInput form={statutoryForm} setForm={setStatutoryForm} name={name} type={name === "nominee_dob" ? "date" : "text"} /></Field>
                      ))}
                      <Field label="Status"><select className="h-10 rounded border px-3" value={statutoryForm.declaration_status || "pending"} onChange={(e) => setStatutoryForm({ ...statutoryForm, declaration_status: e.target.value })}><option value="pending">Pending</option><option value="submitted">Submitted</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select></Field>
                      <Field label="PF applicable"><Toggle form={statutoryForm} setForm={setStatutoryForm} name="pf_applicable" /></Field>
                      <Field label="ESI applicable"><Toggle form={statutoryForm} setForm={setStatutoryForm} name="esi_applicable" /></Field>
                    </div>
                    <Field label="Remarks"><Textarea value={statutoryForm.remarks || ""} onChange={(e) => setStatutoryForm({ ...statutoryForm, remarks: e.target.value })} /></Field>
                    <Button type="button" className="w-fit" onClick={() => saveSection("statutory", statutoryForm)} disabled={busy}>Save Statutory</Button>
                  </TabsContent>

                  <TabsContent value="approvals" className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded border border-slate-200 p-4">
                        <div className="text-sm font-semibold text-slate-900">BM / Branch Head JCLR Approval</div>
                        <div className="mt-2">{statusBadge(detail.summary.jclr_approval_status)}</div>
                      </div>
                      <div className="rounded border border-slate-200 p-4">
                        <div className="text-sm font-semibold text-slate-900">Payroll HR JCLR Entry</div>
                        <div className="mt-2">{statusBadge(detail.summary.jclr_status)}</div>
                      </div>
                    </div>
                    <pre className="max-h-[420px] overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify({ salaryProposal: detail.salaryProposal, salarySteps: detail.salarySteps }, null, 2)}</pre>
                  </TabsContent>

                  <TabsContent value="readiness" className="grid gap-4">
                    <Button type="button" className="w-fit" onClick={() => action("readiness", {}, "Readiness refreshed")}><ClipboardCheck className="mr-2 h-4 w-4" />Run readiness gate</Button>
                    <div className="rounded border border-slate-200 p-4 text-sm">{detail.summary.blockers?.length ? detail.summary.blockers.map((b) => <div key={b}>{b}</div>) : "No blockers."}</div>
                  </TabsContent>

                  <TabsContent value="employee" className="grid gap-4">
                    <div className="rounded border border-slate-200 p-4">Employee code: <strong>{detail.employee?.employee_code || detail.summary.employee_code || "Not generated"}</strong></div>
                    <Button type="button" className="w-fit" onClick={() => action("employee-code", {}, "Employee code generated")}><UserCheck className="mr-2 h-4 w-4" />Generate Employee Code</Button>
                  </TabsContent>

                  <TabsContent value="provisioning"><pre className="rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(detail.employee || {}, null, 2)}</pre></TabsContent>
                  <TabsContent value="appointment"><pre className="rounded bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(detail.employee || {}, null, 2)}</pre></TabsContent>

                  <TabsContent value="dpdp" className="grid gap-4">
                    <div className="grid gap-2 md:grid-cols-4">
                      {["candidate_onboarding","bgv_verification","document_review","payroll_processing"].map((purpose) => (
                        <Button key={purpose} type="button" variant="outline" onClick={() => action("dpdp-consent", { purpose_code: purpose, consent_status: "granted" }, `${purpose} consent granted`)}>{purpose}</Button>
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
