import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, ChevronRight, Loader2, Search, ShieldAlert, ShieldCheck, ShieldX, Users, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/useDebounce";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import {
  MIN_RAISE_REASON,
  addDaysIso,
  interpretApiError,
  raiseSubmitState,
  type ApiErrorView,
  type EligibilityCheckState,
  type RehireEligibilityCheck,
} from "./rejoinActions";
import { TONE_CLASS, eligibilityLabel, eligibilityTone, fmtDate, plural } from "./rejoinReviewFormat";
import type { RehireVerdict } from "./rejoinTypes";

type InactiveEmployee = {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  employment_status: string;
  active_status?: number;
  date_of_exit?: string;
  branch_name?: string;
  cost_centre_name?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ELIGIBILITY_ICON: Record<string, LucideIcon> = { eligible: ShieldCheck, review: ShieldAlert, blocked: ShieldX };

/** Status + every reason + the gap. Used for the live check and for a refusal returned by /initiate. */
export function EligibilityPanel({ eligibility, gapDays, previousEndDate }: { eligibility: RehireVerdict; gapDays?: number | null; previousEndDate?: string | null }) {
  const Icon = ELIGIBILITY_ICON[eligibility.status] ?? ShieldAlert;
  const ordered = [...eligibility.reasons.filter((r) => r.severity === "blocked"), ...eligibility.reasons.filter((r) => r.severity === "review")];
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", TONE_CLASS[eligibilityTone(eligibility.status)])}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Eligibility: </span>
          {eligibilityLabel(eligibility.status)}
        </span>
        {typeof gapDays === "number" && (
          <span className="text-xs text-muted-foreground">
            Gap: <span className="font-semibold text-foreground">{plural(gapDays, "day")}</span>
            {previousEndDate ? ` since ${fmtDate(previousEndDate)}` : ""}
          </span>
        )}
      </div>
      {ordered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> No eligibility concerns.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ordered.map((r) => (
            <li key={r.code} className={cn("flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs", TONE_CLASS[r.severity === "blocked" ? "bad" : "warn"])}>
              {r.severity === "blocked" ? <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="min-w-0 break-words">
                <span className="font-semibold">{r.severity === "blocked" ? "Blocked" : "Review"}:</span> {r.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Raise a rejoin request (hr / admin / super_admin / manager; /initiate enforces the same roles and,
 * for a manager, that the person reported to them). The eligibility panel is live: it re-checks
 * whenever the employee or the date changes, so a blocked case is visible before anyone types a reason.
 */
export function RaiseRejoinDialog({ open, onOpenChange, onRaised }: { open: boolean; onOpenChange: (open: boolean) => void; onRaised: () => void }) {
  const [step, setStep] = useState<"search" | "form">("search");
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState<InactiveEmployee[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InactiveEmployee | null>(null);
  const [joiningDate, setJoiningDate] = useState("");
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<ApiErrorView | null>(null);

  // Start clean every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep("search");
    setSearch("");
    setEmployees([]);
    setSearched(false);
    setSearchError(null);
    setSelected(null);
    setJoiningDate("");
    setReason("");
    setRefusal(null);
  }, [open]);

  async function searchEmployees() {
    if (!search.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      // recordStatus (not status) is the active/inactive record filter; see the 2026-09-01 fix note
      // that used to sit on this search in NativeEmployeeReactivation.tsx.
      const res = await hrmsApi.get<{ success: boolean; data: InactiveEmployee[] }>(
        `/api/employees?recordStatus=inactive&search=${encodeURIComponent(search.trim())}&limit=20`,
      );
      setEmployees((res.data ?? []).filter((e) => e.employment_status !== "Active" && e.active_status !== 1));
      setSearched(true);
    } catch (err) {
      setSearchError(interpretApiError(err).message || "Failed to search employees");
    } finally {
      setSearchLoading(false);
    }
  }

  function pick(emp: InactiveEmployee) {
    setSelected(emp);
    setStep("form");
    setRefusal(null);
    setJoiningDate(addDaysIso(emp.date_of_exit, 1));
  }

  const debouncedDate = useDebounce(joiningDate, 400);
  const checkEnabled = open && !!selected && ISO_DATE.test(debouncedDate) && debouncedDate === joiningDate;
  const eligibilityQuery = useQuery({
    queryKey: ["rehire-eligibility", selected?.id, debouncedDate],
    queryFn: async ({ signal }) => {
      const res = await hrmsApi.get<{ success?: boolean; data?: RehireEligibilityCheck }>(
        `/api/employees/${encodeURIComponent(selected!.id)}/rehire-eligibility?proposed_joining_date=${encodeURIComponent(debouncedDate)}`,
        undefined,
        signal,
      );
      if (!res?.data) throw new Error("The eligibility check returned nothing.");
      return res.data;
    },
    enabled: checkEnabled,
    retry: false,
    staleTime: 30_000,
  });

  const check: EligibilityCheckState = !checkEnabled
    ? { status: selected && joiningDate ? "loading" : "idle" }
    : eligibilityQuery.isError
      ? { status: "error", error: interpretApiError(eligibilityQuery.error).message }
      : eligibilityQuery.data
        ? { status: "ok", data: eligibilityQuery.data }
        : { status: "loading" };

  const submitState = raiseSubmitState({ employeeId: selected?.id ?? null, joiningDate, reason, check });

  const mutation = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ success?: boolean; message?: string; eligibility?: RehireVerdict }>("/api/employees/reactivation/initiate", {
        employee_id: selected!.id,
        proposed_joining_date: joiningDate,
        reinstatement_reason: reason.trim(),
      }),
    onSuccess: (res) => {
      toast.success(res?.message ?? "Rejoin request raised", { description: "The branch head will review it." });
      onRaised();
      onOpenChange(false);
    },
    onError: (err) => {
      const view = interpretApiError(err);
      setRefusal(view);
      toast.error(view.message);
    },
  });

  const reasonLen = reason.trim().length;
  const name = selected ? `${selected.first_name} ${selected.last_name}`.trim() : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
          {step === "form" && (
            <Button type="button" variant="ghost" size="icon" aria-label="Back to search" onClick={() => setStep("search")} disabled={mutation.isPending}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">{step === "search" ? "Raise a rejoin request" : `Rejoin request for ${name}`}</DialogTitle>
            <DialogDescription className="text-xs">
              {step === "search" ? "Find the former employee (inactive or absconded)." : "The branch head reviews it; their approval makes the employee active again."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {step === "search" && (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void searchEmployees();
                }}
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    className="pl-9"
                    placeholder="Name or employee code"
                    aria-label="Search former employees"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button type="submit" size="sm" disabled={searchLoading || !search.trim()}>
                  {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Search"}
                </Button>
              </form>

              {searchError && (
                <p role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {searchError}
                </p>
              )}

              {employees.length > 0 && (
                <ul className="space-y-2">
                  {employees.map((emp) => (
                    <li key={emp.id}>
                      <button
                        type="button"
                        onClick={() => pick(emp)}
                        className="group flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{emp.first_name} {emp.last_name}</span>
                            <span className="font-mono text-xs text-muted-foreground">{emp.employee_code}</span>
                          </span>
                          <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                            {emp.branch_name && <span>{emp.branch_name}</span>}
                            {emp.cost_centre_name && <span>· {emp.cost_centre_name}</span>}
                            <span className="font-medium text-amber-700 dark:text-amber-400">· {emp.employment_status}</span>
                            {emp.date_of_exit && <span>· Exit {fmtDate(emp.date_of_exit)}</span>}
                          </span>
                        </span>
                        <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {searched && !searchLoading && !searchError && employees.length === 0 && (
                <div className="rounded-lg border-2 border-dashed border-border px-6 py-8 text-center">
                  <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">No former employees found for "{search}".</p>
                </div>
              )}
            </>
          )}

          {step === "form" && selected && (
            <>
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
                <p className="font-semibold">{name}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{selected.employee_code}</span>
                  {selected.date_of_exit && <> · Exit {fmtDate(selected.date_of_exit)}</>}
                  {selected.branch_name && <> · {selected.branch_name}</>}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rejoin-date" className="text-xs">
                  Proposed joining date <span aria-hidden className="text-red-600">*</span>
                </Label>
                <Input
                  id="rejoin-date"
                  type="date"
                  value={joiningDate}
                  onChange={(e) => {
                    setJoiningDate(e.target.value);
                    setRefusal(null);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">Rejoining is only possible within 30 days of the last working day; after that it is fresh ATS onboarding.</p>
              </div>

              <section aria-labelledby="raise-eligibility-title" className="space-y-1.5">
                <h3 id="raise-eligibility-title" className="text-xs font-semibold">Eligibility</h3>
                {refusal?.eligibility ? (
                  <EligibilityPanel eligibility={refusal.eligibility} />
                ) : check.status === "ok" ? (
                  <EligibilityPanel eligibility={check.data.eligibility} gapDays={check.data.gapDays} previousEndDate={check.data.previousEndDate} />
                ) : check.status === "error" ? (
                  <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">Could not check eligibility: {check.error} The server checks again when you submit.</span>
                  </p>
                ) : check.status === "loading" ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking eligibility…
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Pick a date to check eligibility.</p>
                )}
              </section>

              {submitState.mode === "submit" && (
                <div className="space-y-1.5">
                  <Label htmlFor="rejoin-reason" className="text-xs">
                    Reason for the rejoin <span aria-hidden className="text-red-600">*</span>
                  </Label>
                  <Textarea
                    id="rejoin-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setRefusal(null);
                    }}
                    aria-describedby="rejoin-reason-count"
                    placeholder="Why should this person come back? The branch head reads this."
                  />
                  <p id="rejoin-reason-count" className="text-right text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
                    {reasonLen}/{MIN_RAISE_REASON} characters minimum
                  </p>
                </div>
              )}

              {refusal && (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{refusal.message}</span>
                </p>
              )}
            </>
          )}
        </div>

        {step === "form" && selected && (
          <DialogFooter className="flex-col gap-2 border-t border-border px-5 py-4 sm:flex-col sm:space-x-0">
            {submitState.mode === "fresh_onboarding" || refusal?.requiresFreshOnboarding ? (
              <p role="status" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <ShieldX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Needs fresh ATS onboarding: {submitState.why ?? refusal?.message} A rejoin request cannot be raised.</span>
              </p>
            ) : (
              <>
                {submitState.why && <p className="text-xs text-muted-foreground" aria-live="polite">{submitState.why}</p>}
                <Button type="button" className="w-full" disabled={!submitState.canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Submitting…
                    </>
                  ) : (
                    "Raise rejoin request"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
