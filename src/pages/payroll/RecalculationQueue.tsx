import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const ALLOWED_ROLES = ["payroll_head", "payroll_branch", "admin", "super_admin"];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  skipped_locked: "bg-gray-100 text-gray-700",
};

interface QueueItem {
  id: number;
  employee_name: string;
  employee_code: string;
  payroll_month: string;
  source_event: string;
  reason: string;
  status: string;
  requested_at: string;
}

export default function RecalculationQueue() {
  const { user } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = user?.role ?? "";
  if (!ALLOWED_ROLES.includes(role)) {
    return <div className="p-8 text-red-600">Access denied.</div>;
  }

  const fetchQueue = () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem("token");
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (monthFilter) params.set("payrollMonth", monthFilter);
    fetch(`/api/payroll/recalculation-queue?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : data.items ?? []))
      .catch(() => setError("Failed to load recalculation queue."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchQueue(); }, [statusFilter, monthFilter]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Payroll Recalculation Queue</h1>
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="skipped_locked">Skipped (Locked)</option>
        </select>
        <Input
          className="w-36 h-8 text-sm"
          placeholder="YYYY-MM"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
        />
      </div>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Employee</th>
              <th className="text-left px-4 py-2">Code</th>
              <th className="text-left px-4 py-2">Payroll Month</th>
              <th className="text-left px-4 py-2">Source Event</th>
              <th className="text-left px-4 py-2">Reason</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Requested At</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && items.map((item) => (
              <tr key={item.id} className="border-t hover:bg-muted/40">
                <td className="px-4 py-2 font-medium">{item.employee_name}</td>
                <td className="px-4 py-2">{item.employee_code}</td>
                <td className="px-4 py-2">{item.payroll_month}</td>
                <td className="px-4 py-2">{item.source_event}</td>
                <td className="px-4 py-2 max-w-xs truncate" title={item.reason}>{item.reason}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[item.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(item.requested_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No items in queue.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
