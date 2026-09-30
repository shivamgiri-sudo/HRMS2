import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Ban, CheckCircle2, Circle, Loader2, PlayCircle, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isOrgWide,
  useCancelComputeRange,
  useComputeRange,
  useComputeRanges,
  useScopeOptions,
  useStartComputeRange,
  type ComputeRangeDay,
  type ComputeRangeJob,
} from "@/hooks/useKpiStudio";
import { MAX_RANGE_DAYS, friendlyError, todayLocal, validateRange } from "./definition-model";

/**
 * Computes several days in one go.
 *
 * The single-day run above cannot refill a feed that was off for three weeks without somebody
 * pressing it twenty-one times. This starts one background run for the whole range and reports
 * each day as it finishes. Preview is ticked by default, because an unticked run overwrites the
 * stored values for every day in the range.
 */

const SELECT_CLASS =
  "h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

function shiftDays(count: number): string {
  const now = new Date();
  return todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + count));
}

function JobStatus({ status }: { status: ComputeRangeJob["status"] | ComputeRangeDay["status"] }) {
  const map = {
    pending: { icon: Circle, text: "Waiting", tone: "text-slate-600" },
    running: { icon: Loader2, text: "Running", tone: "text-sky-800" },
    done: { icon: CheckCircle2, text: "Done", tone: "text-emerald-800" },
    failed: { icon: XCircle, text: "Failed", tone: "text-rose-800" },
    cancelled: { icon: Ban, text: "Cancelled", tone: "text-amber-800" },
  } as const;
  const entry = map[status];
  const Icon = entry.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${entry.tone}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`} aria-hidden="true" />
      {entry.text}
    </span>
  );
}

const sum = (days: ComputeRangeDay[], key: "written" | "no_data" | "errors") =>
  days.reduce((total, day) => total + (day[key] ?? 0), 0);

export function ComputeRangePanel() {
  const processFieldId = useId();
  const fromId = useId();
  const toId = useId();
  const previewId = useId();
  const today = todayLocal();

  const [processId, setProcessId] = useState("");
  const [from, setFrom] = useState(() => shiftDays(-7));
  const [to, setTo] = useState(() => shiftDays(-1));
  const [previewOnly, setPreviewOnly] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const scopeOptions = useScopeOptions();
  const runs = useComputeRanges();
  const start = useStartComputeRange();
  const cancel = useCancelComputeRange();

  const orgWide = isOrgWide(scopeOptions.data);
  const processes = scopeOptions.data?.processes ?? [];
  const processName = (id: string | null) =>
    id ? (processes.find((process) => process.id === id)?.name ?? "one process") : "all processes";

  // A run started earlier (or in another tab) is picked up, so its progress is never orphaned.
  const runningJob = (runs.data ?? []).find((job) => job.status === "running") ?? null;
  const activeJobId = selectedJobId ?? runningJob?.id ?? null;
  const jobQuery = useComputeRange(activeJobId);
  const job = jobQuery.data ?? null;
  const busy = start.isPending || Boolean(runningJob) || job?.status === "running";

  // A saved run changed stored values, so anything showing a KPI number is stale once it ends.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    if (lastStatus.current === "running" && job.status !== "running") {
      void queryClient.invalidateQueries({ queryKey: ["kpi-studio", "compute-ranges"] });
      if (!job.dryRun) void queryClient.invalidateQueries({ queryKey: ["my-kpi"] });
    }
    lastStatus.current = job.status;
  }, [job, queryClient]);

  const range = validateRange(from, to, today);
  const processError = !orgWide && !processId ? "Choose a process." : null;
  const formError = range.message ?? processError;

  async function run() {
    setConfirming(false);
    try {
      const started = await start.mutateAsync({ from, to, process_id: processId || undefined, dry_run: previewOnly });
      setSelectedJobId(started.id);
    } catch {
      // Shown below from start.error.
    }
  }

  function handleStart() {
    setTouched(true);
    start.reset();
    if (formError || busy) return;
    if (previewOnly) void run();
    else setConfirming(true);
  }

  const finished = job ? job.days.filter((day) => day.status === "done" || day.status === "failed").length : 0;
  const total = job?.days.length ?? 0;
  const percent = total ? Math.round((finished / total) * 100) : 0;

  return (
    <section className="space-y-4 border-t border-slate-200 pt-6" aria-labelledby="compute-range-heading">
      <header>
        <h3 id="compute-range-heading" className="text-base font-semibold text-slate-900">
          Compute a range
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Runs the same calculation for every day between two dates, one day at a time. Use it to
          fill in days a data feed missed. Up to {MAX_RANGE_DAYS} days per run.
        </p>
      </header>

      <form
        className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          handleStart();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
          <div>
            <label htmlFor={processFieldId} className="mb-1 block text-xs font-medium text-slate-700">
              Process{orgWide ? "" : " (required)"}
            </label>
            <select
              id={processFieldId}
              value={processId}
              onChange={(event) => setProcessId(event.target.value)}
              className={SELECT_CLASS}
              aria-required={!orgWide}
              disabled={scopeOptions.isLoading}
            >
              <option value="">{scopeOptions.isLoading ? "Loading…" : orgWide ? "All processes" : "Choose a process"}</option>
              {processes.map((process) => (
                <option key={process.id} value={process.id}>
                  {process.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={fromId} className="mb-1 block text-xs font-medium text-slate-700">
              From
            </label>
            <Input id={fromId} type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div>
            <label htmlFor={toId} className="mb-1 block text-xs font-medium text-slate-700">
              To
            </label>
            <Input id={toId} type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor={previewId} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-slate-800">
            <input
              id={previewId}
              type="checkbox"
              checked={previewOnly}
              onChange={(event) => setPreviewOnly(event.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-slate-300"
            />
            Preview only (nothing is saved)
          </label>
          <Button type="submit" disabled={busy}>
            {start.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {previewOnly ? "Start preview" : "Start and save"}
          </Button>
          {!range.message && <span className="text-xs text-slate-500">{range.days} day{range.days === 1 ? "" : "s"}</span>}
        </div>

        {runningJob && (
          <p className="text-xs text-slate-600">A run is in progress. Only one range can run at a time, so wait for it or cancel it.</p>
        )}
        {(range.message || (touched && processError)) && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {range.message ?? processError}
          </p>
        )}
        {start.isError && (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {friendlyError(start.error)}
          </p>
        )}
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite stored KPI values?</AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite stored KPI values for {range.days} day{range.days === 1 ? "" : "s"} for{" "}
              {processName(processId || null)}. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Overwrite and continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {activeJobId && jobQuery.isLoading && <Skeleton className="h-24 w-full" />}
      {activeJobId && jobQuery.isError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {friendlyError(jobQuery.error)}
        </p>
      )}

      {job && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-slate-800">
              <span className="font-medium">
                {job.from} to {job.to}
              </span>{" "}
              · {processName(job.processId)} · {job.dryRun ? "Preview, nothing saved" : "Saving values"}
              <span className="ml-2 align-middle">
                <JobStatus status={job.status} />
              </span>
            </div>
            {job.status === "running" && (
              <Button type="button" size="sm" variant="outline" onClick={() => cancel.mutate(job.id)} disabled={cancel.isPending}>
                {cancel.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                Cancel
              </Button>
            )}
          </div>

          <div>
            <div
              role="progressbar"
              aria-label="Days finished"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={finished}
              aria-valuetext={`${finished} of ${total} days`}
              className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
            >
              <div className="h-full rounded-full bg-indigo-600 transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-600" aria-live="polite">
              {finished} of {total} days finished
              {cancel.isSuccess && job.status === "running" ? ". Cancelling after the day in progress." : ""}
            </p>
          </div>

          {cancel.isError && (
            <p role="alert" className="text-xs text-rose-700">Could not cancel. {friendlyError(cancel.error)}</p>
          )}

          {job.status !== "running" && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800" role="status">
              {job.status === "cancelled" ? "Cancelled. " : job.status === "failed" ? "Every day failed. " : "Finished. "}
              {finished} of {total} days ran: {sum(job.days, "written").toLocaleString()} values{" "}
              {job.dryRun ? "would be written (nothing was saved)" : "written"},{" "}
              {sum(job.days, "no_data").toLocaleString()} with no data, {sum(job.days, "errors").toLocaleString()} calculation errors
              {job.days.some((day) => day.status === "failed")
                ? `, ${job.days.filter((day) => day.status === "failed").length} day(s) failed`
                : ""}
              .
            </p>
          )}

          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[40rem] text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Written</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">No data</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Errors</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Seconds</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Problems</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {job.days.map((day) => (
                  <tr key={day.date} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{day.date}</td>
                    <td className="whitespace-nowrap px-3 py-2"><JobStatus status={day.status} /></td>
                    <td className="px-3 py-2 text-right font-mono">{day.written ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{day.no_data ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{day.errors ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{day.seconds ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {day.message && <span className="block">{day.message}</span>}
                      {(day.source_failures ?? []).map((failure) => (
                        <span key={failure.source_code} className="block">
                          <span className="font-mono">{failure.source_code}</span>: {failure.error}
                        </span>
                      ))}
                      {!day.message && !(day.source_failures ?? []).length && <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-900">Recent runs</h4>
        {runs.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : runs.isError ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Could not load recent runs. {friendlyError(runs.error)}
          </p>
        ) : (runs.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            No range has been run since the server last restarted. Runs you start appear here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[36rem] text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Range</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Process</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Kind</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Started</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(runs.data ?? []).map((entry) => (
                  <tr key={entry.id} className={entry.id === activeJobId ? "bg-indigo-50/60" : undefined}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{entry.from} to {entry.to}</td>
                    <td className="px-3 py-2 text-slate-700">{processName(entry.processId)}</td>
                    <td className="px-3 py-2 text-slate-700">{entry.dryRun ? "Preview" : "Saved"}</td>
                    <td className="whitespace-nowrap px-3 py-2"><JobStatus status={entry.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{new Date(entry.startedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedJobId(entry.id)}
                        aria-pressed={entry.id === activeJobId}
                        className="inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-2 font-medium text-indigo-700 transition-colors hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {entry.id === activeJobId ? "Showing" : "View days"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
