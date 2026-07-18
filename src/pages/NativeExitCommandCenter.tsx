import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileText, IndianRupee, RefreshCcw, ShieldCheck, UserMinus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";

type ExitRow = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  process_name?: string;
  exit_type: string;
  exit_sub_type?: string;
  status: string;
  last_working_day_proposed?: string;
  created_at?: string;
  engagement_score?: number;
  regrettable_exit?: number;
  risk_label?: string;
  clearance_total?: number;
  clearance_cleared?: number;
};

type CenterData = {
  summary: Record<string, number>;
  requests: ExitRow[];
  clearance: Array<{ clearance_area: string; status: string; count: number }>;
};

type FullFinalCalc = {
  id: string;
  exit_request_id: string;
  employee_id: string;
  employee_name?: string;
  calculation_date: string;
  notice_period_days: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  earned_leave_encashment: number;
  gratuity_amount: number;
  salary_hold: number;
  advances_recovery: number;
  net_payable: number;
  status: "draft" | "verified" | "approved" | "paid";
  is_ff_provisional: number;
};

const statusFlow = ["submitted", "manager_review", "hr_review", "accepted", "notice_serving", "exited"];

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone];
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{children}</span>;
}

function StatCard({ title, value, icon, note }: { title: string; value: number; icon: React.ReactNode; note: string }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">{note}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function FfSettlementPanel({ exitRequests }: { exitRequests: ExitRow[] }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [ff, setFf] = useState<FullFinalCalc | null>(null);
  const [loadingFf, setLoadingFf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [form, setForm] = useState({
    noticePeriodDays: 0,
    noticeShortfallDays: 0,
    noticeRecovery: 0,
    gratuityAmount: 0,
    salaryHold: 0,
    advancesRecovery: 0,
    netPayable: 0,
  });

  const loadFf = async (exitRequestId: string) => {
    setLoadingFf(true);
    setFf(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: FullFinalCalc }>(
        `/api/exit/ff/${exitRequestId}`
      );
      setFf(res.data);
      setForm({
        noticePeriodDays: res.data.notice_period_days ?? 0,
        noticeShortfallDays: res.data.notice_shortfall_days ?? 0,
        noticeRecovery: res.data.notice_recovery ?? 0,
        gratuityAmount: res.data.gratuity_amount ?? 0,
        salaryHold: res.data.salary_hold ?? 0,
        advancesRecovery: res.data.advances_recovery ?? 0,
        netPayable: res.data.net_payable ?? 0,
      });
    } catch {
      setFf(null);
      setForm({ noticePeriodDays: 0, noticeShortfallDays: 0, noticeRecovery: 0, gratuityAmount: 0, salaryHold: 0, advancesRecovery: 0, netPayable: 0 });
    } finally {
      setLoadingFf(false);
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (id) void loadFf(id);
    else setFf(null);
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${selectedId}`, {
        calculationDate: new Date().toISOString().slice(0, 10),
        earnedLeaveEncashment: 0,
        ...form,
      });
      toast({ title: "F&F calculation saved" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!ff) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${ff.id}/verify`, {});
      toast({ title: "Marked as verified — provisional cleared" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({ title: "Verify failed", description: err?.message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const handleApprove = async () => {
    if (!ff) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/exit/ff/${ff.id}/approve`, {});
      toast({ title: "F&F approved" });
      await loadFf(selectedId);
    } catch (err: any) {
      toast({ title: "Approve failed", description: err?.message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const fmt = (n: number) =>
    `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const eligible = exitRequests.filter((e) =>
    ["accepted", "notice_serving", "exited", "exit_confirmed"].includes(e.status)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="whitespace-nowrap text-sm font-medium">Employee Exit</Label>
        <Select value={selectedId} onValueChange={handleSelect}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select an exit request…" />
          </SelectTrigger>
          <SelectContent>
            {eligible.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.employee_name ?? e.employee_id} — {e.status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedId && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm">
          Select an accepted or exited employee to view or create their F&amp;F settlement.
        </div>
      )}

      {selectedId && loadingFf && (
        <div className="py-8 text-center text-sm text-slate-500">Loading F&amp;F data…</div>
      )}

      {selectedId && !loadingFf && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {ff ? "Current F&F Calculation" : "Create F&F Calculation"}
              </CardTitle>
              {ff?.is_ff_provisional === 1 && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Provisional — must be verified before approval
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {([
                ["noticePeriodDays",    "Notice Period (days)"],
                ["noticeShortfallDays", "Notice Shortfall (days)"],
                ["noticeRecovery",      "Notice Recovery (₹)"],
                ["gratuityAmount",      "Gratuity (₹)"],
                ["salaryHold",          "Salary Hold (₹)"],
                ["advancesRecovery",    "Advances Recovery (₹)"],
                ["netPayable",          "Net Payable (₹)"],
              ] as [keyof typeof form, string][]).map(([key, label]) => (
                <div key={key} className="grid grid-cols-2 items-center gap-2">
                  <Label className="text-sm">{label}</Label>
                  <Input
                    type="number"
                    value={form[key]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                    className="h-8 text-right text-sm"
                  />
                </div>
              ))}
              <Button
                size="sm"
                className="w-full mt-2"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "Saving…" : ff ? "Update & Recalculate" : "Create F&F Calculation"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee className="h-4 w-4" />
                Settlement Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 space-y-2 text-sm">
                {([
                  ["Gratuity", form.gratuityAmount, false],
                  ["Notice Recovery", form.noticeRecovery, true],
                  ["Salary Hold", form.salaryHold, true],
                  ["Advances Recovery", form.advancesRecovery, true],
                ] as [string, number, boolean][]).map(([label, val, negative]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-600">{label}{negative ? " (−)" : ""}</span>
                    <span className={negative ? "text-red-600" : "text-slate-900"}>
                      {fmt(val)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                  <span>Net Payable</span>
                  <span className="text-emerald-700">{fmt(form.netPayable)}</span>
                </div>
              </div>

              {ff && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={ff.status === "approved" ? "default" : "secondary"}>
                    {ff.status}
                  </Badge>
                  {ff.is_ff_provisional === 1 && (
                    <Badge variant="outline" className="text-amber-700 border-amber-300">
                      Provisional
                    </Badge>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 mt-2">
                {ff && ff.is_ff_provisional === 1 && ff.status !== "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleVerify()}
                    disabled={acting}
                  >
                    {acting ? "Working…" : "Mark as Verified (Clear Provisional)"}
                  </Button>
                )}
                {ff && ff.is_ff_provisional === 0 && ff.status !== "approved" && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => void handleApprove()}
                    disabled={acting}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {acting ? "Approving…" : "Approve F&F"}
                  </Button>
                )}
                {ff?.status === "approved" && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Approved — ready for disbursement
                  </div>
                )}
                {!ff && (
                  <p className="text-xs text-slate-500">
                    No F&amp;F calculation exists yet. Fill the form and save to create one.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function NativeExitCommandCenter() {
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CenterData }>("/api/exit/command-center");
      setData(res.data);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load exit command center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const rows = data?.requests ?? [];
    return status === "all" ? rows : rows.filter((r) => r.status === status);
  }, [data, status]);

  const moveStatus = async (id: string, nextStatus: string) => {
    try {
      await hrmsApi.patch(`/api/exit/${id}/status`, { status: nextStatus, remarks: `Moved to ${nextStatus}` });
      setMessage(`Moved to ${nextStatus.replace(/_/g, " ")}`);
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Status update failed");
    }
  };

  const generateClearance = async (id: string) => {
    try {
      await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
      setMessage("Clearance tasks generated");
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Unable to generate clearance");
    }
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-rose-600">Employee Lifecycle</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Exit Command Center</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Manage resignation, retention, clearance, F&F readiness, and final exit closure from one controlled journey.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="ff">F&amp;F Settlement</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard title="Total exits" value={Number(data?.summary?.total ?? 0)} icon={<UserMinus className="h-5 w-5" />} note="All exit records" />
              <StatCard title="Pending review" value={Number(data?.summary?.pending_review ?? 0)} icon={<Clock className="h-5 w-5" />} note="Manager/HR/Admin" />
              <StatCard title="Active notice" value={Number(data?.summary?.active_notice ?? 0)} icon={<FileText className="h-5 w-5" />} note="Accepted or notice serving" />
              <StatCard title="Completed" value={Number(data?.summary?.completed ?? 0)} icon={<CheckCircle2 className="h-5 w-5" />} note="Exit confirmed" />
              <StatCard title="Regrettable" value={Number(data?.summary?.regrettable ?? 0)} icon={<AlertTriangle className="h-5 w-5" />} note="Retention attention" />
            </div>

            {/* AI Exit Risk Briefing */}
            <AIInsightPanel
              contextType="exit_risk"
              role="hr"
              title="Exit Risk AI Brief"
              enabled={data !== null && !loading}
              data={{
                total_exits: Number(data?.summary?.total ?? 0),
                pending_offboarding: Number(data?.summary?.pending_review ?? 0),
                regrettable_exits: Number(data?.summary?.regrettable ?? 0),
                active_notice: Number(data?.summary?.active_notice ?? 0),
                completed: Number(data?.summary?.completed ?? 0),
                kt_incomplete: data?.requests?.filter((r) => r.status !== "exited" && r.status !== "exit_confirmed").length ?? 0,
                clearance_pending: data?.clearance?.filter((c) => c.status === "pending").reduce((s, c) => s + c.count, 0) ?? 0,
              }}
            />

            <div className="rounded-3xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {["all", ...statusFlow, "rejected", "revoked"].map((s) => (
                  <button key={s} onClick={() => setStatus(s)} className={`rounded-xl px-3 py-1.5 text-xs font-bold capitalize ${status === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {s.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Exit journey board</h2>
                <p className="text-sm text-slate-500">{filtered.length} records</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {['Employee','Branch / Process','LWD','Status','Health','Clearance','Risk','Actions'].map((h) => <th key={h} className="p-4 font-bold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const currentIndex = statusFlow.indexOf(r.status === "exit_confirmed" ? "exited" : r.status);
                      const nextStatus = currentIndex >= 0 && currentIndex < statusFlow.length - 1 ? statusFlow[currentIndex + 1] : null;
                      const total = Number(r.clearance_total ?? 0);
                      const cleared = Number(r.clearance_cleared ?? 0);
                      return (
                        <tr key={r.id} className="border-t hover:bg-slate-50/80">
                          <td className="p-4">
                            <div className="font-black text-slate-950">{r.employee_name ?? r.employee_id}</div>
                            <div className="font-mono text-xs text-slate-500">{r.employee_code ?? r.employee_id?.slice(0, 8)}</div>
                          </td>
                          <td className="p-4 text-slate-600"><div>{r.branch_name ?? '—'}</div><div className="text-xs">{r.process_name ?? '—'}</div></td>
                          <td className="p-4 font-mono text-xs text-slate-600">{r.last_working_day_proposed ?? '—'}</td>
                          <td className="p-4"><Pill tone="blue">{r.status?.replace(/_/g, ' ')}</Pill></td>
                          <td className="p-4"><div className="font-black">{Math.round(Number(r.engagement_score ?? 0))}%</div><div className="text-xs text-slate-500">Engagement</div></td>
                          <td className="p-4"><div className="font-black">{cleared}/{total}</div><div className="text-xs text-slate-500">Cleared</div></td>
                          <td className="p-4">{r.regrettable_exit ? <Pill tone="red">Regrettable</Pill> : <Pill tone={r.risk_label === 'high' || r.risk_label === 'critical' ? 'amber' : 'green'}>{r.risk_label ?? 'low'}</Pill>}</td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-2">
                              {nextStatus && <button onClick={() => moveStatus(r.id, nextStatus)} className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">Move to {nextStatus.replace(/_/g, ' ')}</button>}
                              {total === 0 && <button onClick={() => generateClearance(r.id)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold text-slate-700"><ShieldCheck className="h-3 w-3" /> Generate clearance</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!filtered.length && <div className="p-10 text-center text-sm text-slate-500">No exit records found.</div>}
            </div>
          </TabsContent>

          <TabsContent value="ff">
            <FfSettlementPanel exitRequests={data?.requests ?? []} />
          </TabsContent>
        </Tabs>
      </main>
    </DashboardLayout>
  );
}
