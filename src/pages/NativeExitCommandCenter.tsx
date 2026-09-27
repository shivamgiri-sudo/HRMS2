import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  IndianRupee,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { NOC_INITIATOR_EVIDENCE, type CenterData } from "./exit/shared";
import { AnalyticsTab } from "./exit/AnalyticsTab";
import { ExitTaskBoardTab } from "./exit/ExitTaskBoardTab";
import { BulkActionsTab } from "./exit/BulkActionsTab";
import { FfSettlementPanel } from "./exit/FfSettlementPanel";
import { OverviewTab } from "./exit/OverviewTab";
import { NoticePeriodTab } from "./exit/NoticePeriodTab";

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
type EmpResult = {
  id: string;
  name: string;
  employee_code: string;
  branch_name?: string | null;
  process_name?: string | null;
  department_name?: string | null;
  reporting_manager_name?: string | null;
};

export default function NativeExitCommandCenter() {
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const { hasAnyRole } = useWorkforceAccess();

  // ── Create exit request ──────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createForm, setCreateForm] = useState({
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
  const [empQuery, setEmpQuery] = useState("");
  const [empResults, setEmpResults] = useState<EmpResult[]>([]);
  const [empSearching, setEmpSearching] = useState(false);
  const [empInactiveCount, setEmpInactiveCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CenterData }>(
        "/api/exit/command-center",
      );
      setData(res.data);
    } catch (err: any) {
      console.error("Exit command center load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      setShowCreate(false);
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
      await load();
    } catch (err: unknown) {
      setCreateMessage((err as Error)?.message || "Submission failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    id: string,
    status: string,
  ): Promise<number> => {
    const res: any = await hrmsApi.patch(`/api/exit/${id}/status`, {
      status,
      remarks: `Moved to ${status}`,
    });
    await load();
    return Number(res?.pendingAtExit ?? res?.data?.pendingAtExit ?? 0);
  };

  const handleGenerateClearance = async (id: string) => {
    await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
    await load();
  };

  // Opens (or, harmlessly, re-fetches) the NOC clearance case for one exit. openCase() on
  // the backend is idempotent — a case that already exists for this employee is returned
  // as-is rather than duplicated — so this button is always safe to click again.
  const handleStartNocClearance = async (
    exitRequestId: string,
    employeeId: string,
  ) => {
    const initiatorRole =
      NOC_INITIATOR_EVIDENCE.find((e) => hasAnyRole(...e.roleKeys))?.role ??
      "hr";
    await hrmsApi.post("/api/payroll/noc-cases", {
      employeeId,
      initiatorRole,
      exitRequestId,
    });
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-orange-600 text-white p-6 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <UserMinus className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight leading-tight">
                  Exit Command Center
                </h1>
                <p className="text-rose-200 text-sm mt-0.5">
                  Resignation · Retention · Clearance · F&F · Analytics
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowCreate(true)}
                variant="outline"
                className="bg-white/20 border-white/30 text-white hover:bg-white/30 hover:text-white font-semibold"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Exit Request
              </Button>
              <Button
                onClick={load}
                disabled={loading}
                variant="outline"
                className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
              >
                <RefreshCcw
                  className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs: four working areas; secondary tools live under Insights */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-white/95 border border-white/60 backdrop-blur-sm p-1 rounded-xl flex-wrap">
            {[
              { value: "overview", label: "Overview", icon: Users },
              {
                value: "task-board",
                label: "Exit Task Board",
                icon: ShieldCheck,
              },
              { value: "ff", label: "F&F Settlement", icon: IndianRupee },
              { value: "insights", label: "Insights & Tools", icon: BarChart3 },
            ].map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="data-[state=active]:bg-rose-600 data-[state=active]:text-white rounded-lg min-h-[44px] sm:min-h-0"
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              data={data}
              loading={loading}
              onStatusChange={handleStatusChange}
              onGenerateClearance={handleGenerateClearance}
              onStartNocClearance={handleStartNocClearance}
            />
          </TabsContent>

          <TabsContent value="task-board">
            <ExitTaskBoardTab
              exitRequests={data?.requests ?? []}
              loading={loading}
            />
          </TabsContent>

          <TabsContent value="ff">
            <FfSettlementPanel exitRequests={data?.requests ?? []} />
          </TabsContent>

          <TabsContent value="insights">
            <Tabs defaultValue="analytics" className="space-y-4">
              <TabsList className="bg-slate-100 rounded-xl">
                <TabsTrigger value="analytics" className="rounded-lg">
                  Analytics
                </TabsTrigger>
                <TabsTrigger value="notice" className="rounded-lg">
                  Notice Period
                </TabsTrigger>
                <TabsTrigger value="bulk" className="rounded-lg">
                  Bulk Actions
                </TabsTrigger>
              </TabsList>
              <TabsContent value="analytics">
                <AnalyticsTab data={data} loading={loading} />
              </TabsContent>
              <TabsContent value="notice">
                <NoticePeriodTab />
              </TabsContent>
              <TabsContent value="bulk">
                <BulkActionsTab
                  exitRequests={data?.requests ?? []}
                  onRefresh={load}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </main>

      {/* ── New Exit Request Modal ───────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">
                New Exit Request
              </h2>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setCreateMessage("");
                }}
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
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        exitSubType: e.target.value,
                      })
                    }
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
                onClick={() => {
                  setShowCreate(false);
                  setCreateMessage("");
                }}
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
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

