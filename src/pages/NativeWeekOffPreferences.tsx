import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, CheckCircle2, Clock, Loader2, Play, Send, ShieldCheck, XCircle } from "lucide-react";
import { useWorkforceAccess } from "@/hooks/useUserRole";

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const statusTone: Record<string, string> = {
  submitted: "bg-amber-50 text-amber-700 hover:bg-amber-50",
  accepted: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  applied: "bg-blue-50 text-blue-700 hover:bg-blue-50",
  rejected: "bg-red-50 text-red-700 hover:bg-red-50",
};

type Process = { id: string; process_name?: string; process_code?: string };
type CapacitySlot = {
  day_of_week: number;
  day_name: string;
  allocated: number;
  max_count: number | null;
  max_percentage: number | null;
  slots_remaining: number | null;
};
type WeekOffPreference = {
  id: string;
  employee_id: string;
  process_id: string | null;
  branch_id: string | null;
  employee_code?: string | null;
  employee_name?: string | null;
  branch_name?: string | null;
  process_name?: string | null;
  week_start_date: string;
  preferred_day_1: number;
  preferred_day_2: number | null;
  reason: string | null;
  status: string;
  manager_remarks: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function getDayName(dayNum: number | null | undefined) {
  if (dayNum === null || dayNum === undefined) return "—";
  return DAYS.find((d) => d.value === Number(dayNum))?.label || `Day ${dayNum}`;
}

function nextMonday() {
  const date = new Date();
  const day = date.getDay();
  const add = day === 1 ? 0 : (8 - day) % 7 || 7;
  date.setDate(date.getDate() + add);
  return date.toISOString().slice(0, 10);
}

export default function NativeWeekOffPreferences() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const canReview = roleKeys.some((role) => ["admin", "hr", "wfm", "manager", "assistant_manager", "tl"].includes(role));
  const [weekStartDate, setWeekStartDate] = useState(nextMonday());
  const [preferredDay, setPreferredDay] = useState<number>(0);
  const [alternateDay, setAlternateDay] = useState<string>("none");
  const [reason, setReason] = useState("");
  const [processId, setProcessId] = useState("");

  const processes = useQuery({
    queryKey: ["weekoff-processes"],
    enabled: canReview,
    queryFn: async () => (await hrmsApi.get<{ data: Process[] }>("/api/processes")).data ?? [],
  });

  const { data: myPreferences = [] } = useQuery({
    queryKey: ["my-weekoff-preferences"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: WeekOffPreference[] }>("/api/roster-gov/weekoff-preferences?own=1");
      return res.data ?? [];
    },
  });

  const teamPreferences = useQuery({
    queryKey: ["team-weekoff-preferences", processId, weekStartDate],
    enabled: canReview && !!processId,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate });
      const res = await hrmsApi.get<{ data: WeekOffPreference[] }>(`/api/roster-gov/weekoff-preferences?${qs}`);
      return res.data ?? [];
    },
  });

  const submitPreference = useMutation({
    mutationFn: async () => hrmsApi.post("/api/roster-gov/weekoff-preferences", {
      weekStartDate,
      preferredDay1: preferredDay,
      preferredDay2: alternateDay === "none" ? null : Number(alternateDay),
      reason: reason.trim() || null,
    }),
    onSuccess: () => {
      setReason("");
      qc.invalidateQueries({ queryKey: ["my-weekoff-preferences"] });
      qc.invalidateQueries({ queryKey: ["team-weekoff-preferences"] });
    },
  });

  const updatePreference = useMutation({
    mutationFn: async ({ id, status, remarks }: { id: string; status: string; remarks?: string }) =>
      hrmsApi.patch(`/api/roster-gov/weekoff-preferences/${id}`, { status, remarks }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-weekoff-preferences"] }),
  });

  const [allocationMsg, setAllocationMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const capacityQ = useQuery({
    queryKey: ["weekoff-capacity", processId, weekStartDate],
    enabled: canReview && !!processId && !!weekStartDate,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate });
      return (await hrmsApi.get<{ data: CapacitySlot[] }>(`/api/roster-gov/weekoff/capacity?${qs}`)).data ?? [];
    },
  });

  const demandGridQ = useQuery({
    queryKey: ["weekoff-demand-grid", processId, weekStartDate],
    enabled: canReview && !!processId && !!weekStartDate,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate });
      return (await hrmsApi.get<{ success: boolean; data: Array<{ day_of_week: number; day_name: string; min_hc_required: number; is_safe: boolean; max_weekoff_allowed: number | null; current_allocated: number }> }>(`/api/wfm/weekoff/day-rules/capacity-grid?${qs}`)).data ?? [];
    },
  });

  const runAllocationMutation = useMutation({
    mutationFn: () => hrmsApi.post<{ data: { allocated: number; waitlisted: number; failed: number } }>("/api/roster-gov/weekoff/run-allocation", { processId, weekStartDate }),
    onSuccess: (res) => {
      const d = (res as any).data ?? res;
      setAllocationMsg({ type: "success", text: `FCFS complete — allocated: ${d.allocated}, waitlisted: ${d.waitlisted}, failed: ${d.failed}` });
      void qc.invalidateQueries({ queryKey: ["team-weekoff-preferences", processId, weekStartDate] });
      void qc.invalidateQueries({ queryKey: ["weekoff-capacity", processId, weekStartDate] });
    },
    onError: (err: Error) => setAllocationMsg({ type: "error", text: err.message ?? "Allocation failed." }),
  });

  const latest = myPreferences[0];
  const pressure = useMemo(() => {
    const counts = new Map<number, number>();
    for (const pref of teamPreferences.data ?? []) counts.set(pref.preferred_day_1, (counts.get(pref.preferred_day_1) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [teamPreferences.data]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-green-600 to-teal-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-10 w-10" />
            <div>
              <h1 className="text-3xl font-black">Week-Off Preferences</h1>
              <p className="mt-1 text-sm opacity-90">Submit, review, and apply weekly off preferences for roster planning.</p>
            </div>
          </div>
        </div>

        <RoleInsightsPanel roles={roleKeys} title="Week-off planning insights" />

        {latest && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Your Latest Preference</CardTitle>
                  <CardDescription>Submitted on {formatISTDate(latest.created_at)}</CardDescription>
                </div>
                <Badge className={statusTone[latest.status] ?? statusTone.submitted}>
                  {latest.status === "accepted" || latest.status === "applied" ? <CheckCircle2 className="mr-1 h-4 w-4" /> : <Clock className="mr-1 h-4 w-4" />}
                  {latest.status.replaceAll("_", " ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4"><div className="text-sm font-medium text-muted-foreground">Week Start</div><div className="mt-2 text-xl font-bold">{latest.week_start_date}</div></div>
              <div className="rounded-lg border p-4"><div className="text-sm font-medium text-muted-foreground">Preferred Day</div><div className="mt-2 text-xl font-bold">{getDayName(latest.preferred_day_1)}</div></div>
              <div className="rounded-lg border p-4"><div className="text-sm font-medium text-muted-foreground">Alternate Day</div><div className="mt-2 text-xl font-bold">{getDayName(latest.preferred_day_2)}</div></div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Submit / Update My Preference</CardTitle>
            <CardDescription>
              {latest?.status === "accepted" || latest?.status === "applied"
                ? "Your preference has been accepted. Contact your manager to make changes."
                : latest?.status === "submitted"
                  ? "Your preference is pending review. You may update it until a decision is made."
                  : "Preferences are considered during roster planning and remain subject to coverage needs."}
            </CardDescription>
          </CardHeader>
          {(latest?.status === "accepted" || latest?.status === "applied") ? (
            <CardContent>
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="text-sm font-semibold">Preference locked — accepted by manager. Reach out to your WFM team for changes.</span>
              </div>
            </CardContent>
          ) : (
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Roster Week Start</Label>
              <Input className="mt-2" type="date" value={weekStartDate} onChange={(e) => setWeekStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Preferred Week-Off Day</Label>
              <Select value={String(preferredDay)} onValueChange={(v) => setPreferredDay(Number(v))}>
                <SelectTrigger className="mt-2 bg-white !text-slate-900 [&>span]:!text-slate-900"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white !text-slate-900">
                  {DAYS.map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Alternate Week-Off Day</Label>
              <Select value={alternateDay} onValueChange={setAlternateDay}>
                <SelectTrigger className="mt-2 bg-white !text-slate-900 [&>span]:!text-slate-900"><SelectValue placeholder="Select alternate day" /></SelectTrigger>
                <SelectContent className="bg-white !text-slate-900">
                  <SelectItem value="none">None</SelectItem>
                  {DAYS.filter((d) => d.value !== preferredDay).map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason / Context</Label>
              <Input className="mt-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason" />
            </div>
            <div className="md:col-span-2">
              <Button onClick={() => submitPreference.mutate()} disabled={submitPreference.isPending} className="w-full md:w-auto">
                <Send className="mr-2 h-4 w-4" /> {submitPreference.isPending ? "Submitting..." : latest?.status === "rejected" ? "Resubmit Preference" : "Submit Preference"}
              </Button>
              {submitPreference.isSuccess && <span className="ml-3 text-sm font-semibold text-emerald-700">Preference submitted.</span>}
              {submitPreference.isError && <span className="ml-3 text-sm font-semibold text-red-700">Submission failed.</span>}
            </div>
          </CardContent>
          )}
        </Card>

        {canReview && (
          <Card>
            <CardHeader>
              <CardTitle>Manager / WFM Review</CardTitle>
              <CardDescription>Review scoped process preferences before roster finalization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Process</Label>
                  <Select value={processId} onValueChange={setProcessId}>
                    <SelectTrigger className="mt-2 bg-white !text-slate-900 [&>span]:!text-slate-900"><SelectValue placeholder="Select process" /></SelectTrigger>
                    <SelectContent className="bg-white !text-slate-900">
                      {(processes.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name ?? p.process_code ?? p.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Roster Week Start</Label>
                  <Input className="mt-2" type="date" value={weekStartDate} onChange={(e) => setWeekStartDate(e.target.value)} />
                </div>
              </div>

              {processId && (demandGridQ.data ?? []).some((d) => !d.is_safe) && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 flex items-start gap-3">
                  <span className="shrink-0 mt-0.5 text-rose-600 font-black text-lg">⚠</span>
                  <div>
                    <p className="text-sm font-black text-rose-800">Demand Protection Warning</p>
                    <p className="text-xs text-rose-600 mt-0.5">
                      {(demandGridQ.data ?? []).filter((d) => !d.is_safe).map((d) => d.day_name).join(", ")} — granting more week-offs on these days would drop HC below the minimum requirement. Review before approving.
                    </p>
                  </div>
                </div>
              )}

              {processId && capacityQ.data && capacityQ.data.length > 0 && (
                <div className="rounded-2xl border bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="text-sm font-black text-slate-900">Week-Off Capacity Grid</div>
                    <button
                      disabled={runAllocationMutation.isPending || !processId}
                      onClick={() => { setAllocationMsg(null); runAllocationMutation.mutate(); }}
                      className="flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
                    >
                      {runAllocationMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Run FCFS Allocation
                    </button>
                  </div>
                  {allocationMsg && (
                    <div className={`rounded-xl border p-3 text-sm font-semibold ${allocationMsg.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                      {allocationMsg.text}
                    </div>
                  )}
                  <div className="grid grid-cols-7 gap-1.5">
                    {capacityQ.data.map((slot) => {
                      const pct = slot.max_count && slot.max_count > 0 ? Math.round((slot.allocated / slot.max_count) * 100) : null;
                      const isFull = slot.slots_remaining !== null && slot.slots_remaining <= 0;
                      return (
                        <div key={slot.day_of_week} className={`rounded-2xl border p-3 text-center ${isFull ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
                          <div className="text-xs font-black uppercase text-slate-500">{slot.day_name.slice(0, 3)}</div>
                          <div className={`mt-1 text-2xl font-black ${isFull ? "text-rose-600" : "text-slate-900"}`}>{slot.allocated}</div>
                          <div className="text-xs text-slate-500">/{slot.max_count ?? "∞"}</div>
                          {pct !== null && (
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                              <div className={`h-full rounded-full ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          )}
                          {slot.slots_remaining !== null && (
                            <div className={`mt-1 text-xs font-semibold ${isFull ? "text-rose-600" : "text-emerald-700"}`}>
                              {isFull ? "Full" : `${slot.slots_remaining} left`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {pressure.length > 0 && (
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-900">Preference pressure</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pressure.map(([day, count]) => <Badge key={day} variant="secondary">{getDayName(day)}: {count}</Badge>)}
                  </div>
                </div>
              )}

              <div className="overflow-auto rounded-2xl border">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Employee</th><th>Week</th><th>Preferred</th><th>Alternate</th><th>Status</th><th>#FCFS</th><th>Reason</th><th>Action</th></tr></thead>
                  <tbody>
                    {(teamPreferences.data ?? []).map((pref) => (
                      <tr key={pref.id} className="border-t">
                        <td className="p-3"><b>{pref.employee_name ?? pref.employee_code ?? pref.employee_id}</b><div className="text-xs text-slate-500">{pref.employee_code}</div></td>
                        <td>{pref.week_start_date}</td>
                        <td>{getDayName(pref.preferred_day_1)}</td>
                        <td>{getDayName(pref.preferred_day_2)}</td>
                        <td><Badge className={statusTone[pref.status] ?? statusTone.submitted}>{pref.status}</Badge></td>
                        <td className="text-center text-slate-500">{(pref as WeekOffPreference & { submission_order?: number }).submission_order ?? "—"}</td>
                        <td className="max-w-[220px] truncate">{pref.reason ?? "—"}</td>
                        <td className="space-x-2 py-2">
                          <Button size="sm" variant="outline" disabled={updatePreference.isPending} onClick={() => updatePreference.mutate({ id: pref.id, status: "accepted" })}><ShieldCheck className="mr-1 h-3 w-3" />Accept</Button>
                          <Button size="sm" variant="outline" disabled={updatePreference.isPending} onClick={() => updatePreference.mutate({ id: pref.id, status: "applied" })}><CheckCircle2 className="mr-1 h-3 w-3" />Applied</Button>
                          <Button size="sm" variant="outline" disabled={updatePreference.isPending} onClick={() => updatePreference.mutate({ id: pref.id, status: "rejected" })}><XCircle className="mr-1 h-3 w-3" />Reject</Button>
                        </td>
                      </tr>
                    ))}
                    {processId && !teamPreferences.isLoading && (teamPreferences.data ?? []).length === 0 && <tr><td className="p-6 text-center text-slate-500" colSpan={8}>No preferences found for this process/week.</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
