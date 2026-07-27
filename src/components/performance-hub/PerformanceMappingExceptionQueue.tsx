import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Link2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  PaginatedMappingExceptions,
  PerformanceDataset,
  PerformanceMappingException,
  PerformanceReferenceData,
} from "@/types/performanceIngestion";

type ResolutionAction = "map_employee" | "map_process" | "resolve" | "ignore";

type ResolutionForm = {
  action: ResolutionAction;
  employeeId: string;
  processId: string;
  branchId: string;
  identifierType: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
};

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultAction(exception: PerformanceMappingException | null): ResolutionAction {
  if (exception?.exceptionType === "employee_unmapped") return "map_employee";
  if (exception?.exceptionType === "process_unmapped") return "map_process";
  return "resolve";
}

function blankResolution(exception: PerformanceMappingException | null): ResolutionForm {
  return {
    action: defaultAction(exception),
    employeeId: "",
    processId: "",
    branchId: "",
    identifierType: "client_login",
    effectiveFrom: localDate(new Date()),
    effectiveTo: "",
    notes: "",
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PerformanceMappingExceptionQueue({
  dataset,
  reference,
  canResolve,
}: {
  dataset: PerformanceDataset | null;
  reference: PerformanceReferenceData | undefined;
  canResolve: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState<PerformanceMappingException | null>(null);
  const [form, setForm] = useState<ResolutionForm>(() => blankResolution(null));

  useEffect(() => {
    if (!selected) return;
    setForm(blankResolution(selected));
  }, [selected]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ status, page: "1", pageSize: "50" });
    if (dataset?.id) params.set("datasetId", dataset.id);
    return params.toString();
  }, [dataset?.id, status]);

  const exceptionsQuery = useQuery({
    queryKey: ["performance-hub", "ingestion", "mapping-exceptions", dataset?.id ?? "all", status],
    queryFn: async () => (
      await hrmsApi.get<{ success: true; data: PaginatedMappingExceptions }>(
        `/api/performance-hub/ingestion/mapping-exceptions?${queryString}`,
      )
    ).data,
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a mapping exception first");
      return hrmsApi.post(`/api/performance-hub/ingestion/mapping-exceptions/${selected.id}/resolve`, {
        action: form.action,
        employeeId: form.employeeId || null,
        processId: form.processId || null,
        branchId: form.branchId || null,
        identifierType: form.identifierType || null,
        effectiveFrom: form.effectiveFrom || null,
        effectiveTo: form.effectiveTo || null,
        notes: form.notes || null,
      });
    },
    onSuccess: async () => {
      toast.success("Mapping exception resolved");
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "mapping-exceptions"] }),
        queryClient.invalidateQueries({ queryKey: ["performance-hub", "ingestion", "runs"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const actionValid = form.action === "map_employee"
    ? Boolean(form.employeeId)
    : form.action === "map_process"
      ? Boolean(form.processId)
      : true;

  return (
    <section className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-0)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-hairline)] p-4">
        <div>
          <h3 className="font-semibold text-[var(--text-primary)]">Mapping exceptions</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Resolve external employee, process, and metric identifiers before publishing corrected data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Mapping exception status"
            className="h-10 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => void exceptionsQuery.refetch()} disabled={exceptionsQuery.isFetching}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${exceptionsQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {exceptionsQuery.isLoading ? (
        <p className="p-6 text-sm text-[var(--text-muted)]">Loading mapping exceptions…</p>
      ) : exceptionsQuery.isError ? (
        <div className="flex items-start gap-3 p-6 text-sm text-[var(--status-absent)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Mapping exceptions could not be loaded.</p>
            <p className="mt-1">{exceptionsQuery.error.message}</p>
          </div>
        </div>
      ) : !exceptionsQuery.data?.rows.length ? (
        <div className="flex items-center gap-3 p-6 text-sm text-[var(--text-secondary)]">
          <CheckCircle2 className="h-5 w-5 text-[var(--status-present)]" aria-hidden="true" />
          No {status} mapping exceptions exist{dataset ? ` for ${dataset.datasetName}` : " in your scope"}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-1)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-4 py-3 font-semibold">Exception</th>
                <th className="px-4 py-3 font-semibold">External identifier</th>
                <th className="px-4 py-3 font-semibold">Detail</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)]">
              {exceptionsQuery.data.rows.map((exception) => (
                <tr key={exception.id} className="align-top hover:bg-[var(--surface-1)]/70">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--text-primary)]">{exception.datasetName}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{exception.sourceEntity ?? exception.sourceSystem}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full border border-[var(--status-absent)]/30 bg-[var(--status-absent)]/10 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--status-absent)]">
                      {exception.exceptionType.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="max-w-56 break-all px-4 py-3 font-mono text-xs text-[var(--text-primary)]">{exception.externalIdentifier || "—"}</td>
                  <td className="max-w-md px-4 py-3 text-[var(--text-secondary)]">
                    <p className="line-clamp-3 whitespace-pre-line">{exception.detail}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">{formatDate(exception.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {status === "open" && canResolve && (
                      <Button variant="outline" size="sm" onClick={() => setSelected(exception)}>
                        <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resolve mapping exception</DialogTitle>
            <DialogDescription>
              {selected?.externalIdentifier} from {selected?.datasetName}. The mapping is effective-dated and limited to your authorised scope.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="exception-resolution-action">Resolution action</Label>
              <select
                id="exception-resolution-action"
                className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm"
                value={form.action}
                onChange={(event) => setForm((current) => ({ ...current, action: event.target.value as ResolutionAction }))}
              >
                <option value="map_employee">Map to HRMS employee</option>
                <option value="map_process">Map to HRMS process</option>
                <option value="resolve">Resolve after external/KPI correction</option>
                <option value="ignore">Ignore as intentional source value</option>
              </select>
            </div>

            {form.action === "map_employee" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="exception-employee">HRMS employee</Label>
                  <select
                    id="exception-employee"
                    className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm"
                    value={form.employeeId}
                    onChange={(event) => {
                      const employee = reference?.employees.find((item) => item.id === event.target.value);
                      setForm((current) => ({
                        ...current,
                        employeeId: event.target.value,
                        processId: employee?.processId ?? current.processId,
                        branchId: employee?.branchId ?? current.branchId,
                      }));
                    }}
                  >
                    <option value="">Select employee</option>
                    {(reference?.employees ?? []).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeCode} · {employee.employeeName}{employee.processName ? ` · ${employee.processName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exception-identifier-type">Identifier type</Label>
                  <Input
                    id="exception-identifier-type"
                    value={form.identifierType}
                    onChange={(event) => setForm((current) => ({ ...current, identifierType: event.target.value }))}
                    placeholder="client_login"
                  />
                </div>
              </>
            )}

            {form.action === "map_process" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="exception-process">HRMS process</Label>
                  <select
                    id="exception-process"
                    className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm"
                    value={form.processId}
                    onChange={(event) => setForm((current) => ({ ...current, processId: event.target.value }))}
                  >
                    <option value="">Select process</option>
                    {(reference?.processes ?? []).map((process) => (
                      <option key={process.id} value={process.id}>{process.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exception-branch">Branch</Label>
                  <select
                    id="exception-branch"
                    className="h-11 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm"
                    value={form.branchId}
                    onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))}
                  >
                    <option value="">Use dataset or employee branch</option>
                    {(reference?.branches ?? []).map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {(form.action === "map_employee" || form.action === "map_process") && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="exception-effective-from">Effective from</Label>
                  <Input
                    id="exception-effective-from"
                    type="date"
                    value={form.effectiveFrom}
                    max={form.effectiveTo || undefined}
                    onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exception-effective-to">Effective to</Label>
                  <Input
                    id="exception-effective-to"
                    type="date"
                    value={form.effectiveTo}
                    min={form.effectiveFrom}
                    onChange={(event) => setForm((current) => ({ ...current, effectiveTo: event.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="exception-notes">Resolution notes</Label>
              <Textarea
                id="exception-notes"
                className="min-h-28"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Explain the evidence used, external correction made, or why this value is intentionally ignored."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button disabled={resolveMutation.isPending || !actionValid} onClick={() => resolveMutation.mutate()}>
              {resolveMutation.isPending ? "Resolving…" : "Confirm resolution"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
