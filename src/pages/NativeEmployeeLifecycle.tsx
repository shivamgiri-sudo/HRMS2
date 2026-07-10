import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2,
  Clock, FileText, Loader, Plus, RefreshCcw, Search,
  ShieldCheck, TrendingUp, User, Users, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { formatISTDate } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface ProbationEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  date_of_joining: string;
  employment_status: string;
  branch_id: string | null;
  branch_name: string | null;
  days_on_probation: number;
}

interface EmployeeSearch {
  id: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
}

interface LifecycleEvent {
  id: string;
  event_type: string;
  effective_date: string;
  description?: string;
  created_at: string;
  created_by?: string;
}

interface EmployeeDocument {
  id: string;
  document_name: string;
  document_type?: string;
  expiry_date?: string;
  is_verified: boolean;
}

interface TransferRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  transfer_type: string;
  from_value: string;
  to_value: string;
  effective_date: string;
  reason?: string;
  status: string;
  created_at: string;
}

interface PromotionRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  from_designation?: string;
  to_designation: string;
  from_grade?: string;
  to_grade?: string;
  effective_date: string;
  salary_revision?: number;
  reason?: string;
  status: string;
  created_at: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  joining:           "bg-emerald-100 text-emerald-700 border-emerald-200",
  confirmation:      "bg-blue-100 text-blue-700 border-blue-200",
  promotion:         "bg-violet-100 text-violet-700 border-violet-200",
  transfer:          "bg-cyan-100 text-cyan-700 border-cyan-200",
  role_change:       "bg-indigo-100 text-indigo-700 border-indigo-200",
  department_change: "bg-sky-100 text-sky-700 border-sky-200",
  salary_revision:   "bg-amber-100 text-amber-700 border-amber-200",
  warning:           "bg-orange-100 text-orange-700 border-orange-200",
  suspension:        "bg-rose-100 text-rose-700 border-rose-200",
  separation:        "bg-red-100 text-red-700 border-red-200",
};

const EVENT_TYPES = [
  "joining", "confirmation", "promotion", "transfer",
  "role_change", "department_change", "salary_revision",
  "warning", "suspension", "reinstatement", "separation",
];

const TABS = ["Probation Tracker", "Lifecycle Events", "Transfers", "Promotions"] as const;
type Tab = typeof TABS[number];

// ── Helpers ─────────────────────────────────────────────────────────────────

function eventBadge(type: string) {
  const cls = EVENT_COLORS[type] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function empName(emp: EmployeeSearch) {
  if (emp.name) return emp.name;
  return [emp.first_name, emp.last_name].filter(Boolean).join(" ") || emp.id;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:   "bg-amber-50 text-amber-700",
    approved:  "bg-blue-50 text-blue-700",
    completed: "bg-emerald-50 text-emerald-700",
    rejected:  "bg-red-50 text-red-700",
  };
  const cls = map[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function StatCard({ title, value, icon, tone }: {
  title: string; value: number | string; icon: React.ReactNode; tone: string;
}) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function NativeEmployeeLifecycle() {
  const { isAdminOrHR } = useIsAdminOrHR();
  const [activeTab, setActiveTab] = useState<Tab>("Probation Tracker");
  const [message, setMessage] = useState("");

  // ── Probation tab state ─────────────────────────────────────────────────
  const [probationList, setProbationList] = useState<ProbationEmployee[]>([]);
  const [probationLoading, setProbationLoading] = useState(false);
  const [probationDays, setProbationDays] = useState(60);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  // ── Lifecycle tab state ─────────────────────────────────────────────────
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeSearch[]>([]);
  const [empSearchLoading, setEmpSearchLoading] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSearch | null>(null);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [expiringDocs, setExpiringDocs] = useState<EmployeeDocument[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [addEventForm, setAddEventForm] = useState({ event_type: "joining", effective_date: "", description: "" });
  const [addingEvent, setAddingEvent] = useState(false);
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [verifyRemarks, setVerifyRemarks] = useState("");
  const [verifyingAction, setVerifyingAction] = useState(false);

  // ── Transfer tab state ──────────────────────────────────────────────────
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transferStatusFilter, setTransferStatusFilter] = useState("pending");
  const [transferActing, setTransferActing] = useState<string | null>(null);

  // ── Promotion tab state ─────────────────────────────────────────────────
  const [promotions, setPromotions] = useState<PromotionRecord[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [promotionStatusFilter, setPromotionStatusFilter] = useState("pending");
  const [promotionActing, setPromotionActing] = useState<string | null>(null);

  // ── Load helpers ─────────────────────────────────────────────────────────

  const loadProbation = useCallback(async () => {
    setProbationLoading(true);
    try {
      const res = await hrmsApi.get<{ data: ProbationEmployee[] }>(
        `/api/lifecycle/probation-due?days=${probationDays}`
      );
      setProbationList(res.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load probation list");
    } finally {
      setProbationLoading(false);
    }
  }, [probationDays]);

  const loadEmployeeData = useCallback(async (emp: EmployeeSearch) => {
    setEventsLoading(true);
    try {
      const [evRes, docsRes, expRes] = await Promise.all([
        hrmsApi.get<{ data: LifecycleEvent[] }>(`/api/lifecycle/employees/${emp.id}/lifecycle`),
        hrmsApi.get<{ data: EmployeeDocument[] }>(`/api/lifecycle/employees/${emp.id}/documents`),
        hrmsApi.get<{ data: EmployeeDocument[] }>(`/api/lifecycle/documents/expiring?days=30`),
      ]);
      setEvents(evRes.data ?? []);
      setDocuments(docsRes.data ?? []);
      setExpiringDocs(expRes.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load employee data");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const loadTransfers = useCallback(async () => {
    setTransfersLoading(true);
    try {
      const res = await hrmsApi.get<{ data: TransferRecord[] }>(
        `/api/mobility/transfers${transferStatusFilter !== "all" ? `?status=${transferStatusFilter}` : ""}`
      );
      setTransfers(res.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load transfers");
    } finally {
      setTransfersLoading(false);
    }
  }, [transferStatusFilter]);

  const loadPromotions = useCallback(async () => {
    setPromotionsLoading(true);
    try {
      const res = await hrmsApi.get<{ data: PromotionRecord[] }>(
        `/api/mobility/promotions${promotionStatusFilter !== "all" ? `?status=${promotionStatusFilter}` : ""}`
      );
      setPromotions(res.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load promotions");
    } finally {
      setPromotionsLoading(false);
    }
  }, [promotionStatusFilter]);

  // Initial load based on active tab
  useEffect(() => {
    if (activeTab === "Probation Tracker") void loadProbation();
    if (activeTab === "Transfers")         void loadTransfers();
    if (activeTab === "Promotions")        void loadPromotions();
  }, [activeTab, loadProbation, loadTransfers, loadPromotions]);

  // Employee search debounce
  useEffect(() => {
    const q = empSearch.trim();
    if (!q) { setEmpResults([]); return; }
    const t = setTimeout(async () => {
      setEmpSearchLoading(true);
      try {
        const res = await hrmsApi.get<{ data: EmployeeSearch[] }>(`/api/employees?search=${encodeURIComponent(q)}`);
        setEmpResults(res.data ?? []);
      } catch { setEmpResults([]); }
      finally { setEmpSearchLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [empSearch]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const confirmEmployee = async () => {
    if (!confirmingId) return;
    setConfirmSubmitting(true);
    try {
      await hrmsApi.post(`/api/lifecycle/employees/${confirmingId}/confirm`, { remarks: confirmRemarks || undefined });
      setConfirmingId(null);
      setConfirmRemarks("");
      setMessage("Employee confirmed successfully.");
      await loadProbation();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const selectEmployee = (emp: EmployeeSearch) => {
    setSelectedEmp(emp);
    setEmpSearch(empName(emp));
    setEmpResults([]);
    void loadEmployeeData(emp);
  };

  const submitAddEvent = async () => {
    if (!selectedEmp) return;
    if (!addEventForm.effective_date) { setMessage("Effective date is required."); return; }
    setAddingEvent(true);
    try {
      await hrmsApi.post(`/api/lifecycle/employees/${selectedEmp.id}/lifecycle`, {
        event_type: addEventForm.event_type,
        effective_date: addEventForm.effective_date,
        description: addEventForm.description || undefined,
      });
      setShowAddEvent(false);
      setAddEventForm({ event_type: "joining", effective_date: "", description: "" });
      setMessage("Lifecycle event added.");
      await loadEmployeeData(selectedEmp);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add event");
    } finally {
      setAddingEvent(false);
    }
  };

  const submitVerify = async () => {
    if (!verifyingDocId) return;
    setVerifyingAction(true);
    try {
      await hrmsApi.post(`/api/lifecycle/documents/${verifyingDocId}/verify`, { remarks: verifyRemarks || undefined });
      setVerifyingDocId(null);
      setVerifyRemarks("");
      setMessage("Document verified.");
      if (selectedEmp) await loadEmployeeData(selectedEmp);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyingAction(false);
    }
  };

  const actOnTransfer = async (id: string, action: "approved" | "rejected") => {
    setTransferActing(id);
    try {
      await hrmsApi.patch(`/api/mobility/transfers/${id}`, { action });
      setMessage(`Transfer ${action}.`);
      await loadTransfers();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setTransferActing(null);
    }
  };

  const actOnPromotion = async (id: string, action: "approved" | "rejected") => {
    setPromotionActing(id);
    try {
      await hrmsApi.patch(`/api/mobility/promotions/${id}`, { action });
      setMessage(`Promotion ${action}.`);
      await loadPromotions();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPromotionActing(null);
    }
  };

  // ── Derived stats ─────────────────────────────────────────────────────────
  const overdue    = probationList.filter((e) => e.days_on_probation >= 90);
  const earlyWarn  = probationList.filter((e) => e.days_on_probation >= 60 && e.days_on_probation < 90);
  const thisMonth  = probationList.filter((e) => {
    const doj = new Date(/^\d{4}-\d{2}-\d{2}$/.test(e.date_of_joining) ? `${e.date_of_joining}T00:00:00` : e.date_of_joining);
    const now = new Date();
    const target = new Date(doj);
    target.setDate(target.getDate() + 90);
    return target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear();
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Employee Lifecycle</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Manage probation confirmations, lifecycle events, transfers, and promotions in one place.
          </p>
        </div>

        {/* Message banner */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
            <button onClick={() => setMessage("")} className="ml-auto cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`cursor-pointer rounded-t-xl px-5 py-2.5 text-sm font-bold transition-colors ${
                activeTab === tab
                  ? "border border-b-white border-slate-200 bg-white text-slate-950 -mb-px"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Tab 1: Probation Tracker ──────────────────────────────────────────── */}
        {activeTab === "Probation Tracker" && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard title="Total on Probation" value={probationList.length} icon={<Users className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" />
              <StatCard title="Due This Month" value={thisMonth.length} icon={<CalendarClock className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
              <StatCard title="Overdue (90+ days)" value={overdue.length} icon={<AlertTriangle className="h-5 w-5" />} tone="bg-red-50 text-red-700" />
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-600">Show employees after</label>
                <select
                  value={probationDays}
                  onChange={(e) => setProbationDays(Number(e.target.value))}
                  className="rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
                >
                  <option value={60}>60 days</option>
                  <option value={75}>75 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <button
                onClick={() => void loadProbation()}
                disabled={probationLoading}
                className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Probation Employees</h2>
                <p className="text-sm text-slate-500">{probationList.length} employees due for review</p>
              </div>
              {probationLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : probationList.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No employees due for confirmation.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Employee", "Joining Date", "Days on Probation", "Branch", "Status", "Actions"].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {probationList.map((emp) => {
                        const isOverdue = emp.days_on_probation >= 90;
                        const isEarlyWarn = !isOverdue && emp.days_on_probation >= 60;
                        return (
                          <tr key={emp.id} className="border-t hover:bg-slate-50/80 transition-colors">
                            <td className="p-4">
                              <div className="font-bold text-slate-950">{emp.full_name}</div>
                              <div className="font-mono text-xs text-slate-400">{emp.employee_code}</div>
                            </td>
                            <td className="p-4 font-mono text-slate-600">{emp.date_of_joining?.slice(0, 10)}</td>
                            <td className="p-4">
                              <span className={`font-bold ${isOverdue ? "text-red-600" : isEarlyWarn ? "text-amber-600" : "text-slate-700"}`}>
                                {emp.days_on_probation} days
                              </span>
                              {isOverdue && (
                                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Overdue</span>
                              )}
                              {isEarlyWarn && !isOverdue && (
                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Due Soon</span>
                              )}
                            </td>
                            <td className="p-4 text-slate-600">{emp.branch_name ?? "–"}</td>
                            <td className="p-4">
                              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                {emp.employment_status}
                              </span>
                            </td>
                            <td className="p-4">
                              {isAdminOrHR && (
                                <button
                                  onClick={() => { setConfirmingId(emp.id); setConfirmRemarks(""); }}
                                  className="cursor-pointer rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                                >
                                  Confirm
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {earlyWarn.length > 0 && (
                <div className="border-t bg-amber-50 px-5 py-3 text-sm text-amber-700">
                  <strong>{earlyWarn.length}</strong> employee{earlyWarn.length > 1 ? "s" : ""} approaching 90-day confirmation deadline
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab 2: Lifecycle Events ───────────────────────────────────────────── */}
        {activeTab === "Lifecycle Events" && (
          <div className="space-y-5">
            {/* Employee search */}
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Search Employee</label>
                  <div className="relative max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      placeholder="Type employee name…"
                      className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
                    />
                    {empSearchLoading && (
                      <Loader className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                    )}
                    {empResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-12 z-20 rounded-2xl border bg-white shadow-lg overflow-hidden">
                        {empResults.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => selectEmployee(e)}
                            className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                              <User className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{empName(e)}</div>
                              {e.employee_code && <div className="font-mono text-xs text-slate-400">{e.employee_code}</div>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedEmp && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
                      <User className="h-4 w-4" />
                      {empName(selectedEmp)}
                      {selectedEmp.employee_code && (
                        <span className="font-mono text-xs text-blue-500">· {selectedEmp.employee_code}</span>
                      )}
                    </div>
                  )}
                </div>
                {selectedEmp && isAdminOrHR && (
                  <button
                    onClick={() => setShowAddEvent(true)}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Event
                  </button>
                )}
              </div>
            </div>

            {/* Expiry alert */}
            {selectedEmp && expiringDocs.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <CalendarClock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-800">
                    {expiringDocs.length} document{expiringDocs.length > 1 ? "s" : ""} expiring within 30 days
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">{expiringDocs.map((d) => d.document_name).join(", ")}</p>
                </div>
              </div>
            )}

            {eventsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : selectedEmp ? (
              <>
                {/* Timeline */}
                <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                  <div className="border-b p-5">
                    <h2 className="flex items-center gap-2 font-black text-slate-950">
                      <Clock className="h-5 w-5 text-slate-400" />
                      Lifecycle Timeline
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-500">{events.length} events recorded</p>
                  </div>
                  {events.length === 0 ? (
                    <div className="py-16 text-center text-slate-400">
                      <Clock className="mx-auto mb-3 h-10 w-10 opacity-30" />
                      <p className="font-semibold">No lifecycle events found.</p>
                    </div>
                  ) : (
                    <div className="p-5">
                      <div className="relative">
                        <div className="absolute bottom-0 left-[19px] top-0 w-0.5 bg-slate-100" />
                        <div className="space-y-6">
                          {events.map((ev) => (
                            <div key={ev.id} className="relative flex gap-4">
                              <div className="z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 shadow-sm">
                                <CheckCircle2 className="h-4 w-4 text-slate-500" />
                              </div>
                              <div className="flex-1 rounded-2xl border bg-slate-50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {eventBadge(ev.event_type)}
                                    {ev.description && <span className="text-sm text-slate-700">{ev.description}</span>}
                                  </div>
                                  <span className="font-mono text-xs text-slate-400">{ev.effective_date?.slice(0, 10)}</span>
                                </div>
                                {ev.created_by && (
                                  <p className="mt-1.5 text-xs text-slate-400">
                                    Recorded by {ev.created_by} · {formatISTDate(ev.created_at)}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Documents */}
                <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                  <div className="border-b p-5">
                    <h2 className="flex items-center gap-2 font-black text-slate-950">
                      <FileText className="h-5 w-5 text-slate-400" />
                      Documents
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-500">{documents.length} documents on file</p>
                  </div>
                  {documents.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">
                      <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
                      <p className="font-semibold">No documents found.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                          <tr>
                            {["Document", "Type", "Expiry", "Status", "Actions"].map((h) => (
                              <th key={h} className="p-4 font-semibold">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {documents.map((doc) => {
                            const expiringSoon = doc.expiry_date
                              ? (new Date(doc.expiry_date).getTime() - Date.now()) / 86400000 <= 30
                              : false;
                            return (
                              <tr key={doc.id} className="border-t hover:bg-slate-50/80 transition-colors">
                                <td className="p-4 font-semibold text-slate-900">{doc.document_name}</td>
                                <td className="p-4 capitalize text-slate-500">{doc.document_type ?? "–"}</td>
                                <td className="p-4">
                                  {doc.expiry_date ? (
                                    <span className={`font-mono text-xs ${expiringSoon ? "font-bold text-amber-600" : "text-slate-500"}`}>
                                      {doc.expiry_date.slice(0, 10)}{expiringSoon && " ⚠"}
                                    </span>
                                  ) : <span className="text-slate-400">–</span>}
                                </td>
                                <td className="p-4">
                                  {doc.is_verified ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                      <CheckCircle2 className="h-3 w-3" /> Verified
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                      <Clock className="h-3 w-3" /> Pending
                                    </span>
                                  )}
                                </td>
                                <td className="p-4">
                                  {isAdminOrHR && !doc.is_verified && (
                                    <button
                                      onClick={() => { setVerifyingDocId(doc.id); setVerifyRemarks(""); }}
                                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                                    >
                                      <ShieldCheck className="h-3.5 w-3.5" /> Verify
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-24 text-slate-400 shadow-sm">
                <User className="mb-4 h-14 w-14 opacity-20" />
                <p className="text-lg font-semibold">Select an employee to view lifecycle</p>
                <p className="mt-1 text-sm">Search by name above to get started</p>
              </div>
            )}
          </div>
        )}

        {/* ── Tab 3: Transfers ──────────────────────────────────────────────────── */}
        {activeTab === "Transfers" && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {["pending", "completed", "rejected", "all"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setTransferStatusFilter(s)}
                    className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                      transferStatusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void loadTransfers()}
                disabled={transfersLoading}
                className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Transfer Records</h2>
                <p className="text-sm text-slate-500">{transfers.length} records</p>
              </div>
              {transfersLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : transfers.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <ArrowRight className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No transfer records found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Employee", "Type", "From", "To", "Effective", "Status", "Actions"].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((t) => (
                        <tr key={t.id} className="border-t hover:bg-slate-50/80 transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-slate-950">{t.employee_name}</div>
                            <div className="font-mono text-xs text-slate-400">{t.employee_code}</div>
                          </td>
                          <td className="p-4 capitalize text-slate-600">{t.transfer_type}</td>
                          <td className="p-4 text-slate-600">{t.from_value}</td>
                          <td className="p-4 font-semibold text-slate-900">{t.to_value}</td>
                          <td className="p-4 font-mono text-slate-500">{t.effective_date?.slice(0, 10)}</td>
                          <td className="p-4"><StatusBadge status={t.status} /></td>
                          <td className="p-4">
                            {t.status === "pending" && isAdminOrHR && (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => actOnTransfer(t.id, "approved")}
                                  disabled={transferActing === t.id}
                                  className="cursor-pointer rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => actOnTransfer(t.id, "rejected")}
                                  disabled={transferActing === t.id}
                                  className="cursor-pointer rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab 4: Promotions ─────────────────────────────────────────────────── */}
        {activeTab === "Promotions" && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {["pending", "completed", "rejected", "all"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setPromotionStatusFilter(s)}
                    className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                      promotionStatusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void loadPromotions()}
                disabled={promotionsLoading}
                className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Promotion Records</h2>
                <p className="text-sm text-slate-500">{promotions.length} records</p>
              </div>
              {promotionsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : promotions.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <TrendingUp className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No promotion records found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Employee", "From Designation", "To Designation", "Salary Revision", "Effective", "Status", "Actions"].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {promotions.map((p) => (
                        <tr key={p.id} className="border-t hover:bg-slate-50/80 transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-slate-950">{p.employee_name}</div>
                            <div className="font-mono text-xs text-slate-400">{p.employee_code}</div>
                          </td>
                          <td className="p-4 text-slate-500">{p.from_designation ?? "–"}</td>
                          <td className="p-4 font-semibold text-slate-900">{p.to_designation}</td>
                          <td className="p-4">
                            {p.salary_revision != null ? (
                              <span className="font-semibold text-emerald-700">
                                ₹{p.salary_revision.toLocaleString("en-IN")}
                              </span>
                            ) : (
                              <span className="text-slate-400">–</span>
                            )}
                          </td>
                          <td className="p-4 font-mono text-slate-500">{p.effective_date?.slice(0, 10)}</td>
                          <td className="p-4"><StatusBadge status={p.status} /></td>
                          <td className="p-4">
                            {p.status === "pending" && isAdminOrHR && (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => actOnPromotion(p.id, "approved")}
                                  disabled={promotionActing === p.id}
                                  className="cursor-pointer rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => actOnPromotion(p.id, "rejected")}
                                  disabled={promotionActing === p.id}
                                  className="cursor-pointer rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm Employee Modal ─────────────────────────────────────────────── */}
      {confirmingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Confirm Employee</h2>
              <button onClick={() => setConfirmingId(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="mb-4 text-sm text-slate-600">
                This will update the employee's status from <strong>Probation</strong> to <strong>Confirmed</strong> and log a confirmation event.
              </p>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks (optional)</label>
              <textarea
                value={confirmRemarks}
                onChange={(e) => setConfirmRemarks(e.target.value)}
                placeholder="Add confirmation remarks…"
                rows={3}
                className="w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setConfirmingId(null)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmEmployee}
                disabled={confirmSubmitting}
                className="flex-1 cursor-pointer rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {confirmSubmitting ? "Confirming…" : "Confirm Employment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Event Modal ────────────────────────────────────────────────────── */}
      {showAddEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add Lifecycle Event</h2>
              <button onClick={() => setShowAddEvent(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Event Type</label>
                <select
                  value={addEventForm.event_type}
                  onChange={(e) => setAddEventForm({ ...addEventForm, event_type: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm capitalize outline-none focus:border-blue-400"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Effective Date</label>
                <input
                  type="date"
                  value={addEventForm.effective_date}
                  onChange={(e) => setAddEventForm({ ...addEventForm, effective_date: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Description</label>
                <textarea
                  value={addEventForm.description}
                  onChange={(e) => setAddEventForm({ ...addEventForm, description: e.target.value })}
                  placeholder="Optional notes…"
                  rows={3}
                  className="w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowAddEvent(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitAddEvent}
                disabled={addingEvent}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {addingEvent ? "Saving…" : "Add Event"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Verify Document Modal ──────────────────────────────────────────────── */}
      {verifyingDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Verify Document</h2>
              <button onClick={() => setVerifyingDocId(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Remarks (optional)</label>
              <textarea
                value={verifyRemarks}
                onChange={(e) => setVerifyRemarks(e.target.value)}
                placeholder="Add verification remarks…"
                rows={3}
                className="w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setVerifyingDocId(null)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitVerify}
                disabled={verifyingAction}
                className="flex-1 cursor-pointer rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {verifyingAction ? "Verifying…" : "Confirm Verify"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
