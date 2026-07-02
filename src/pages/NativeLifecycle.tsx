import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, FileText,
  Loader, Plus, RefreshCcw, Search, User,
  ShieldCheck, X, CalendarClock,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";

// ── Types ──────────────────────────────────────────────────────────────────

interface Employee {
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
  metadata?: Record<string, unknown>;
  created_at: string;
  created_by?: string;
}

interface EmployeeDocument {
  id: string;
  document_name: string;
  document_type?: string;
  expiry_date?: string;
  is_verified: boolean;
  verified_by?: string;
  verified_at?: string;
}

interface AddEventForm {
  event_type: string;
  effective_date: string;
  description: string;
}

interface VerifyForm {
  remarks: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  "joining", "confirmation", "promotion", "transfer",
  "role_change", "department_change", "salary_revision",
  "warning", "suspension", "reinstatement", "separation",
];

const EVENT_COLORS: Record<string, string> = {
  joining:            "bg-emerald-100 text-emerald-700 border-emerald-200",
  confirmation:       "bg-blue-100 text-blue-700 border-blue-200",
  promotion:          "bg-violet-100 text-violet-700 border-violet-200",
  transfer:           "bg-cyan-100 text-cyan-700 border-cyan-200",
  role_change:        "bg-indigo-100 text-indigo-700 border-indigo-200",
  department_change:  "bg-sky-100 text-sky-700 border-sky-200",
  salary_revision:    "bg-amber-100 text-amber-700 border-amber-200",
  warning:            "bg-orange-100 text-orange-700 border-orange-200",
  suspension:         "bg-rose-100 text-rose-700 border-rose-200",
  reinstatement:      "bg-teal-100 text-teal-700 border-teal-200",
  separation:         "bg-red-100 text-red-700 border-red-200",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function eventBadge(type: string) {
  const cls = EVENT_COLORS[type] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function employeeDisplayName(emp: Employee) {
  if (emp.name) return emp.name;
  const parts = [emp.first_name, emp.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : emp.id;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function NativeLifecycle() {
  const { isAdminOrHR } = useIsAdminOrHR();

  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeResults, setEmployeeResults] = useState<Employee[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [expiringDocs, setExpiringDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [showAddEvent, setShowAddEvent] = useState(false);
  const [addEventForm, setAddEventForm] = useState<AddEventForm>({
    event_type: "joining",
    effective_date: "",
    description: "",
  });
  const [addingEvent, setAddingEvent] = useState(false);

  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [verifyForm, setVerifyForm] = useState<VerifyForm>({ remarks: "" });
  const [verifyingAction, setVerifyingAction] = useState(false);

  // ── Employee search ──────────────────────────────────────────────────────

  useEffect(() => {
    const q = employeeSearch.trim();
    if (!q) { setEmployeeResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await hrmsApi.get<{ data: Employee[] }>(`/api/employees?search=${encodeURIComponent(q)}`);
        setEmployeeResults(res.data ?? []);
      } catch {
        setEmployeeResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [employeeSearch]);

  // ── Load employee data ───────────────────────────────────────────────────

  const loadEmployeeData = useCallback(async (emp: Employee) => {
    setLoading(true);
    setMessage("");
    try {
      const [eventsRes, docsRes, expiringRes] = await Promise.all([
        hrmsApi.get<{ data: LifecycleEvent[] }>(`/api/lifecycle/employees/${emp.id}/lifecycle`),
        hrmsApi.get<{ data: EmployeeDocument[] }>(`/api/lifecycle/employees/${emp.id}/documents`),
        hrmsApi.get<{ data: EmployeeDocument[] }>(`/api/lifecycle/documents/expiring?days=30`),
      ]);
      setEvents(eventsRes.data ?? []);
      setDocuments(docsRes.data ?? []);
      // Filter expiring docs that belong to this employee
      setExpiringDocs(expiringRes.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load employee data";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectEmployee = (emp: Employee) => {
    setSelectedEmployee(emp);
    setEmployeeSearch(employeeDisplayName(emp));
    setEmployeeResults([]);
    void loadEmployeeData(emp);
  };

  // ── Add lifecycle event ──────────────────────────────────────────────────

  const submitAddEvent = async () => {
    if (!selectedEmployee) return;
    if (!addEventForm.effective_date) { setMessage("Effective date is required."); return; }
    setAddingEvent(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/lifecycle/employees/${selectedEmployee.id}/lifecycle`, {
        event_type: addEventForm.event_type,
        effective_date: addEventForm.effective_date,
        description: addEventForm.description || undefined,
        metadata: {},
      });
      setShowAddEvent(false);
      setAddEventForm({ event_type: "joining", effective_date: "", description: "" });
      setMessage("Lifecycle event added.");
      await loadEmployeeData(selectedEmployee);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add event";
      setMessage(msg);
    } finally {
      setAddingEvent(false);
    }
  };

  // ── Verify document ──────────────────────────────────────────────────────

  const submitVerify = async () => {
    if (!verifyingDocId) return;
    setVerifyingAction(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/lifecycle/documents/${verifyingDocId}/verify`, {
        remarks: verifyForm.remarks || undefined,
      });
      setVerifyingDocId(null);
      setVerifyForm({ remarks: "" });
      setMessage("Document verified.");
      if (selectedEmployee) await loadEmployeeData(selectedEmployee);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      setMessage(msg);
    } finally {
      setVerifyingAction(false);
    }
  };

  const hasExpiringForEmployee = expiringDocs.length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Employee Lifecycle</h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              Track joining, confirmation, promotions, transfers, and separation events. Manage employee documents.
            </p>
          </div>
          {selectedEmployee && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => loadEmployeeData(selectedEmployee)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
              {isAdminOrHR && (
                <button
                  onClick={() => setShowAddEvent(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Add Event
                </button>
              )}
            </div>
          )}
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

        {/* Employee selector */}
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <label className="block text-sm font-semibold text-slate-700 mb-2">Search Employee</label>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              placeholder="Type employee name to search…"
              className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
            />
            {searchLoading && (
              <Loader className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
            )}
            {employeeResults.length > 0 && (
              <div className="absolute left-0 right-0 top-12 z-20 rounded-2xl border bg-white shadow-lg overflow-hidden">
                {employeeResults.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => selectEmployee(emp)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{employeeDisplayName(emp)}</div>
                      {emp.employee_code && (
                        <div className="text-xs text-slate-400 font-mono">{emp.employee_code}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedEmployee && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
              <User className="h-4 w-4" />
              {employeeDisplayName(selectedEmployee)}
              {selectedEmployee.employee_code && (
                <span className="font-mono text-xs text-blue-500">· {selectedEmployee.employee_code}</span>
              )}
            </div>
          )}
        </div>

        {/* Expiring docs alert */}
        {selectedEmployee && hasExpiringForEmployee && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <CalendarClock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-bold text-amber-800">
                {expiringDocs.length} document{expiringDocs.length > 1 ? "s" : ""} expiring within 30 days
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                {expiringDocs.map((d) => d.document_name).join(", ")}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : selectedEmployee ? (
          <>
            {/* Timeline */}
            <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-slate-400" />
                  Lifecycle Timeline
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">{events.length} events recorded</p>
              </div>
              {events.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Clock className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No lifecycle events found.</p>
                </div>
              ) : (
                <div className="p-5">
                  <div className="relative">
                    {/* vertical line */}
                    <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-slate-100" />
                    <div className="space-y-6">
                      {events.map((ev) => (
                        <div key={ev.id} className="relative flex gap-4">
                          <div className="z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 shadow-sm">
                            <CheckCircle2 className="h-4 w-4 text-slate-500" />
                          </div>
                          <div className="flex-1 rounded-2xl border bg-slate-50 p-4">
                            <div className="flex flex-wrap items-center gap-3 justify-between">
                              <div className="flex items-center gap-2 flex-wrap">
                                {eventBadge(ev.event_type)}
                                {ev.description && (
                                  <span className="text-sm text-slate-700">{ev.description}</span>
                                )}
                              </div>
                              <div className="text-xs font-mono text-slate-400">
                                {ev.effective_date?.slice(0, 10)}
                              </div>
                            </div>
                            {ev.created_by && (
                              <p className="mt-1.5 text-xs text-slate-400">
                                Recorded by {ev.created_by} · {ev.created_at?.slice(0, 10)}
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
            <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-slate-400" />
                  Documents
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">{documents.length} documents on file</p>
              </div>
              {documents.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
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
                        const isExpiringSoon = doc.expiry_date
                          ? (new Date(doc.expiry_date).getTime() - Date.now()) / 86400000 <= 30
                          : false;
                        return (
                          <tr key={doc.id} className="border-t hover:bg-slate-50/80 transition-colors">
                            <td className="p-4 font-semibold text-slate-900">{doc.document_name}</td>
                            <td className="p-4 text-slate-500 capitalize">{doc.document_type ?? "–"}</td>
                            <td className="p-4">
                              {doc.expiry_date ? (
                                <span className={`font-mono text-xs ${isExpiringSoon ? "font-bold text-amber-600" : "text-slate-500"}`}>
                                  {doc.expiry_date.slice(0, 10)}
                                  {isExpiringSoon && " ⚠"}
                                </span>
                              ) : (
                                <span className="text-slate-400">–</span>
                              )}
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
                                  onClick={() => { setVerifyingDocId(doc.id); setVerifyForm({ remarks: "" }); }}
                                  className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  Verify
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
          <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-24 shadow-sm text-slate-400">
            <User className="mb-4 h-14 w-14 opacity-20" />
            <p className="text-lg font-semibold">Select an employee to view lifecycle</p>
            <p className="text-sm mt-1">Search by name above to get started</p>
          </div>
        )}
      </div>

      {/* Add Event Modal */}
      {showAddEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add Lifecycle Event</h2>
              <button onClick={() => setShowAddEvent(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Event Type</label>
                <select
                  value={addEventForm.event_type}
                  onChange={(e) => setAddEventForm({ ...addEventForm, event_type: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 capitalize"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Effective Date</label>
                <input
                  type="date"
                  value={addEventForm.effective_date}
                  onChange={(e) => setAddEventForm({ ...addEventForm, effective_date: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={addEventForm.description}
                  onChange={(e) => setAddEventForm({ ...addEventForm, description: e.target.value })}
                  placeholder="Optional notes about this event…"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
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

      {/* Verify Document Modal */}
      {verifyingDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Verify Document</h2>
              <button onClick={() => setVerifyingDocId(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks (optional)</label>
              <textarea
                value={verifyForm.remarks}
                onChange={(e) => setVerifyForm({ remarks: e.target.value })}
                placeholder="Add verification remarks…"
                rows={3}
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
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
