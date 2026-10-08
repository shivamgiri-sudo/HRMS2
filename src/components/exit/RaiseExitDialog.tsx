import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { hrmsApi } from "@/lib/hrmsApi";

/** An employee already chosen by the caller (roster row, team drawer...) - locks the picker. */
export interface RaiseExitEmployee {
  id: string;
  name: string;
  code?: string | null;
  branch?: string | null;
  process?: string | null;
  department?: string | null;
  reportingManager?: string | null;
}

type EmpResult = {
  id: string;
  name: string;
  employee_code: string;
  branch_name?: string | null;
  process_name?: string | null;
  department_name?: string | null;
  reporting_manager_name?: string | null;
};

/**
 * The one "raise an exit" form. Exit Command Center's New Exit Request and every manager-facing
 * team page (roster, My Team drawer, attendance...) render this same component and POST to the
 * same /api/exit, so a manager-raised exit lands in Exit Command Center and follows its flow.
 * Server-side, a reporting manager can only name someone in their own team.
 */
export function RaiseExitDialog({
  employee,
  onClose,
  onSubmitted,
}: {
  employee?: RaiseExitEmployee;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const close = onClose;
  const [createMessage, setCreateMessage] = useState("");
  const [createForm, setCreateForm] = useState({
    employeeId: employee?.id ?? "",
    employeeLabel: employee ? [employee.code, employee.name].filter(Boolean).join(" — ") : "",
    employeeBranch: employee?.branch ?? "",
    employeeProcess: employee?.process ?? "",
    employeeDept: employee?.department ?? "",
    employeeRm: employee?.reportingManager ?? "",
    exitType: "voluntary",
    exitSubType: "resignation",
    exitReasonCategory: "career_growth",
    resignationReason: "",
    lastWorkingDayProposed: "",
    abscondingSince: "",
  });
  const [empQuery, setEmpQuery] = useState("");
  const [empResults, setEmpResults] = useState<EmpResult[]>([]);
  const [empSearching, setEmpSearching] = useState(false);
  const [empInactiveCount, setEmpInactiveCount] = useState(0);
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    const q = empQuery.trim();
    if (q.length < 2) {
      setEmpResults([]);
      setEmpInactiveCount(0);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setEmpSearching(true);
      try {
        const [res, inactive] = await Promise.all([
          hrmsApi.get<{ data: Array<Record<string, unknown>> }>(
            `/api/employees?recordStatus=active&limit=10&search=${encodeURIComponent(q)}`,
          ),
          hrmsApi
            .get<{ total?: number }>(
              `/api/employees?recordStatus=inactive&limit=1&search=${encodeURIComponent(q)}`,
            )
            .catch(() => ({ total: 0 })),
        ]);
        if (!cancelled) {
          setEmpResults(
            (res?.data ?? [])
              .map((e) => ({
                id: String(e.id ?? ""),
                employee_code: String(e.employee_code ?? ""),
                name:
                  [e.first_name, e.last_name].filter(Boolean).join(" ") ||
                  String(e.full_name ?? ""),
                branch_name: String(e.branch_name ?? ""),
                process_name: String(e.process_name ?? ""),
                department_name: String(e.department_name ?? ""),
                reporting_manager_name: String(e.reporting_manager_name ?? ""),
              }))
              .filter((e) => e.id),
          );
          setEmpInactiveCount(Number(inactive?.total ?? 0));
        }
      } catch {
        if (!cancelled) {
          setEmpResults([]);
          setEmpInactiveCount(0);
        }
      } finally {
        if (!cancelled) setEmpSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [empQuery]);

  const submitExitRequest = async () => {
    if (!createForm.employeeId.trim())
      return setCreateMessage("Select an employee first.");
    if (!createForm.lastWorkingDayProposed)
      return setCreateMessage("Proposed last working day is required.");
    if (
      ["absconding", "abandonment"].includes(createForm.exitSubType) &&
      !createForm.abscondingSince
    )
      return setCreateMessage(
        "Last date actually worked is required for absconding/abandonment exits.",
      );
    setSaving(true);
    try {
      await hrmsApi.post("/api/exit", {
        employeeId: createForm.employeeId,
        exitType: createForm.exitType,
        exitSubType: createForm.exitSubType,
        exitReasonCategory: createForm.exitReasonCategory,
        resignationReason: createForm.resignationReason || null,
        lastWorkingDayProposed: createForm.lastWorkingDayProposed,
        ...(["absconding", "abandonment"].includes(createForm.exitSubType) &&
        createForm.abscondingSince
          ? { abscondingSince: createForm.abscondingSince }
          : {}),
      });
      setEmpQuery("");
      setEmpResults([]);
      setCreateForm({
        employeeId: "",
        employeeLabel: "",
        employeeBranch: "",
        employeeProcess: "",
        employeeDept: "",
        employeeRm: "",
        exitType: "voluntary",
        exitSubType: "resignation",
        exitReasonCategory: "career_growth",
        resignationReason: "",
        lastWorkingDayProposed: "",
        abscondingSince: "",
      });
      setCreateMessage("");
      onSubmitted();
      onClose();
    } catch (err: unknown) {
      setCreateMessage((err as Error)?.message || "Submission failed.");
    } finally {
      setSaving(false);
    }
  };


  // A real Radix dialog (portaled, focus-managed), not a bare fixed <div>: opened from inside another
  // slide-over (the attrition drill-down drawer) a fixed <div> is clipped by the table row it sits in.
  // Radix layers it above the drawer and keeps clicks inside it from being treated as "outside" the drawer.
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[130] bg-slate-950/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[131] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto outline-none"
        >
            <div className="flex items-center justify-between border-b p-6">
              <DialogPrimitive.Title className="text-lg font-black text-slate-950">
                {employee ? "Raise Exit" : "New Exit Request"}
              </DialogPrimitive.Title>
              <button
                onClick={close}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              {createMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                  {createMessage}
                </div>
              )}
              {/* Employee picker */}
              <div className="relative">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Employee
                </label>
                {createForm.employeeId ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {createForm.employeeLabel}
                      </span>
{!employee && (
                      <button
                        type="button"
                        onClick={() =>
                          setCreateForm({
                            ...createForm,
                            employeeId: "",
                            employeeLabel: "",
                          })
                        }
                        className="text-xs font-semibold text-blue-700 hover:underline"
                      >
                        Change
                      </button>
)}
                    </div>
                    {(createForm.employeeBranch ||
                      createForm.employeeProcess) && (
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                        {createForm.employeeBranch && (
                          <span>
                            <span className="text-slate-400">Branch:</span>{" "}
                            {createForm.employeeBranch}
                          </span>
                        )}
                        {createForm.employeeProcess && (
                          <span>
                            <span className="text-slate-400">Process:</span>{" "}
                            {createForm.employeeProcess}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <input
                      value={empQuery}
                      onChange={(e) => setEmpQuery(e.target.value)}
                      placeholder="Search by name or employee code"
                      className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                      autoComplete="off"
                    />
                    {empQuery.trim().length >= 2 && (
                      <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-2xl border bg-white shadow-lg">
                        {empSearching && (
                          <div className="px-4 py-3 text-sm text-slate-500">
                            Searching…
                          </div>
                        )}
                        {!empSearching && empResults.length === 0 && (
                          <div className="px-4 py-3 text-sm text-slate-500">
                            No active employee matches.
                          </div>
                        )}
                        {!empSearching && empInactiveCount > 0 && (
                          <div className="border-t bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
                            {empInactiveCount} inactive employee
                            {empInactiveCount === 1 ? "" : "s"} also found.
                            Exits only for active employees.
                          </div>
                        )}
                        {empResults.map((emp) => (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => {
                              setCreateForm({
                                ...createForm,
                                employeeId: emp.id,
                                employeeLabel: `${emp.employee_code} — ${emp.name}`,
                                employeeBranch: emp.branch_name ?? "",
                                employeeProcess: emp.process_name ?? "",
                                employeeDept: emp.department_name ?? "",
                                employeeRm: emp.reporting_manager_name ?? "",
                              });
                              setEmpQuery("");
                              setEmpResults([]);
                            }}
                            className="flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50 border-b last:border-b-0"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-900">
                                {emp.name}
                              </span>
                              <span className="font-mono text-xs text-slate-500">
                                {emp.employee_code}
                              </span>
                            </div>
                            {emp.branch_name && (
                              <div className="text-xs text-slate-400">
                                {emp.branch_name}
                                {emp.process_name
                                  ? ` · ${emp.process_name}`
                                  : ""}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Exit type + subtype */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Exit Type
                  </label>
                  <select
                    value={createForm.exitType}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        exitType: e.target.value,
                        exitSubType:
                          e.target.value === "voluntary"
                            ? "resignation"
                            : "termination",
                        // keep the reason category consistent with the sub-type it just defaulted to
                        exitReasonCategory:
                          e.target.value === "voluntary"
                            ? ["absconding", "termination_misconduct", "contract_end"].includes(createForm.exitReasonCategory)
                              ? "career_growth"
                              : createForm.exitReasonCategory
                            : "termination_misconduct",
                      })
                    }
                    className="w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="voluntary">Voluntary</option>
                    <option value="involuntary">Involuntary</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Sub-type
                  </label>
                  <select
                    value={createForm.exitSubType}
                    onChange={(e) => {
                      const sub = e.target.value;
                      // Pre-fill the reason category from the sub-type; the user can still change it.
                      // Resignation / retirement / mutual separation keep whatever was chosen.
                      const auto: Record<string, string> = {
                        absconding: "absconding",
                        abandonment: "absconding",
                        termination: "termination_misconduct",
                        contract_end: "contract_end",
                      };
                      setCreateForm({
                        ...createForm,
                        exitSubType: sub,
                        exitReasonCategory: auto[sub] ?? createForm.exitReasonCategory,
                      });
                    }}
                    className="w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    {createForm.exitType === "voluntary" && (
                      <>
                        <option value="resignation">Resignation</option>
                        <option value="retirement">Retirement</option>
                        <option value="mutual_separation">
                          Mutual Separation
                        </option>
                      </>
                    )}
                    {createForm.exitType === "involuntary" && (
                      <>
                        <option value="termination">Termination</option>
                        <option value="absconding">Absconding</option>
                        <option value="abandonment">Abandonment</option>
                        <option value="contract_end">Contract End</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
              {/* Reason */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Reason Category
                </label>
                <select
                  value={createForm.exitReasonCategory}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      exitReasonCategory: e.target.value,
                    })
                  }
                  className="w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none focus:border-blue-400"
                >
                  <option value="better_opportunity">Better Opportunity</option>
                  <option value="career_growth">Career Growth</option>
                  <option value="compensation">
                    Compensation Dissatisfaction
                  </option>
                  <option value="relocation">Relocation</option>
                  <option value="health_personal">
                    Health / Personal Reasons
                  </option>
                  <option value="family_reasons">Family Reasons</option>
                  <option value="higher_education">Higher Education</option>
                  <option value="work_environment">Work Environment</option>
                  <option value="dissatisfaction_management">
                    Management Dissatisfaction
                  </option>
                  <option value="entrepreneurship">Entrepreneurship</option>
                  <option value="performance_action">
                    Performance Action (Involuntary)
                  </option>
                  <option value="termination_misconduct">
                    Termination — Misconduct
                  </option>
                  <option value="absconding">Absconding</option>
                  <option value="contract_end">Contract End</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Resignation Reason (optional)
                </label>
                <textarea
                  value={createForm.resignationReason}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      resignationReason: e.target.value,
                    })
                  }
                  rows={2}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none"
                  placeholder="Brief description…"
                />
              </div>
              {/* Dates */}
              {["absconding", "abandonment"].includes(
                createForm.exitSubType,
              ) && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Last date actually worked *
                  </label>
                  <input
                    type="date"
                    value={createForm.abscondingSince}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        abscondingSince: e.target.value,
                      })
                    }
                    className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Proposed Last Working Day *
                </label>
                <input
                  type="date"
                  value={createForm.lastWorkingDayProposed}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      lastWorkingDayProposed: e.target.value,
                    })
                  }
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button
                onClick={close}
                className="rounded-2xl border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitExitRequest()}
                disabled={saving}
                className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Submitting…" : "Submit Exit Request"}
              </button>
            </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default RaiseExitDialog;
