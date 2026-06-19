import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, Clock, IndianRupee, Plus, RefreshCcw, ShieldAlert, TicketCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";

type RevenueRiskRow = {
  revenue_date: string;
  client_id?: string;
  client_name?: string;
  process_id?: string;
  process_name?: string;
  billing_type?: string;
  billing_rate?: number;
  required_hc: number;
  planned_hc: number;
  available_hc: number;
  shortage_hc: number;
  expected_revenue: number;
  actual_revenue_estimate: number;
  revenue_at_risk: number;
  risk_level: string;
  reason_json?: string[];
  data_confidence_score: number;
};

type ContractRow = {
  id: string;
  contract_name: string;
  client_id?: string;
  process_id?: string;
  client_name?: string;
  process_name?: string;
  billing_type: string;
  billing_rate: number;
  monthly_minimum_commitment: number;
  effective_from: string;
  effective_to?: string;
  status: string;
};

type OptionRow = { id: string; name: string; client_id?: string; client_name?: string };

type Overview = {
  generated_at: string;
  executive_summary: {
    active_employees: number;
    open_actions: number;
    critical_actions: number;
    overdue_actions: number;
    support_sla_breached: number;
    people_attrition_risk: number;
    open_grievances: number;
    latest_payroll_gross_inr: number;
    revenue_at_risk_inr: number;
    shortage_hc: number;
  };
  attendance: { present: number; absent: number; late: number };
  support: { open: number; breached: number; urgent: number };
  people_risk: { watchlist: number; attrition_risk: number; average_score: number };
  grievances: { open: number; critical: number };
  payroll: { latest_gross: number; latest_net: number };
  revenue_risk?: { totals: any; rows: RevenueRiskRow[] };
  action_summary: { by_source: Array<{ label: string; value: number }>; by_owner: Array<{ label: string; value: number }> };
  health_signals: Array<{ label: string; value: number; status: string }>;
  data_confidence: Record<string, number>;
};

export default function NativeBusinessCommandCenter() {
  const [data, setData] = useState<Overview | null>(null);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [clients, setClients] = useState<OptionRow[]>([]);
  const [processes, setProcesses] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingContract, setSavingContract] = useState(false);
  const [message, setMessage] = useState("");
  const [contractForm, setContractForm] = useState({
    contract_name: "",
    client_id: "none",
    process_id: "none",
    billing_type: "per_seat",
    billing_rate: "",
    monthly_minimum_commitment: "",
    sla_target_percentage: "",
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: "",
  });

  const filteredProcesses = useMemo(() => {
    if (!contractForm.client_id || contractForm.client_id === "none") return processes;
    return processes.filter((process) => !process.client_id || process.client_id === contractForm.client_id);
  }, [processes, contractForm.client_id]);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [overviewRes, contractRes, optionRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Overview }>("/api/business-command/overview"),
        hrmsApi.get<{ success: boolean; data: ContractRow[] }>("/api/business-command/revenue-risk/contracts"),
        hrmsApi.get<{ success: boolean; data: { clients: OptionRow[]; processes: OptionRow[] } }>("/api/business-command/revenue-risk/options"),
      ]);
      setData(overviewRes.data);
      setContracts(contractRes.data ?? []);
      setClients(optionRes.data?.clients ?? []);
      setProcesses(optionRes.data?.processes ?? []);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load Business Command Center");
    } finally {
      setLoading(false);
    }
  };

  const generateRevenueRisk = async () => {
    setLoading(true);
    setMessage("");
    try {
      await hrmsApi.post("/api/business-command/revenue-risk/generate-daily", { date: new Date().toISOString().slice(0, 10) });
      setMessage("Revenue-at-risk snapshot generated for today.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Revenue-at-risk generation failed");
      setLoading(false);
    }
  };

  const createContract = async () => {
    if (!contractForm.contract_name.trim()) {
      setMessage("Contract name is required.");
      return;
    }
    if (contractForm.client_id === "none" && contractForm.process_id === "none") {
      setMessage("Select at least a client or a process for accurate revenue risk mapping.");
      return;
    }
    setSavingContract(true);
    setMessage("");
    try {
      await hrmsApi.post("/api/business-command/revenue-risk/contracts", {
        contract_name: contractForm.contract_name,
        client_id: contractForm.client_id === "none" ? null : contractForm.client_id,
        process_id: contractForm.process_id === "none" ? null : contractForm.process_id,
        billing_type: contractForm.billing_type,
        billing_rate: Number(contractForm.billing_rate || 0),
        monthly_minimum_commitment: Number(contractForm.monthly_minimum_commitment || 0),
        sla_target_percentage: contractForm.sla_target_percentage ? Number(contractForm.sla_target_percentage) : null,
        effective_from: contractForm.effective_from,
        effective_to: contractForm.effective_to || null,
        status: "active",
      });
      setMessage("Mapped contract created. Generate Revenue Risk to recalculate exposure using the new rate.");
      setContractForm({ contract_name: "", client_id: "none", process_id: "none", billing_type: "per_seat", billing_rate: "", monthly_minimum_commitment: "", sla_target_percentage: "", effective_from: new Date().toISOString().slice(0, 10), effective_to: "" });
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Unable to create contract");
    } finally {
      setSavingContract(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const summary = data?.executive_summary;
  const revenueRows = useMemo(() => data?.revenue_risk?.rows?.slice(0, 10) ?? [], [data]);

  return (
    <DashboardLayout>
      <main className="space-y-6 p-5 lg:p-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-950 to-blue-950 p-7 text-white shadow-2xl">
          <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold backdrop-blur">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                BPO Business Command Center
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">
                Where are we losing money, manpower, quality, or people stability today?
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-100">
                CEO-level operating cockpit connecting employees, attendance, support SLA, people risk, grievance risk, revenue leakage, payroll exposure and action ownership.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={generateRevenueRisk} disabled={loading} className="bg-white/15 text-white hover:bg-white/25">
                <IndianRupee className="mr-2 h-4 w-4" />
                Generate Revenue Risk
              </Button>
              <Button onClick={load} disabled={loading} className="bg-white text-slate-950 hover:bg-emerald-50">
                <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </section>

        {message ? <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Metric title="Revenue at risk" value={formatInr(summary?.revenue_at_risk_inr ?? 0)} icon={<IndianRupee />} intent={(summary?.revenue_at_risk_inr ?? 0) > 0 ? "danger" : "success"} />
          <Metric title="Shortage HC" value={summary?.shortage_hc ?? 0} icon={<Users />} intent={(summary?.shortage_hc ?? 0) > 0 ? "warning" : "success"} />
          <Metric title="Open actions" value={summary?.open_actions ?? 0} icon={<ShieldAlert />} intent={(summary?.critical_actions ?? 0) > 0 ? "danger" : "default"} />
          <Metric title="Overdue actions" value={summary?.overdue_actions ?? 0} icon={<Clock />} intent={(summary?.overdue_actions ?? 0) > 0 ? "danger" : "default"} />
          <Metric title="Payroll gross INR" value={formatInr(summary?.latest_payroll_gross_inr ?? 0)} icon={<IndianRupee />} />
          <Metric title="Active employees" value={summary?.active_employees ?? 0} icon={<Users />} />
          <Metric title="Support SLA breached" value={summary?.support_sla_breached ?? 0} icon={<TicketCheck />} intent={(summary?.support_sla_breached ?? 0) > 0 ? "danger" : "success"} />
          <Metric title="People attrition risk" value={summary?.people_attrition_risk ?? 0} icon={<AlertTriangle />} intent={(summary?.people_attrition_risk ?? 0) > 0 ? "warning" : "success"} />
          <Metric title="Open grievances" value={summary?.open_grievances ?? 0} icon={<ShieldAlert />} intent={(data?.grievances?.critical ?? 0) > 0 ? "danger" : "default"} />
          <Metric title="Critical actions" value={summary?.critical_actions ?? 0} icon={<AlertTriangle />} intent={(summary?.critical_actions ?? 0) > 0 ? "danger" : "success"} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
          <Panel title="Revenue-at-Risk by Process" subtitle="Daily estimate from contract rate, mandate, roster and attendance signals">
            <div className="max-h-[430px] overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>{["Risk", "Client / Process", "Required", "Available", "Short", "At Risk", "Confidence", "Reason"].map((h) => <th key={h} className="px-3 py-3 font-black">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {revenueRows.map((row, index) => (
                    <tr key={`${row.process_id ?? index}-${row.revenue_date}`} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-3"><RiskPill label={row.risk_level} /></td>
                      <td className="px-3 py-3"><div className="font-black text-slate-950">{row.process_name || "Unknown process"}</div><div className="text-xs text-slate-500">{row.client_name || "Unknown client"}</div></td>
                      <td className="px-3 py-3 font-bold">{row.required_hc}</td>
                      <td className="px-3 py-3 font-bold">{row.available_hc}</td>
                      <td className="px-3 py-3 font-bold text-amber-700">{row.shortage_hc}</td>
                      <td className="px-3 py-3 font-black text-red-700">{formatInr(row.revenue_at_risk)}</td>
                      <td className="px-3 py-3">{row.data_confidence_score}%</td>
                      <td className="px-3 py-3 max-w-[280px] truncate text-xs text-slate-500">{(row.reason_json ?? []).join(" | ") || "No risk reason"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && revenueRows.length === 0 ? <Empty /> : null}
            </div>
          </Panel>

          <Panel title="Mapped Contract Setup" subtitle="Map INR billing contract to client/process for precise revenue-risk calculation">
            <div className="space-y-3">
              <Input placeholder="Contract name" value={contractForm.contract_name} onChange={(e) => setContractForm((p) => ({ ...p, contract_name: e.target.value }))} />
              <Select value={contractForm.client_id} onValueChange={(value) => setContractForm((p) => ({ ...p, client_id: value, process_id: p.process_id !== "none" && value !== "none" && !processes.find((process) => process.id === p.process_id && process.client_id === value) ? "none" : p.process_id }))}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All clients / not mapped</SelectItem>
                  {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={contractForm.process_id} onValueChange={(value) => setContractForm((p) => ({ ...p, process_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All processes for selected client</SelectItem>
                  {filteredProcesses.map((process) => <SelectItem key={process.id} value={process.id}>{process.client_name ? `${process.client_name} · ` : ""}{process.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={contractForm.billing_type} onValueChange={(value) => setContractForm((p) => ({ ...p, billing_type: value }))}>
                <SelectTrigger><SelectValue placeholder="Billing type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_seat">Per seat</SelectItem>
                  <SelectItem value="per_hour">Per hour</SelectItem>
                  <SelectItem value="per_transaction">Per transaction</SelectItem>
                  <SelectItem value="fixed_monthly">Fixed monthly</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" placeholder="Billing rate INR" value={contractForm.billing_rate} onChange={(e) => setContractForm((p) => ({ ...p, billing_rate: e.target.value }))} />
              <Input type="number" placeholder="Monthly minimum commitment INR" value={contractForm.monthly_minimum_commitment} onChange={(e) => setContractForm((p) => ({ ...p, monthly_minimum_commitment: e.target.value }))} />
              <Input type="number" placeholder="SLA target % optional" value={contractForm.sla_target_percentage} onChange={(e) => setContractForm((p) => ({ ...p, sla_target_percentage: e.target.value }))} />
              <div className="grid gap-2 md:grid-cols-2">
                <Input type="date" value={contractForm.effective_from} onChange={(e) => setContractForm((p) => ({ ...p, effective_from: e.target.value }))} />
                <Input type="date" value={contractForm.effective_to} onChange={(e) => setContractForm((p) => ({ ...p, effective_to: e.target.value }))} />
              </div>
              <Button onClick={createContract} disabled={savingContract} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Create Mapped Contract
              </Button>
            </div>
            <div className="mt-5 space-y-2">
              <div className="text-sm font-black text-slate-700">Recent contracts</div>
              {contracts.slice(0, 5).map((contract) => <Mini key={contract.id} label={`${contract.contract_name}${contract.process_name ? ` · ${contract.process_name}` : contract.client_name ? ` · ${contract.client_name}` : ""}`} value={`${contract.billing_type} · ${formatInr(contract.billing_rate)}`} />)}
              {contracts.length === 0 ? <Empty /> : null}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Business Health Signals" subtitle="Red/amber/green operating signals from live modules">
            <div className="grid gap-3 md:grid-cols-2">
              {(data?.health_signals ?? []).map((signal) => <Signal key={signal.label} {...signal} />)}
              {!loading && !data?.health_signals?.length ? <Empty /> : null}
            </div>
          </Panel>
          <Panel title="Data Confidence" subtitle="Decision confidence by module">
            <div className="space-y-3">
              {Object.entries(data?.data_confidence ?? {}).map(([label, value]) => <Confidence key={label} label={label} value={Number(value)} />)}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <Panel title="Attendance Today" subtitle="Present, absent and late counts">
            <Mini label="Present" value={data?.attendance?.present ?? 0} />
            <Mini label="Absent" value={data?.attendance?.absent ?? 0} intent="danger" />
            <Mini label="Late" value={data?.attendance?.late ?? 0} intent="warning" />
          </Panel>
          <Panel title="Support Risk" subtitle="Ticket pressure and SLA breach">
            <Mini label="Open tickets" value={data?.support?.open ?? 0} />
            <Mini label="Urgent" value={data?.support?.urgent ?? 0} intent="warning" />
            <Mini label="Breached" value={data?.support?.breached ?? 0} intent="danger" />
          </Panel>
          <Panel title="People Risk" subtitle="Engagement and attrition signal">
            <Mini label="Average score" value={`${Math.round(data?.people_risk?.average_score ?? 0)}%`} />
            <Mini label="Watchlist" value={data?.people_risk?.watchlist ?? 0} intent="warning" />
            <Mini label="Attrition risk" value={data?.people_risk?.attrition_risk ?? 0} intent="danger" />
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Panel title="Open Actions by Source" subtitle="Which modules are producing risk ownership items">
            <Breakdown rows={data?.action_summary?.by_source ?? []} />
          </Panel>
          <Panel title="Open Actions by Owner" subtitle="Who owns the operating risk">
            <Breakdown rows={data?.action_summary?.by_owner ?? []} />
          </Panel>
        </section>

        {data?.generated_at ? <div className="text-xs font-semibold text-slate-400">Generated: {new Date(data.generated_at).toLocaleString()}</div> : null}
      </main>
    </DashboardLayout>
  );
}

function Metric({ title, value, icon, intent = "default" }: { title: string; value: React.ReactNode; icon: React.ReactNode; intent?: "default" | "danger" | "warning" | "success" }) {
  const cls = intent === "danger" ? "from-red-500 to-rose-600" : intent === "warning" ? "from-amber-500 to-orange-500" : intent === "success" ? "from-emerald-500 to-teal-500" : "from-blue-500 to-indigo-600";
  return <div className="rounded-[1.5rem] border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-500">{title}</p><div className="mt-2 text-3xl font-black text-slate-950">{value}</div></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${cls} text-white`}>{icon}</div></div></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-[1.5rem] border bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="text-sm text-slate-500">{subtitle}</p></div>{children}</section>;
}

function Signal({ label, value, status }: { label: string; value: number; status: string }) {
  const cls = status === "critical" ? "bg-red-50 text-red-800" : status === "warning" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800";
  const icon = status === "critical" ? <AlertTriangle className="h-4 w-4" /> : status === "warning" ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />;
  return <div className={`flex items-center justify-between rounded-2xl p-4 ${cls}`}><div className="flex items-center gap-2 font-black">{icon}{label}</div><div className="text-2xl font-black">{typeof value === "number" && label.toLowerCase().includes("revenue") ? formatInr(value) : value}</div></div>;
}

function Mini({ label, value, intent = "default" }: { label: string; value: React.ReactNode; intent?: "default" | "danger" | "warning" }) {
  const cls = intent === "danger" ? "bg-red-50 text-red-800" : intent === "warning" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-800";
  return <div className={`mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${cls}`}><span className="text-sm font-bold">{label}</span><span className="text-right text-lg font-black">{value}</span></div>;
}

function RiskPill({ label }: { label: string }) {
  const cls = label === "critical" ? "bg-red-50 text-red-800 border-red-200" : label === "high" ? "bg-orange-50 text-orange-800 border-orange-200" : label === "medium" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black capitalize ${cls}`}>{label || "none"}</span>;
}

function Confidence({ label, value }: { label: string; value: number }) {
  const cls = value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return <div><div className="mb-1 flex justify-between text-sm font-bold text-slate-600"><span>{label.replace(/_/g, " ")}</span><span>{value}%</span></div><div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${cls}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}

function Breakdown({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return <div className="space-y-2">{rows.slice(0, 12).map((row) => <div key={row.label} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"><span className="font-semibold text-slate-600">{row.label?.replace(/_/g, " ") || "Unassigned"}</span><span className="font-black text-slate-950">{row.value}</span></div>)}{rows.length === 0 ? <Empty /> : null}</div>;
}

function Empty() {
  return <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No data available yet.</div>;
}

function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}
