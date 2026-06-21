import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";

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
  old_value_json: any;
  new_value_json: any;
  acted_at: string;
}

const roleColor: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-800",
  admin: "bg-red-100 text-red-800",
  payroll_head: "bg-orange-100 text-orange-800",
  hr: "bg-blue-100 text-blue-800",
  wfm: "bg-green-100 text-green-800",
  manager: "bg-gray-100 text-gray-800",
};

export default function NativeAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

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

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0,
  });

  const fetchEvents = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.fromDate) params.append("fromDate", filters.fromDate);
      if (filters.toDate) params.append("toDate", filters.toDate);
      if (filters.employeeId) params.append("employeeId", filters.employeeId);
      if (filters.actorRole) params.append("actorRole", filters.actorRole);
      if (filters.module) params.append("module", filters.module);
      if (filters.actionType) params.append("actionType", filters.actionType);
      params.append("page", String(filters.page));
      params.append("limit", String(filters.limit));

      const resp = await hrmsApi.get<{ success: boolean; data: AuditEvent[]; pagination: any; error?: string }>("/api/access/audit-log?" + params.toString());
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
  };

  useEffect(() => {
    fetchEvents();
  }, [filters.page, filters.limit]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { getAuthToken } = await import("@/lib/hrmsApi");
      const token = getAuthToken();
      const baseUrl = import.meta.env.VITE_HRMS_API_URL?.replace(/\/$/, "") || (import.meta.env.DEV ? "http://localhost:5055" : "");
      const res = await fetch(`${baseUrl}/api/audit/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

  const handleSearch = () => {
    setFilters({ ...filters, page: 1 });
    fetchEvents();
  };

  return (
    <DashboardLayout pageTitle="Audit Log">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-semibold">From Date</label>
                <Input
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">To Date</label>
                <Input
                  type="date"
                  value={filters.toDate}
                  onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Employee ID</label>
                <Input
                  value={filters.employeeId}
                  onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
                  placeholder="Search employee..."
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Actor Role</label>
                <select
                  className="w-full border rounded p-2 mt-1"
                  value={filters.actorRole}
                  onChange={(e) => setFilters({ ...filters, actorRole: e.target.value })}
                >
                  <option value="">All Roles</option>
                  <option value="super_admin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="payroll_head">Payroll Head</option>
                  <option value="hr">HR</option>
                  <option value="wfm">WFM</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold">Module</label>
                <select
                  className="w-full border rounded p-2 mt-1"
                  value={filters.module}
                  onChange={(e) => setFilters({ ...filters, module: e.target.value })}
                >
                  <option value="">All Modules</option>
                  <option value="attendance">Attendance</option>
                  <option value="payroll">Payroll</option>
                  <option value="audit">Audit</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold">Action Type</label>
                <Input
                  value={filters.actionType}
                  onChange={(e) => setFilters({ ...filters, actionType: e.target.value })}
                  placeholder="e.g. REGULARIZATION_APPROVED"
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSearch} disabled={loading}>
                Search
              </Button>
              <Button
                variant="secondary"
                onClick={handleExport}
                disabled={exporting || events.length === 0}
                className="gap-2"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </CardContent>
          </Card>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12 text-gray-500">
              No audit events found
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow key={event.id} className="hover:bg-gray-50">
                        <TableCell className="font-mono">
                          {new Date(event.acted_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{event.actor_email || event.actor_user_id}</TableCell>
                        <TableCell>
                          <Badge className={roleColor[event.actor_role] || "bg-gray-100"}>
                            {event.actor_role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{event.module_key}</TableCell>
                        <TableCell className="font-mono text-xs">{event.action_type}</TableCell>
                        <TableCell className="text-xs">
                          {event.entity_type} ({event.entity_id?.substring(0, 8)}...)
                        </TableCell>
                        <TableCell className="text-xs">{event.employee_id?.substring(0, 8) || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate text-xs">
                          {event.reason ? (
                            <span title={event.reason}>{event.reason.substring(0, 50)}</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {pagination.pages > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm">
                  <span>
                    Page {pagination.page} of {pagination.pages} (Total: {pagination.total})
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page === 1}
                      onClick={() => setFilters({ ...filters, page: pagination.page - 1 })}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page === pagination.pages}
                      onClick={() => setFilters({ ...filters, page: pagination.page + 1 })}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
