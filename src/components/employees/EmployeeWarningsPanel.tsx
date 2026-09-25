import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = [
  { value: "attendance", label: "Attendance" },
  { value: "conduct", label: "Conduct" },
  { value: "performance", label: "Performance" },
  { value: "policy_violation", label: "Policy violation" },
  { value: "integrity", label: "Integrity" },
  { value: "other", label: "Other" },
] as const;

const SEVERITIES = [
  { value: "verbal", label: "Verbal" },
  { value: "written", label: "Written" },
  { value: "final", label: "Final" },
] as const;

interface WarningRow {
  id: string;
  warningDate: string;
  category: string;
  severity: string;
  description: string;
  remarks: string | null;
  status: "active" | "withdrawn";
  issuedByName: string | null;
  withdrawnAt: string | null;
  withdrawnByName: string | null;
  withdrawnReason: string | null;
}

interface WarningsResponse {
  relation: "self" | "hr" | "span";
  canIssue: boolean;
  warnings: WarningRow[];
}

const labelOf = (
  list: ReadonlyArray<{ value: string; label: string }>,
  value: string,
): string => list.find((i) => i.value === value)?.label ?? value;
const today = (): string => new Date().toISOString().slice(0, 10);
const selectClass =
  "h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm";

/**
 * Warnings on an employee's record. The same panel serves the employee (their own, read-only), HR and the
 * reporting line (TL/AM). Who may see or issue is decided by the server; the panel only shows what it returns.
 */
export function EmployeeWarningsPanel({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const key = ["employee-warnings", employeeId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      hrmsApi.get<{ data: WarningsResponse }>(
        `/api/warnings/employee/${employeeId}`,
      ),
    staleTime: 30_000,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    warningDate: today(),
    category: "",
    severity: "written",
    description: "",
    remarks: "",
  });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const issue = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/warnings", {
        employeeId,
        ...form,
        remarks: form.remarks || null,
      }),
    onSuccess: () => {
      toast.success("Warning recorded.");
      setOpen(false);
      setForm({
        warningDate: today(),
        category: "",
        severity: "written",
        description: "",
        remarks: "",
      });
      setError(null);
      refresh();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof Error ? err.message : "Could not record the warning",
      ),
  });
  const withdraw = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      hrmsApi.patch(`/api/warnings/${input.id}/withdraw`, {
        reason: input.reason,
      }),
    onSuccess: () => {
      toast.success("Warning withdrawn.");
      refresh();
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof Error ? err.message : "Could not withdraw the warning",
      ),
  });

  if (query.isLoading)
    return <p className="p-6 text-sm text-slate-500">Loading warnings...</p>;
  if (query.error instanceof Error)
    return (
      <p role="alert" className="p-6 text-sm text-red-600">
        Could not load warnings. {query.error.message}
      </p>
    );
  const data = query.data?.data;
  const warnings = data?.warnings ?? [];
  const canSubmit =
    form.category !== "" &&
    form.description.trim().length >= 5 &&
    form.warningDate !== "";

  const onWithdraw = (row: WarningRow) => {
    const reason = window.prompt("Why is this warning being withdrawn?");
    if (reason && reason.trim().length >= 3)
      withdraw.mutate({ id: row.id, reason: reason.trim() });
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          Warnings ({warnings.filter((w) => w.status === "active").length}{" "}
          active)
        </h3>
        {data?.canIssue && !open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Issue warning
          </Button>
        )}
      </div>

      {open && (
        <form
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
          aria-label="Issue warning"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) issue.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="w-date">Warning date</Label>
              <Input
                id="w-date"
                type="date"
                value={form.warningDate}
                max={today()}
                onChange={(e) =>
                  setForm((f) => ({ ...f, warningDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-cat">Reason / category</Label>
              <select
                id="w-cat"
                className={selectClass}
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
              >
                <option value="">Select...</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-sev">Type</Label>
              <select
                id="w-sev"
                className={selectClass}
                value={form.severity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, severity: e.target.value }))
                }
              >
                {SEVERITIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="w-desc">Description</Label>
            <Textarea
              id="w-desc"
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="w-rem">
              Internal remarks (not shown to the employee)
            </Label>
            <Textarea
              id="w-rem"
              rows={2}
              maxLength={1000}
              value={form.remarks}
              onChange={(e) =>
                setForm((f) => ({ ...f, remarks: e.target.value }))
              }
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || issue.isPending}
            >
              Record warning
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {warnings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No warnings on record.
        </p>
      ) : (
        <ol className="space-y-3">
          {warnings.map((w) => (
            <li
              key={w.id}
              className={`rounded-xl border p-4 ${w.status === "withdrawn" ? "border-slate-200 bg-slate-50 opacity-70" : "border-amber-200 bg-amber-50"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-slate-600">
                  {w.warningDate}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {labelOf(SEVERITIES, w.severity)}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {labelOf(CATEGORIES, w.category)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${w.status === "active" ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-600"}`}
                >
                  {w.status === "active" ? "Active" : "Withdrawn"}
                </span>
                {w.status === "active" && data?.relation !== "self" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 text-xs"
                    disabled={withdraw.isPending}
                    onClick={() => onWithdraw(w)}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-800">{w.description}</p>
              {w.remarks && (
                <p className="mt-1 text-xs text-slate-500">
                  Remarks: {w.remarks}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                Issued by {w.issuedByName ?? "-"}
                {w.status === "withdrawn" &&
                  ` - withdrawn ${w.withdrawnAt ?? ""} by ${w.withdrawnByName ?? "-"}: ${w.withdrawnReason ?? ""}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
