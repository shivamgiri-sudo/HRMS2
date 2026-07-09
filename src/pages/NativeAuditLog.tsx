import { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { apiUrl } from "@/lib/apiBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Loader2, RefreshCw, ChevronLeft, ChevronRight, Eye, Shield, Clock, User } from "lucide-react";
import { formatIST } from "@/lib/utils";

interface AuditEvent {
  id: string;
  actor_user_id: string;
  actor_email: string;
  actor_role: string;
  action_type: string;
  module_key: string;
  entity_type: string;
  entity_id: string;
  employee_id: string | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  change_summary: any;
  old_value_json: any;
  new_value_json: any;
  acted_at: string;
}

function extractLocation(event: AuditEvent): string | null {
  const cs = event.change_summary;
  if (!cs) return null;
  const parsed = typeof cs === "string" ? (() => { try { return JSON.parse(cs); } catch { return null; } })() : cs;
  return parsed?.location ?? null;
}

function extractIp(event: AuditEvent): string | null {
  return event.ip_address ?? ((() => {
    const cs = event.change_summary;
    if (!cs) return null;
    const parsed = typeof cs === "string" ? (() => { try { return JSON.parse(cs); } catch { return null; } })() : cs;
    return parsed?.ip ?? null;
  })());
}

const MODULE_OPTIONS = [
  { value: "", label: "All Modules" },
  { value: "AUTH", label: "Authentication" },
  { value: "attendance", label: "Attendance" },
  { value: "payroll", label: "Payroll" },
  { value: "leave", label: "Leave" },
  { value: "employee", label: "Employee" },
  { value: "ats", label: "ATS / Recruitment" },
  { value: "bgv", label: "BGV" },
  { value: "access", label: "Access Control" },
  { value: "audit", label: "Audit" },
  { value: "wfm", label: "WFM / Roster" },
  { value: "assets", label: "Assets" },
  { value: "documents", label: "Documents" },
  { value: "exit", label: "Exit" },
];

const ROLE_OPTIONS = [
  { value: "", label: "All Roles" },
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "payroll_head", label: "Payroll Head" },
  { value: "hr", label: "HR" },
  { value: "wfm", label: "WFM" },
  { value: "manager", label: "Manager" },
  { value: "employee", label: "Employee" },
];

const roleStyle: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-800 border-purple-200",
  admin: "bg-red-100 text-red-800 border-red-200",
  payroll_head: "bg-orange-100 text-orange-800 border-orange-200",
  hr: "bg-blue-100 text-blue-800 border-blue-200",
  wfm: "bg-green-100 text-green-800 border-green-200",
  manager: "bg-gray-100 text-gray-800 border-gray-200",
  employee: "bg-slate-100 text-slate-700 border-slate-200",
};

const actionStyle: Record<string, string> = {
  LOGIN_SUCCESS: "bg-emerald-100 text-emerald-800",
  LOGIN_FAILED: "bg-red-100 text-red-800",
  LOGOUT: "bg-slate-100 text-slate-700",
  PAYSLIP_HISTORY_VIEWED: "bg-blue-100 text-blue-800",
  AUDIT_LOG_EXPORTED: "bg-amber-100 text-amber-800",
  ROLE_GRANTED: "bg-purple-100 text-purple-800",
  ROLE_REVOKED: "bg-pink-100 text-pink-800",
};

function actionBadgeStyle(action: string): string {
  const direct = actionStyle[action];
  if (direct) return direct;
  if (action.includes("DELETE") || action.includes("REVOKE") || action.includes("REJECT") || action.includes("FAILED"))
    return "bg-red-100 text-red-800";
  if (action.includes("CREATE") || action.includes("ADD") || action.includes("SUCCESS") || action.includes("APPROVE"))
    return "bg-emerald-100 text-emerald-800";
  if (action.includes("UPDATE") || action.includes("EDIT") || action.includes("MODIFY"))
    return "bg-blue-100 text-blue-800";
  if (action.includes("VIEW") || action.includes("EXPORT") || action.includes("DOWNLOAD"))
    return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

function moduleLabel(key: string): string {
  if (!key) return "—";
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function entityDisplay(type: string, id: string): string {
  if (!type && !id) return "—";
  if (!id) return type;
  const short = id.length > 12 ? `${id.substring(0, 8)}…` : id;
  return type ? `${type} · ${short}` : short;
}

export default function NativeAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    fromDate: "",
    toDate: "",
    employeeId: "",
    actorRole: "",
    module: "",
    actionType: "",
    page: 1,
    limit: 50,
  });

  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });

  const fetchEvents = useCallback(async (overrides?: Partial<typeof filters>) => {
    const active = { ...filters, ...overrides };
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (active.fromDate) params.append("fromDate", active.fromDate);
      if (active.toDate) params.append("toDate", active.toDate);
      if (active.employeeId) params.append("employeeId", active.employeeId);
      if (active.actorRole) params.append("actorRole", active.actorRole);
      if (active.module) params.append("module", active.module);
      if (active.actionType) params.append("actionType", active.actionType);
      params.append("page", String(active.page));
      params.append("limit", String(active.limit));

      const resp = await hrmsApi.get<{ success: boolean; data: AuditEvent[]; pagination: any; error?: string }>(
        "/api/access/audit-log?" + params.toString()
      );
      if (resp.success) {
        setEvents(resp.data || []);
        setPagination(resp.pagination || {});
      } else {
        setError(resp.error || "Failed to load audit log");
      }
    } catch (err: any) {
      setError(err.message || "Error loading audit log");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchEvents(); }, []);

  const handleSearch = () => {
    const updated = { ...filters, page: 1 };
    setFilters(updated);
    fetchEvents(updated);
  };

  const handlePageChange = (newPage: number) => {
    const updated = { ...filters, page: newPage };
    setFilters(updated);
    fetchEvents(updated);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { getAuthToken } = await import("@/lib/hrmsApi");
      const token = getAuthToken();
      const res = await fetch(apiUrl("/api/audit/export"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          employeeId: filters.employeeId,
          actorRole: filters.actorRole,
          module: filters.module,
          actionType: filters.actionType,
        }),
      });
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `audit-log-${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <DashboardLayout pageTitle="Audit Log">
      <div className="space-y-5">

        {/* Stats summary bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border rounded-lg p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg"><Shield className="h-5 w-5 text-blue-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Total Events</p>
              <p className="text-xl font-bold text-gray-900">{pagination.total.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white border rounded-lg p-4 flex items-center gap-3">
            <div className="p-2 bg-emerald-50 rounded-lg"><User className="h-5 w-5 text-emerald-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Page {pagination.page} of {pagination.pages || 1}</p>
              <p className="text-xl font-bold text-gray-900">{events.length} shown</p>
            </div>
          </div>
          <div className="bg-white border rounded-lg p-4 flex items-center gap-3 col-span-2">
            <div className="p-2 bg-amber-50 rounded-lg"><Clock className="h-5 w-5 text-amber-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Latest event</p>
              <p className="text-sm font-semibold text-gray-800 truncate">
                {events[0] ? formatIST(events[0].acted_at) : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">From Date</label>
                <Input
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">To Date</label>
                <Input
                  type="date"
                  value={filters.toDate}
                  onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Actor Role</label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filters.actorRole}
                  onChange={(e) => setFilters((f) => ({ ...f, actorRole: e.target.value }))}
                >
                  {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Module</label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filters.module}
                  onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))}
                >
                  {MODULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Action Type</label>
                <Input
                  value={filters.actionType}
                  onChange={(e) => setFilters((f) => ({ ...f, actionType: e.target.value }))}
                  placeholder="e.g. LOGIN_FAILED"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Employee ID</label>
                <Input
                  value={filters.employeeId}
                  onChange={(e) => setFilters((f) => ({ ...f, employeeId: e.target.value }))}
                  placeholder="Filter by employee ID"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Results per page</label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filters.limit}
                  onChange={(e) => setFilters((f) => ({ ...f, limit: Number(e.target.value) }))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={handleSearch} disabled={loading} className="flex-1">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Search
                </Button>
                <Button variant="outline" size="icon" onClick={() => fetchEvents()} title="Refresh">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">
              Events
              {pagination.total > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()})
                </span>
              )}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting || events.length === 0}
              className="gap-2"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No audit events match the current filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Timestamp</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actor</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Role</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Module</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Action</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Entity</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Employee ID</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">IP / Location</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Reason / Summary</th>
                      <th className="px-4 py-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {events.map((event) => (
                      <>
                        <tr
                          key={event.id}
                          className="hover:bg-blue-50 transition-colors cursor-default"
                          onClick={() => setExpandedRow(expandedRow === event.id ? null : event.id)}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                            {formatIST(event.acted_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                              {event.actor_email || <span className="text-gray-400 font-mono text-xs">{event.actor_user_id?.substring(0, 12)}…</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {event.actor_role ? (
                              <Badge className={`text-xs border ${roleStyle[event.actor_role] || "bg-gray-100 text-gray-700"}`}>
                                {event.actor_role.replace(/_/g, " ")}
                              </Badge>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                            {moduleLabel(event.module_key)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`text-xs font-mono ${actionBadgeStyle(event.action_type)}`}>
                              {event.action_type}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">
                            {entityDisplay(event.entity_type, event.entity_id)}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-gray-500">
                            {event.employee_id
                              ? <span title={event.employee_id}>{event.employee_id.substring(0, 8)}…</span>
                              : <span className="text-gray-300">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            <div className="font-mono">{extractIp(event) || <span className="text-gray-300">—</span>}</div>
                            {extractLocation(event) && (
                              <div className="text-gray-400 mt-0.5">{extractLocation(event)}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px]">
                            {event.reason || event.change_summary ? (
                              <span className="truncate block" title={event.reason || event.change_summary || ""}>
                                {(event.reason || event.change_summary || "").substring(0, 60)}
                                {(event.reason || event.change_summary || "").length > 60 ? "…" : ""}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {(event.old_value_json || event.new_value_json) && (
                              <button
                                className="p-1 rounded hover:bg-blue-100 text-blue-500"
                                title="View change detail"
                                onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === event.id ? null : event.id); }}
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                        {expandedRow === event.id && (
                          <tr key={`${event.id}-detail`} className="bg-blue-50">
                            <td colSpan={10} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Event ID</p>
                                  <p className="font-mono text-xs text-gray-700 break-all">{event.id}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Actor User ID</p>
                                  <p className="font-mono text-xs text-gray-700 break-all">{event.actor_user_id}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">IP Address</p>
                                  <p className="font-mono text-xs text-gray-700">{extractIp(event) || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Location</p>
                                  <p className="text-xs text-gray-700">{extractLocation(event) || "—"}</p>
                                </div>
                                {event.user_agent && (
                                  <div className="md:col-span-2">
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">User Agent</p>
                                    <p className="text-xs text-gray-600 break-all">{event.user_agent}</p>
                                  </div>
                                )}
                                {event.old_value_json && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Previous Value</p>
                                    <pre className="text-xs bg-white border rounded p-2 overflow-auto max-h-32 text-gray-700">
                                      {JSON.stringify(event.old_value_json, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {event.new_value_json && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">New Value</p>
                                    <pre className="text-xs bg-white border rounded p-2 overflow-auto max-h-32 text-gray-700">
                                      {JSON.stringify(event.new_value_json, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                <span className="text-sm text-gray-600">
                  Page <strong>{pagination.page}</strong> of <strong>{pagination.pages}</strong>
                  <span className="text-gray-400 ml-2">({pagination.total.toLocaleString()} total)</span>
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => handlePageChange(pagination.page + 1)}
                    className="gap-1"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
