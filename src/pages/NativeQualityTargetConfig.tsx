import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, PlayCircle, Send, Check, X, Power, Copy, AlertTriangle, History } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The bar each process is judged against.
 *
 * Nothing here invents a target. Quality runs 23.7% to 72.7% across the ten live
 * clients, so a company-wide number would condemn entire processes while
 * excusing others — the page shows the gap and makes someone decide.
 *
 * Two things this screen must not let a user do, because both were possible
 * before the lifecycle existed:
 *
 *  - approve a threshold without having seen who it would coach. The simulation
 *    is a step in the flow, not a button off to one side.
 *  - read a percentage as if it were a score. Thresholds are percentages OF
 *    TARGET, so every one is shown with the absolute score it resolves to.
 *    "90%" and "49.5 out of 55" are the same fact, and only the second is the
 *    one people argue about in a coaching conversation.
 */

const schema = z.object({
  targetScore: z.coerce.number().gt(0, "Above 0").max(100, "100 or less"),
  warningThresholdPct: z.coerce.number().gt(0, "Above 0").max(100, "100 or less"),
  criticalThresholdPct: z.coerce.number().gt(0, "Above 0").max(100, "100 or less"),
  minAuditCount: z.coerce.number().int().min(1, "At least 1"),
  evaluationPeriod: z.enum(["daily", "weekly", "monthly"]),
  effectiveFrom: z.string().min(1, "Pick a start date"),
}).superRefine((v, ctx) => {
  if (!(v.warningThresholdPct > v.criticalThresholdPct)) {
    // Inverted bands make every shortfall read as critical, which is the same
    // as having no bands at all.
    ctx.addIssue({
      code: "custom", path: ["criticalThresholdPct"],
      message: "Critical must sit below warning",
    });
  }
});

type FormValues = z.infer<typeof schema>;
type ProcessOption = { id: string; process_name: string };

type TargetStatus =
  | "draft" | "simulation_reviewed" | "pending_approval" | "approved"
  | "active" | "inactive" | "superseded" | "rejected";

type Target = {
  id: string; processId: string; processName?: string; metricCode: string;
  targetScore: number; warningThresholdPct: number; criticalThresholdPct: number;
  minAuditCount: number; evaluationPeriod: "daily" | "weekly" | "monthly";
  effectiveFrom: string; effectiveTo: string | null;
  status: TargetStatus; approvedBy: string | null; approvedAt: string | null;
};

type Simulation = {
  employeesEvaluated: number; wouldTrigger: number; wouldTriggerPct: number;
  criticalCount: number; warningCount: number; insufficientAudits: number;
  unassessed: number; singleAuditTriggers: number;
  expectedWeeklyCoachingLoad: number; unusuallyHighTriggerRate: boolean;
  windowFrom: string; windowTo: string;
  employees: Array<{
    employeeCode: string; avgQuality: number; auditCount: number;
    ratioOfTarget: number; band: "critical" | "warning" | "ok"; wouldTrigger: boolean;
  }>;
  notes: string[];
};

/** Each status says what it means for the people being measured, not what it is called. */
const STATUS_COPY: Record<TargetStatus, { label: string; tone: string; means: string }> = {
  draft:               { label: "Draft",              tone: "bg-slate-100 text-slate-700",   means: "Governs nothing. Simulate it to move on." },
  simulation_reviewed: { label: "Simulation reviewed", tone: "bg-sky-100 text-sky-800",      means: "Impact has been seen. Ready to submit." },
  pending_approval:    { label: "Awaiting approval",   tone: "bg-amber-100 text-amber-900",  means: "Waiting on a second person. Still governs nothing." },
  approved:            { label: "Approved",            tone: "bg-indigo-100 text-indigo-800",means: "Approved but not yet live. Activate to make it govern." },
  active:              { label: "Active",              tone: "bg-emerald-100 text-emerald-800", means: "This is the bar people are coached against right now." },
  inactive:            { label: "Deactivated",         tone: "bg-slate-100 text-slate-500",  means: "Stopped governing. The coaching it raised still stands." },
  superseded:          { label: "Superseded",          tone: "bg-slate-100 text-slate-500",  means: "Replaced by a later dated target. Kept to explain past scores." },
  rejected:            { label: "Rejected",            tone: "bg-rose-100 text-rose-800",    means: "Sent back with a reason. Edit it to try again." },
};

const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function NativeQualityTargetConfig() {
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [missing, setMissing] = useState<Array<{ processId: string; processName: string; employeesWithQuality: number }>>([]);
  const [processId, setProcessId] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [selected, setSelected] = useState<Target | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "reject" | "deactivate"; target: Target } | null>(null);
  const [reasonText, setReasonText] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      targetScore: 60, warningThresholdPct: 90, criticalThresholdPct: 75,
      minAuditCount: 3, evaluationPeriod: "weekly", effectiveFrom: today(),
    },
  });

  const values = form.watch();

  /**
   * The absolute scores the percentages resolve to. This is the whole reason
   * the preview exists: "warn at 90%" is not a number anybody can argue with
   * until it reads "warn below 49.5 out of 55".
   */
  const preview = useMemo(() => {
    const t = Number(values.targetScore) || 0;
    return {
      warnBelow: round2((t * (Number(values.warningThresholdPct) || 0)) / 100),
      criticalBelow: round2((t * (Number(values.criticalThresholdPct) || 0)) / 100),
    };
  }, [values.targetScore, values.warningThresholdPct, values.criticalThresholdPct]);

  useEffect(() => {
    hrmsApi.get<{ data?: ProcessOption[] } | ProcessOption[]>("/api/processes")
      .then((r) => setProcesses((Array.isArray(r) ? r : r?.data) ?? []))
      .catch(() => setProcesses([]));
    hrmsApi.get<{ data: typeof missing }>("/api/quality-governance/targets/missing")
      .then((r) => setMissing(r?.data ?? []))
      .catch(() => setMissing([]));
  }, []);

  async function load(pid: string) {
    if (!pid) { setTargets([]); setHistory([]); return; }
    const [list, hist] = await Promise.all([
      hrmsApi.get<{ data: Target[] }>(`/api/quality-governance/targets?processId=${pid}`).catch(() => ({ data: [] })),
      hrmsApi.get<{ data: Array<Record<string, unknown>> }>(`/api/quality-governance/targets/${pid}/history`).catch(() => ({ data: [] })),
    ]);
    setTargets(list?.data ?? []);
    setHistory(hist?.data ?? []);
  }

  useEffect(() => { void load(processId); setSimulation(null); setSelected(null); }, [processId]);

  async function act<T>(key: string, fn: () => Promise<T>, ok: string): Promise<T | null> {
    setBusy(key); setNotice(null);
    try {
      const r = await fn();
      setNotice({ tone: "ok", text: ok });
      await load(processId);
      return r;
    } catch (e) {
      // The API's message is the useful one — it says which rule was broken.
      setNotice({ tone: "error", text: (e as { message?: string })?.message ?? "That did not work" });
      return null;
    } finally { setBusy(null); }
  }

  const onCreate = form.handleSubmit(async (v) => {
    await act("create", () => hrmsApi.post("/api/quality-governance/targets", { processId, ...v }),
      "Draft created. Simulate it before submitting — nobody should approve a threshold without seeing who it coaches.");
  });

  async function simulate(t: Target) {
    const r = await act(`sim-${t.id}`,
      () => hrmsApi.post<{ data: { simulation: Simulation } }>(`/api/quality-governance/targets/${t.id}/simulate-review`, {}),
      "Simulated against real history. Review the impact below.");
    if (r?.data?.simulation) { setSimulation(r.data.simulation); setSelected(t); }
  }

  const activeTarget = targets.find((t) => t.status === "active") ?? null;
  const missingHere = missing.find((m) => m.processId === processId);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Quality targets</h1>
        <p className="text-sm text-muted-foreground">
          The bar each process is judged against. Every threshold is a percentage
          of that process's own target, so the same policy reads the same on a
          process aiming at 45 and one aiming at 85.
        </p>
      </header>

      {notice && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                               : "border-rose-200 bg-rose-50 text-rose-900"}`}>
          {notice.text}
        </div>
      )}

      {/* The gap, named. Shown before anything else because a process with
          quality data and no target is silently unjudged. */}
      {missing.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">
                {missing.length} process(es) have quality data and no approved target
              </p>
              <p className="mt-0.5">
                {missing.reduce((n, m) => n + m.employeesWithQuality, 0)} employees are being
                measured and cannot be coached, because there is nothing to measure them against.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missing.slice(0, 12).map((m) => (
                  <button
                    key={m.processId}
                    type="button"
                    onClick={() => setProcessId(m.processId)}
                    className="rounded border border-amber-300 bg-white/70 px-2 py-0.5 text-xs hover:bg-white"
                  >
                    {m.processName} ({m.employeesWithQuality})
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Process</label>
        <select
          className="w-full md:w-96 h-9 rounded-md border bg-background px-3 text-sm"
          value={processId}
          onChange={(e) => setProcessId(e.target.value)}
        >
          <option value="">Choose a process…</option>
          {processes.map((p) => <option key={p.id} value={p.id}>{p.process_name}</option>)}
        </select>
        {processId && missingHere && (
          <p className="text-xs text-amber-800">
            {missingHere.employeesWithQuality} employees on this process have quality data and no target.
          </p>
        )}
      </div>

      {processId && (
        <>
          {/* Current state, stated plainly. */}
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-medium mb-2">What governs this process today</h2>
            {activeTarget ? (
              <p className="text-sm">
                Target <strong>{activeTarget.targetScore}</strong> — warns below{" "}
                <strong>{round2(activeTarget.targetScore * activeTarget.warningThresholdPct / 100)}</strong>{" "}
                ({activeTarget.warningThresholdPct}%), critical below{" "}
                <strong>{round2(activeTarget.targetScore * activeTarget.criticalThresholdPct / 100)}</strong>{" "}
                ({activeTarget.criticalThresholdPct}%), on at least{" "}
                <strong>{activeTarget.minAuditCount}</strong> audits per {activeTarget.evaluationPeriod.replace("ly", "")}.
                Effective from {activeTarget.effectiveFrom}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing. No approved target is in force, so no coaching can be raised for
                this process — the evaluator declines rather than guessing a bar.
              </p>
            )}
          </section>

          {/* Propose a new one. */}
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-medium mb-3">
              {activeTarget ? "Propose a replacement" : "Set the first target"}
            </h2>
            <Form {...form}>
              <form onSubmit={onCreate} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField control={form.control} name="targetScore" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target score</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="warningThresholdPct" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warning (% of target)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">Warns below {preview.warnBelow}</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="criticalThresholdPct" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Critical (% of target)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">Critical below {preview.criticalBelow}</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="minAuditCount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum audits</FormLabel>
                      <FormControl><Input type="number" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">
                        Below this, reported as insufficient evidence rather than judged.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="evaluationPeriod" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Evaluation period</FormLabel>
                      <FormControl>
                        <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" {...field}>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="effectiveFrom" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effective from</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">
                        A future date is allowed and changes nothing until it arrives.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* The same numbers, as scores. */}
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  On a target of <strong>{values.targetScore || 0}</strong>: a warning below{" "}
                  <strong>{preview.warnBelow}</strong>, critical below{" "}
                  <strong>{preview.criticalBelow}</strong>, judged on at least{" "}
                  <strong>{values.minAuditCount || 0}</strong> assessed audits.
                </div>

                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create draft
                </Button>
              </form>
            </Form>
          </section>

          {/* Versions and their actions. */}
          <section className="rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-sm font-medium">Versions</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory((s) => !s)}>
                <History className="h-4 w-4 mr-1.5" />
                {showHistory ? "Hide" : "Show"} change history
              </Button>
            </div>

            {targets.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No target has ever been configured for this process.
              </p>
            ) : (
              <ul className="divide-y">
                {targets.map((t) => {
                  const copy = STATUS_COPY[t.status];
                  return (
                    <li key={t.id} className="px-4 py-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${copy.tone}`}>
                          {copy.label}
                        </span>
                        <span className="text-sm">
                          Target {t.targetScore} · warns below{" "}
                          {round2(t.targetScore * t.warningThresholdPct / 100)} ({t.warningThresholdPct}%) ·
                          critical below {round2(t.targetScore * t.criticalThresholdPct / 100)} ({t.criticalThresholdPct}%)
                        </span>
                        <span className="text-xs text-muted-foreground">
                          from {t.effectiveFrom}{t.effectiveTo ? ` to ${t.effectiveTo}` : ""}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{copy.means}</p>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {t.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={busy === `sim-${t.id}`}
                            onClick={() => void simulate(t)}>
                            {busy === `sim-${t.id}`
                              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
                            Simulate impact
                          </Button>
                        )}
                        {t.status === "simulation_reviewed" && (
                          <Button size="sm" disabled={busy === `sub-${t.id}`}
                            onClick={() => void act(`sub-${t.id}`,
                              () => hrmsApi.post(`/api/quality-governance/targets/${t.id}/submit`, {}),
                              "Submitted for approval. A second person has to approve it.")}>
                            <Send className="h-3.5 w-3.5 mr-1.5" /> Submit for approval
                          </Button>
                        )}
                        {t.status === "pending_approval" && (
                          <>
                            <Button size="sm" disabled={busy === `app-${t.id}`}
                              onClick={() => void act(`app-${t.id}`,
                                () => hrmsApi.post(`/api/quality-governance/targets/${t.id}/approve`, {}),
                                "Approved. Activate it to make it govern.")}>
                              <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline"
                              onClick={() => { setConfirm({ kind: "reject", target: t }); setReasonText(""); }}>
                              <X className="h-3.5 w-3.5 mr-1.5" /> Reject
                            </Button>
                          </>
                        )}
                        {t.status === "approved" && (
                          <Button size="sm" disabled={busy === `act-${t.id}`}
                            onClick={() => void act(`act-${t.id}`,
                              () => hrmsApi.post(`/api/quality-governance/targets/${t.id}/activate`, {}),
                              "Active. This is now the bar this process is coached against.")}>
                            <Power className="h-3.5 w-3.5 mr-1.5" /> Activate
                          </Button>
                        )}
                        {t.status === "active" && (
                          <Button size="sm" variant="outline"
                            onClick={() => { setConfirm({ kind: "deactivate", target: t }); setReasonText(""); }}>
                            <Power className="h-3.5 w-3.5 mr-1.5" /> Deactivate
                          </Button>
                        )}
                        {/* Clone is the way to revise anything already live or
                            historical — those rows still explain past coaching. */}
                        <Button size="sm" variant="ghost"
                          onClick={() => {
                            form.reset({
                              targetScore: t.targetScore,
                              warningThresholdPct: t.warningThresholdPct,
                              criticalThresholdPct: t.criticalThresholdPct,
                              minAuditCount: t.minAuditCount,
                              evaluationPeriod: t.evaluationPeriod,
                              effectiveFrom: today(),
                            });
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}>
                          <Copy className="h-3.5 w-3.5 mr-1.5" /> Clone into the form
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Impact. Deliberately below the version it belongs to. */}
          {simulation && selected && (
            <section className="rounded-lg border p-4 space-y-3">
              <h2 className="text-sm font-medium">
                Impact of target {selected.targetScore} — {simulation.windowFrom} to {simulation.windowTo}
              </h2>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Employees judged" value={simulation.employeesEvaluated} />
                <Stat label="Would be coached" value={`${simulation.wouldTrigger} (${simulation.wouldTriggerPct}%)`}
                      tone={simulation.unusuallyHighTriggerRate ? "warn" : undefined} />
                <Stat label="Sessions per week" value={simulation.expectedWeeklyCoachingLoad} />
                <Stat label="Too few audits to judge" value={simulation.insufficientAudits} />
              </div>

              {simulation.notes.map((n, i) => (
                <p key={i} className="rounded-md bg-muted/50 px-3 py-2 text-sm">{n}</p>
              ))}

              {simulation.employees.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pr-3">Employee</th>
                        <th className="py-1.5 pr-3">Quality</th>
                        <th className="py-1.5 pr-3">Audits</th>
                        <th className="py-1.5 pr-3">% of target</th>
                        <th className="py-1.5">Coached?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulation.employees.map((e) => (
                        <tr key={e.employeeCode} className="border-t">
                          <td className="py-1.5 pr-3">{e.employeeCode}</td>
                          <td className="py-1.5 pr-3">{e.avgQuality}</td>
                          <td className="py-1.5 pr-3">{e.auditCount}</td>
                          <td className="py-1.5 pr-3">{e.ratioOfTarget}%</td>
                          <td className="py-1.5">
                            {e.wouldTrigger
                              ? <span className="text-rose-700">Yes — {e.band}</span>
                              : <span className="text-muted-foreground">No</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {showHistory && (
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-medium mb-2">Change history</h2>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has changed yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {history.map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-2 border-b pb-1.5">
                      <span className="font-medium">{String(h.action)}</span>
                      <span className="text-muted-foreground">{String(h.created_at ?? "").slice(0, 19)}</span>
                      {h.reason ? <span className="text-muted-foreground">— {String(h.reason)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {/* Rejecting and deactivating both demand a reason, because the API does
          and because the next person needs to know why. */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "reject" ? "Reject this target?" : "Deactivate this target?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "reject"
                ? "It goes back to its author, who can edit and resubmit it."
                : "It stops governing. The coaching already raised under it stays, and still points at this policy."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            placeholder="Reason (required)"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reasonText.trim()}
              onClick={() => {
                const c = confirm!;
                void act(`${c.kind}-${c.target.id}`,
                  () => hrmsApi.post(
                    `/api/quality-governance/targets/${c.target.id}/${c.kind === "reject" ? "reject" : "deactivate"}`,
                    { reason: reasonText.trim() },
                  ),
                  c.kind === "reject" ? "Rejected, with the reason recorded." : "Deactivated.");
                setConfirm(null);
              }}
            >
              {confirm?.kind === "reject" ? "Reject" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "warn" ? "border-amber-300 bg-amber-50" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
