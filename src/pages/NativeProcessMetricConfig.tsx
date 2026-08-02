import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Archive, Loader2, Info } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * What a process measures, under the names that process uses.
 *
 * All 97 processes carrying KPI config hold the identical three metrics with one
 * distinct target between them, because kpi_metric_master.metric_code is
 * globally unique and nothing let a process name its own. This is where that
 * gets fixed, one process at a time.
 *
 * The screen leans on two things the API guarantees and the user cannot see:
 * definitions are effective-dated, and adding one closes the current one the day
 * before. Both are stated in the UI rather than left as a surprise — a config
 * screen that silently supersedes is how people lose work they thought they were
 * editing.
 */

const schema = z.object({
  kind: z.enum(["canonical", "local"]),
  metricId: z.string().optional(),
  localCode: z.string().optional(),
  displayName: z.string().trim().min(1, "What does this process call it?"),
  unit: z.string().optional(),
  direction: z.enum(["higher_is_better", "lower_is_better"]).optional(),
  weightage: z.coerce.number().min(0, "0 or more").max(100, "100 or less"),
  isFatal: z.boolean(),
  effectiveFrom: z.string().min(1, "Pick a start date"),
}).superRefine((v, ctx) => {
  if (v.kind === "canonical" && !v.metricId) {
    ctx.addIssue({ code: "custom", path: ["metricId"], message: "Choose a metric" });
  }
  if (v.kind === "local") {
    // A local metric has no canonical row to inherit from, so it must carry its
    // own unit and direction or nothing can format or score it.
    if (!v.localCode?.trim()) ctx.addIssue({ code: "custom", path: ["localCode"], message: "Give it a code" });
    if (!v.unit?.trim()) ctx.addIssue({ code: "custom", path: ["unit"], message: "Required for a local metric" });
    if (!v.direction) ctx.addIssue({ code: "custom", path: ["direction"], message: "Required for a local metric" });
  }
});

type FormValues = z.infer<typeof schema>;
type ProcessOption = { id: string; process_name: string };
type CatalogMetric = { id: string; metric_code: string; metric_name: string; unit: string; direction: string };
type Definition = {
  id: string; metricCode: string | null; localCode: string | null; displayName: string;
  unit: string | null; direction: string | null; weightage: number; isFatal: boolean;
  comparableAcrossProcesses: boolean;
};

export default function NativeProcessMetricConfig() {
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogMetric[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [processId, setProcessId] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [retiring, setRetiring] = useState<Definition | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: "canonical", displayName: "", weightage: 100, isFatal: false,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    },
  });
  const kind = form.watch("kind");

  useEffect(() => {
    hrmsApi.get<{ data?: ProcessOption[] } | ProcessOption[]>("/api/processes")
      .then((r) => setProcesses((Array.isArray(r) ? r : r?.data) ?? []))
      .catch(() => setProcesses([]));
  }, []);

  async function load(pid: string, on: string) {
    if (!pid) { setDefinitions([]); setCatalog([]); return; }
    const [defs, cat] = await Promise.all([
      hrmsApi.get<{ data: Definition[] }>(`/api/kpi/process-metrics/${pid}?asOf=${on}`).catch(() => ({ data: [] })),
      hrmsApi.get<{ data: CatalogMetric[] }>(`/api/kpi/process-metrics/${pid}/catalog`).catch(() => ({ data: [] })),
    ]);
    setDefinitions(defs?.data ?? []);
    setCatalog(cat?.data ?? []);
  }

  useEffect(() => { void load(processId, asOf); }, [processId, asOf]);

  /**
   * Weights are shown, not enforced. The API does not require 100 either, and a
   * process mid-way through being configured should not be blocked from saving.
   */
  const weightTotal = useMemo(
    () => definitions.reduce((sum, d) => sum + (Number(d.weightage) || 0), 0),
    [definitions],
  );

  async function onSubmit(values: FormValues) {
    setBusy(true); setNotice(null);
    try {
      await hrmsApi.post(`/api/kpi/process-metrics/${processId}`, {
        metricId: values.kind === "canonical" ? values.metricId : null,
        localCode: values.kind === "local" ? values.localCode : null,
        displayName: values.displayName,
        unit: values.kind === "local" ? values.unit : null,
        direction: values.kind === "local" ? values.direction : null,
        weightage: values.weightage,
        isFatal: values.isFatal,
        effectiveFrom: values.effectiveFrom,
      });
      setNotice({ tone: "ok", text: `"${values.displayName}" applies from ${values.effectiveFrom}. Any previous definition for the same metric was closed the day before, so scores already recorded keep their original meaning.` });
      form.reset({ ...form.getValues(), displayName: "", metricId: undefined, localCode: "" });
      await load(processId, asOf);
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message || "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmRetire() {
    if (!retiring) return;
    setBusy(true); setNotice(null);
    try {
      await hrmsApi.delete(`/api/kpi/process-metrics/definition/${retiring.id}?effectiveTo=${asOf}`);
      setNotice({ tone: "ok", text: `"${retiring.displayName}" stops applying after ${asOf}. It is retired, not deleted — scores recorded while it applied still make sense.` });
      setRetiring(null);
      await load(processId, asOf);
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message || "Could not retire" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Process metrics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What this process is measured on, under the name it uses. A metric that maps to the
          shared catalogue rolls up across processes; one that is local to this process does not.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-md border px-4 py-3 text-sm ${
            notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                 : "border-red-200 bg-red-50 text-red-900"}`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        <div>
          <label htmlFor="process" className="text-sm font-medium">Process</label>
          <select
            id="process" value={processId} onChange={(e) => setProcessId(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm cursor-pointer"
          >
            <option value="">Select a process…</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.process_name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="asOf" className="text-sm font-medium">In force on</label>
          <Input id="asOf" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="mt-1" />
        </div>
      </div>

      {processId && (
        <>
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3 text-sm font-medium">
              <span>
                In force on {asOf}
                <span className="ml-2 font-normal text-muted-foreground">
                  {definitions.length} metric{definitions.length === 1 ? "" : "s"} · weights total {weightTotal}
                </span>
              </span>
            </div>
            {definitions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing defined for this process on {asOf}. Until something is, it falls back to
                whatever the shared KPI configuration says — which is the same three metrics every
                other process has.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Called</th>
                      <th scope="col" className="px-4 py-2 font-medium">Maps to</th>
                      <th scope="col" className="px-4 py-2 font-medium w-28">Unit</th>
                      <th scope="col" className="px-4 py-2 font-medium w-24">Weight</th>
                      <th scope="col" className="px-4 py-2 font-medium w-24">Fatal</th>
                      <th scope="col" className="px-4 py-2 w-28"><span className="sr-only">Retire</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {definitions.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="px-4 py-2 font-medium">{d.displayName}</td>
                        <td className="px-4 py-2">
                          {d.metricCode ? (
                            <span className="text-muted-foreground">{d.metricCode}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                              {d.localCode} · this process only
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {d.unit ?? "—"}
                          {d.direction === "lower_is_better" && <span className="ml-1" title="Lower is better">↓</span>}
                        </td>
                        <td className="px-4 py-2">{d.weightage}</td>
                        <td className="px-4 py-2">{d.isFatal ? "Yes" : "—"}</td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="cursor-pointer text-muted-foreground hover:text-destructive"
                            onClick={() => setRetiring(d)}
                          >
                            <Archive className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            Retire
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="rounded-lg border p-4 space-y-4">
              <div className="text-sm font-medium">Add a metric</div>

              <div className="flex gap-4 text-sm">
                {(["canonical", "local"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio" value={k} checked={kind === k}
                      onChange={() => form.setValue("kind", k)} className="cursor-pointer"
                    />
                    {k === "canonical" ? "From the shared catalogue" : "Local to this process"}
                  </label>
                ))}
              </div>

              <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {kind === "canonical"
                    ? "Rolls up across processes, and inherits its unit and direction from the catalogue."
                    : "Stays out of cross-process averages, because a score that means something different per process should not be averaged with one that does not."}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {kind === "canonical" ? (
                  <FormField control={form.control} name="metricId" render={({ field }) => (
                    <FormItem>
                      <label htmlFor="metricId" className="text-sm font-medium">Catalogue metric</label>
                      <FormControl>
                        <select {...field} id="metricId" value={field.value ?? ""}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm cursor-pointer">
                          <option value="">Select…</option>
                          {catalog.map((m) => (
                            <option key={m.id} value={m.id}>{m.metric_name} ({m.metric_code})</option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ) : (
                  <FormField control={form.control} name="localCode" render={({ field }) => (
                    <FormItem>
                      <label htmlFor="localCode" className="text-sm font-medium">Local code</label>
                      <FormControl><Input {...field} id="localCode" placeholder="GREETING_ADHERENCE" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}

                <FormField control={form.control} name="displayName" render={({ field }) => (
                  <FormItem>
                    <label htmlFor="displayName" className="text-sm font-medium">What this process calls it</label>
                    <FormControl><Input {...field} id="displayName" placeholder="CX Score" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {kind === "local" && (
                  <>
                    <FormField control={form.control} name="unit" render={({ field }) => (
                      <FormItem>
                        <label htmlFor="unit" className="text-sm font-medium">Unit</label>
                        <FormControl><Input {...field} id="unit" value={field.value ?? ""} placeholder="percent" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="direction" render={({ field }) => (
                      <FormItem>
                        <label htmlFor="direction" className="text-sm font-medium">Better when</label>
                        <FormControl>
                          <select {...field} id="direction" value={field.value ?? ""}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm cursor-pointer">
                            <option value="">Select…</option>
                            <option value="higher_is_better">Higher</option>
                            <option value="lower_is_better">Lower</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </>
                )}

                <FormField control={form.control} name="weightage" render={({ field }) => (
                  <FormItem>
                    <label htmlFor="weightage" className="text-sm font-medium">Weight</label>
                    <FormControl><Input {...field} id="weightage" type="number" min={0} max={100} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="effectiveFrom" render={({ field }) => (
                  <FormItem>
                    <label htmlFor="effectiveFrom" className="text-sm font-medium">Applies from</label>
                    <FormControl><Input {...field} id="effectiveFrom" type="date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="isFatal" render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} className="cursor-pointer" />
                    </FormControl>
                    Fatal — scoring zero on this fails the whole audit
                  </label>
                </FormItem>
              )} />

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={busy} className="cursor-pointer">
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Add metric
                </Button>
                <p className="text-sm text-muted-foreground">
                  Adding closes any existing definition for the same metric the day before this date,
                  so earlier scores keep their original meaning.
                </p>
              </div>
            </form>
          </Form>
        </>
      )}

      <AlertDialog open={Boolean(retiring)} onOpenChange={(open) => !open && setRetiring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire “{retiring?.displayName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops applying after {asOf}. Nothing is deleted — scores already recorded against it
              stay readable and keep meaning what they meant. You can add a replacement definition
              from a later date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRetire} disabled={busy} className="cursor-pointer">
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
