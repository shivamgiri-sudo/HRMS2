import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CalendarDays, CheckCircle2, Loader2, Play, Send, ShieldCheck, XCircle } from "lucide-react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { cn, formatISTDate } from "@/lib/utils";

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

const STATUS_STEPS = [
  { key: "submitted", label: "Submitted", Icon: Send },
  { key: "accepted", label: "Accepted", Icon: ShieldCheck },
  { key: "applied", label: "Applied", Icon: CheckCircle2 },
];

const stepOrder: Record<string, number> = { submitted: 0, accepted: 1, applied: 2 };

const weekOffSchema = z
  .object({
    weekStartDate: z.string().min(1, "Week start date is required"),
    preferredDay: z.number({ required_error: "Select a preferred day" }).min(0).max(6),
    alternateDay: z.number().min(0).max(6).nullable(),
    reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
  })
  .refine((d) => d.alternateDay === null || d.alternateDay !== d.preferredDay, {
    message: "Alternate day must differ from preferred day",
    path: ["alternateDay"],
  });

type FormValues = z.infer<typeof weekOffSchema>;

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
  submission_order?: number;
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

function snapToMonday(dateStr: string): string {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  if (day === 1) return dateStr;
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export default function NativeWeekOffPreferences() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { roleKeys } = useWorkforceAccess();
  const canReview = roleKeys.some((role) =>
    ["admin", "hr", "wfm", "manager", "assistant_manager", "tl"].includes(role)
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(weekOffSchema),
    defaultValues: {
      weekStartDate: nextMonday(),
      preferredDay: 0,
      alternateDay: null,
      reason: "",
    },
  });

  const watchedPreferredDay = form.watch("preferredDay");

  // Manager section filter state — separate from the submission form
  const [filterWeekStart, setFilterWeekStart] = useState(nextMonday());
  const [processId, setProcessId] = useState("");
  const [allocationMsg, setAllocationMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
    queryKey: ["team-weekoff-preferences", processId, filterWeekStart],
    enabled: canReview && !!processId,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate: filterWeekStart });
      const res = await hrmsApi.get<{ data: WeekOffPreference[] }>(`/api/roster-gov/weekoff-preferences?${qs}`);
      return res.data ?? [];
    },
  });

  const capacityQ = useQuery({
    queryKey: ["weekoff-capacity", processId, filterWeekStart],
    enabled: canReview && !!processId && !!filterWeekStart,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate: filterWeekStart });
      return (await hrmsApi.get<{ data: CapacitySlot[] }>(`/api/roster-gov/weekoff/capacity?${qs}`)).data ?? [];
    },
  });

  const demandGridQ = useQuery({
    queryKey: ["weekoff-demand-grid", processId, filterWeekStart],
    enabled: canReview && !!processId && !!filterWeekStart,
    queryFn: async () => {
      const qs = new URLSearchParams({ processId, weekStartDate: filterWeekStart });
      return (
        await hrmsApi.get<{
          success: boolean;
          data: Array<{
            day_of_week: number;
            day_name: string;
            min_hc_required: number;
            is_safe: boolean;
            max_weekoff_allowed: number | null;
            current_allocated: number;
          }>;
        }>(`/api/wfm/weekoff/day-rules/capacity-grid?${qs}`)
      ).data ?? [];
    },
  });

  const submitPreference = useMutation({
    mutationFn: async (values: FormValues) =>
      hrmsApi.post("/api/roster-gov/weekoff-preferences", {
        weekStartDate: values.weekStartDate,
        preferredDay1: values.preferredDay,
        preferredDay2: values.alternateDay ?? null,
        reason: values.reason?.trim() || null,
      }),
    onSuccess: () => {
      form.reset({ weekStartDate: nextMonday(), preferredDay: 0, alternateDay: null, reason: "" });
      toast({ title: "Preference submitted", description: "Your week-off preference has been recorded." });
      qc.invalidateQueries({ queryKey: ["my-weekoff-preferences"] });
      qc.invalidateQueries({ queryKey: ["team-weekoff-preferences"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Submission failed",
        description: err.message || "Could not submit preference.",
        variant: "destructive",
      });
    },
  });

  const updatePreference = useMutation({
    mutationFn: async ({ id, status, remarks }: { id: string; status: string; remarks?: string }) =>
      hrmsApi.patch(`/api/roster-gov/weekoff-preferences/${id}`, { status, remarks }),
    onSuccess: () => {
      toast({ title: "Preference updated" });
      qc.invalidateQueries({ queryKey: ["team-weekoff-preferences"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const runAllocationMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ data: { allocated: number; waitlisted: number; failed: number } }>(
        "/api/roster-gov/weekoff/run-allocation",
        { processId, weekStartDate: filterWeekStart }
      ),
    onSuccess: (res) => {
      const d = (res as any).data ?? res;
      setAllocationMsg({
        type: "success",
        text: `FCFS complete — allocated: ${d.allocated}, waitlisted: ${d.waitlisted}, failed: ${d.failed}`,
      });
      void qc.invalidateQueries({ queryKey: ["team-weekoff-preferences", processId, filterWeekStart] });
      void qc.invalidateQueries({ queryKey: ["weekoff-capacity", processId, filterWeekStart] });
    },
    onError: (err: Error) => setAllocationMsg({ type: "error", text: err.message ?? "Allocation failed." }),
  });

  const latest = myPreferences[0];
  const currentStepIdx = latest
    ? latest.status === "rejected"
      ? -1
      : (stepOrder[latest.status] ?? 0)
    : -1;
  const isLocked = latest?.status === "accepted" || latest?.status === "applied";

  const pressure = useMemo(() => {
    const counts = new Map<number, number>();
    for (const pref of teamPreferences.data ?? [])
      counts.set(pref.preferred_day_1, (counts.get(pref.preferred_day_1) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [teamPreferences.data]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-3xl bg-gradient-to-r from-green-600 to-teal-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-10 w-10" />
            <div>
              <h1 className="text-3xl font-black">Week-Off Preferences</h1>
              <p className="mt-1 text-sm opacity-90">
                Submit, review, and apply weekly off preferences for roster planning.
              </p>
            </div>
          </div>
        </div>

        <RoleInsightsPanel roles={roleKeys} title="Week-off planning insights" />

        {/* Latest Preference Card with Status Stepper */}
        {latest && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Your Latest Preference</CardTitle>
                  <CardDescription>Submitted on {formatISTDate(latest.created_at)}</CardDescription>
                </div>
                {latest.status === "rejected" && (
                  <Badge className={statusTone.rejected}>
                    <XCircle className="mr-1 h-4 w-4" />
                    Rejected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {latest.status !== "rejected" ? (
                <div className="flex items-center">
                  {STATUS_STEPS.map((step, idx) => {
                    const done = idx <= currentStepIdx;
                    const active = idx === currentStepIdx;
                    return (
                      <div key={step.key} className="flex items-center flex-1 last:flex-none">
                        <div
                          className={cn(
                            "flex flex-col items-center gap-1 min-w-[72px]",
                            done ? "text-emerald-700" : "text-slate-400"
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
                              active
                                ? "border-emerald-500 bg-emerald-500 text-white shadow-md"
                                : done
                                ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                                : "border-slate-200 bg-white text-slate-400"
                            )}
                          >
                            <step.Icon className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-semibold">{step.label}</span>
                        </div>
                        {idx < STATUS_STEPS.length - 1 && (
                          <div
                            className={cn(
                              "h-0.5 flex-1 mx-2 rounded-full mb-4",
                              idx < currentStepIdx ? "bg-emerald-400" : "bg-slate-200"
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
                  <XCircle className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Preference rejected</p>
                    {latest.manager_remarks && (
                      <p className="mt-0.5 text-xs text-rose-600">{latest.manager_remarks}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium text-muted-foreground">Week Start</div>
                  <div className="mt-2 text-xl font-bold">{latest.week_start_date}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium text-muted-foreground">Preferred Day</div>
                  <div className="mt-2 text-xl font-bold">{getDayName(latest.preferred_day_1)}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium text-muted-foreground">Alternate Day</div>
                  <div className="mt-2 text-xl font-bold">{getDayName(latest.preferred_day_2)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit / Update Form Card */}
        <Card>
          <CardHeader>
            <CardTitle>Submit / Update My Preference</CardTitle>
            <CardDescription>
              {isLocked
                ? "Your preference has been accepted. Contact your manager to make changes."
                : latest?.status === "submitted"
                ? "Your preference is pending review. You may update it until a decision is made."
                : "Preferences are considered during roster planning and remain subject to coverage needs."}
            </CardDescription>
          </CardHeader>
          {isLocked ? (
            <CardContent>
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="text-sm font-semibold">
                  Preference locked — accepted by manager. Reach out to your WFM team for changes.
                </span>
              </div>
            </CardContent>
          ) : (
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((v) => submitPreference.mutate(v))}
                  className="space-y-6"
                >
                  {/* Week Start Date */}
                  <FormField
                    control={form.control}
                    name="weekStartDate"
                    render={({ field }) => (
                      <FormItem className="max-w-xs">
                        <FormLabel>
                          Roster Week Start <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value}
                            onChange={(e) => field.onChange(snapToMonday(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>Auto-snaps to the nearest Monday.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Preferred Day — pill toggle */}
                  <FormField
                    control={form.control}
                    name="preferredDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Preferred Week-Off Day <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {DAYS.map((day) => (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => field.onChange(day.value)}
                                className={cn(
                                  "rounded-full px-4 py-1.5 text-sm font-semibold border transition-all",
                                  field.value === day.value
                                    ? "bg-green-600 text-white border-green-600 shadow-sm"
                                    : "bg-white text-slate-600 border-slate-300 hover:border-green-400 hover:text-green-700"
                                )}
                              >
                                {day.label.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Alternate Day — pill toggle with None */}
                  <FormField
                    control={form.control}
                    name="alternateDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Alternate Week-Off Day{" "}
                          <span className="text-slate-400 font-normal text-xs">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => field.onChange(null)}
                              className={cn(
                                "rounded-full px-4 py-1.5 text-sm font-semibold border transition-all",
                                field.value === null
                                  ? "bg-slate-700 text-white border-slate-700"
                                  : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                              )}
                            >
                              None
                            </button>
                            {DAYS.map((day) => {
                              const isDisabled = day.value === watchedPreferredDay;
                              const isSelected = field.value === day.value;
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => field.onChange(day.value)}
                                  className={cn(
                                    "rounded-full px-4 py-1.5 text-sm font-semibold border transition-all",
                                    isDisabled
                                      ? "opacity-30 cursor-not-allowed bg-white text-slate-400 border-slate-200"
                                      : isSelected
                                      ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                                      : "bg-white text-slate-600 border-slate-300 hover:border-teal-400 hover:text-teal-700"
                                  )}
                                >
                                  {day.label.slice(0, 3)}
                                </button>
                              );
                            })}
                          </div>
                        </FormControl>
                        <FormDescription>
                          Grayed-out days match your primary choice. Leave as None if no alternate is needed.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Reason */}
                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem className="max-w-lg">
                        <FormLabel>
                          Reason / Context{" "}
                          <span className="text-slate-400 font-normal text-xs">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. family commitment, commute schedule"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>Max 500 characters.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={submitPreference.isPending}
                    className="w-full sm:w-auto"
                  >
                    {submitPreference.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        {latest?.status === "rejected" ? "Resubmit Preference" : "Submit Preference"}
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          )}
        </Card>

        {/* Manager / WFM Review */}
        {canReview && (
          <Card>
            <CardHeader>
              <CardTitle>Manager / WFM Review</CardTitle>
              <CardDescription>
                Review scoped process preferences before roster finalization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filter bar */}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Process</Label>
                  <Select value={processId} onValueChange={setProcessId}>
                    <SelectTrigger className="mt-2 bg-white !text-slate-900 [&>span]:!text-slate-900">
                      <SelectValue placeholder="Select process" />
                    </SelectTrigger>
                    <SelectContent className="bg-white !text-slate-900">
                      {(processes.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.process_name ?? p.process_code ?? p.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Roster Week Start</Label>
                  <Input
                    className="mt-2"
                    type="date"
                    value={filterWeekStart}
                    onChange={(e) => setFilterWeekStart(snapToMonday(e.target.value))}
                  />
                </div>
              </div>

              {/* Demand Protection Warning */}
              {processId && (demandGridQ.data ?? []).some((d) => !d.is_safe) && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 flex items-start gap-3">
                  <span className="shrink-0 mt-0.5 text-rose-600 font-black text-lg">⚠</span>
                  <div>
                    <p className="text-sm font-black text-rose-800">Demand Protection Warning</p>
                    <p className="mt-0.5 text-xs text-rose-600">
                      {(demandGridQ.data ?? [])
                        .filter((d) => !d.is_safe)
                        .map((d) => d.day_name)
                        .join(", ")}{" "}
                      — granting more week-offs on these days would drop HC below the minimum requirement. Review
                      before approving.
                    </p>
                  </div>
                </div>
              )}

              {/* Capacity Grid */}
              {processId && capacityQ.data && capacityQ.data.length > 0 && (
                <div className="rounded-2xl border bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="text-sm font-black text-slate-900">Week-Off Capacity Grid</div>
                    <button
                      disabled={runAllocationMutation.isPending || !processId}
                      onClick={() => {
                        setAllocationMsg(null);
                        runAllocationMutation.mutate();
                      }}
                      className="flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
                    >
                      {runAllocationMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Run FCFS Allocation
                    </button>
                  </div>

                  {allocationMsg && (
                    <div
                      className={cn(
                        "rounded-xl border p-3 text-sm font-semibold",
                        allocationMsg.type === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800"
                      )}
                    >
                      {allocationMsg.text}
                    </div>
                  )}

                  <div className="grid grid-cols-7 gap-1.5">
                    {capacityQ.data.map((slot) => {
                      const pct =
                        slot.max_count && slot.max_count > 0
                          ? Math.round((slot.allocated / slot.max_count) * 100)
                          : null;
                      const isFull = slot.slots_remaining !== null && slot.slots_remaining <= 0;
                      return (
                        <div
                          key={slot.day_of_week}
                          className={cn(
                            "rounded-2xl border p-3 text-center",
                            isFull ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"
                          )}
                        >
                          <div className="text-xs font-black uppercase text-slate-500">
                            {slot.day_name.slice(0, 3)}
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-2xl font-black",
                              isFull ? "text-rose-600" : "text-slate-900"
                            )}
                          >
                            {slot.allocated}
                          </div>
                          <div className="text-xs text-slate-500">/{slot.max_count ?? "∞"}</div>
                          {pct !== null && (
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-400"
                                )}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          )}
                          {slot.slots_remaining !== null && (
                            <div
                              className={cn(
                                "mt-1 text-xs font-semibold",
                                isFull ? "text-rose-600" : "text-emerald-700"
                              )}
                            >
                              {isFull ? "Full" : `${slot.slots_remaining} left`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Preference pressure */}
              {pressure.length > 0 && (
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-900">Preference pressure</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pressure.map(([day, count]) => (
                      <Badge key={day} variant="secondary">
                        {getDayName(day)}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Preferences Table */}
              <div className="overflow-auto rounded-2xl border">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="p-3">Employee</th>
                      <th>Week</th>
                      <th>Preferred</th>
                      <th>Alternate</th>
                      <th>Status</th>
                      <th>#FCFS</th>
                      <th>Reason</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(teamPreferences.data ?? []).map((pref) => (
                      <tr key={pref.id} className="border-t">
                        <td className="p-3">
                          <b>{pref.employee_name ?? pref.employee_code ?? pref.employee_id}</b>
                          <div className="text-xs text-slate-500">{pref.employee_code}</div>
                        </td>
                        <td>{pref.week_start_date}</td>
                        <td>{getDayName(pref.preferred_day_1)}</td>
                        <td>{getDayName(pref.preferred_day_2)}</td>
                        <td>
                          <Badge className={statusTone[pref.status] ?? statusTone.submitted}>
                            {pref.status}
                          </Badge>
                        </td>
                        <td className="text-center text-slate-500">{pref.submission_order ?? "—"}</td>
                        <td
                          className="max-w-[220px] truncate"
                          title={pref.reason ?? undefined}
                        >
                          {pref.reason ?? "—"}
                        </td>
                        <td className="space-x-2 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatePreference.isPending}
                            onClick={() => updatePreference.mutate({ id: pref.id, status: "accepted" })}
                          >
                            <ShieldCheck className="mr-1 h-3 w-3" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatePreference.isPending}
                            onClick={() => updatePreference.mutate({ id: pref.id, status: "applied" })}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Applied
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatePreference.isPending}
                            onClick={() => updatePreference.mutate({ id: pref.id, status: "rejected" })}
                          >
                            <XCircle className="mr-1 h-3 w-3" />
                            Reject
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {processId && !teamPreferences.isLoading && (teamPreferences.data ?? []).length === 0 && (
                      <tr>
                        <td className="p-6 text-center text-slate-500" colSpan={8}>
                          No preferences found for this process/week.
                        </td>
                      </tr>
                    )}
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
