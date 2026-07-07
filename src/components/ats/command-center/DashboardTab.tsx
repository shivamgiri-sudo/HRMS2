import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

type AnyRow = Record<string, unknown>;

interface DashboardTabProps {
  dashboardRows: AnyRow[];
  branchTable: AnyRow[];
  loading?: boolean;
}

function n(v: unknown) { return Number(v || 0).toLocaleString("en-IN"); }
function pct(v: unknown) { return `${Number(v || 0).toFixed(1)}%`; }
function mins(v: unknown) {
  const m = Number(v || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function DashboardTab({ dashboardRows, branchTable, loading }: DashboardTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  const chartData = dashboardRows.map((row) => ({
    period: String(row.Date || ""),
    "Arrivals": Number(row["Total Arrival"] || 0),
    "Selected": Number(row.Selection || 0),
    "Rejected": Number(row.Rejection || 0),
    "SLA Breach": Number(row["SLA Breach"] || 0),
  }));

  return (
    <div className="space-y-5">
      {/* Period Chart */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-3">Period Breakdown (FTD / WTD / MTD)</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" fontSize={12} stroke="#64748b" />
              <YAxis fontSize={11} stroke="#64748b" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Arrivals" fill="#1e40af" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Selected" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Rejected" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="SLA Breach" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-slate-400">No period data</div>
        )}
      </div>

      {/* Dashboard Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-800">Detailed Period View</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Period</th>
                <th className="text-right px-3 py-2.5 font-medium">Arrival</th>
                <th className="text-right px-3 py-2.5 font-medium">Selected</th>
                <th className="text-right px-3 py-2.5 font-medium">Rejected</th>
                <th className="text-right px-3 py-2.5 font-medium">Pending</th>
                <th className="text-right px-3 py-2.5 font-medium">SLA Breach</th>
                <th className="text-right px-3 py-2.5 font-medium">Avg Wait</th>
              </tr>
            </thead>
            <tbody>
              {dashboardRows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-bold text-slate-900">{String(row.Date || "-")}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{n(row["Total Arrival"])}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700 font-medium">{n(row.Selection)}</td>
                  <td className="px-3 py-2.5 text-right text-rose-700 font-medium">{n(row.Rejection)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{n(row.Pending)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-700 font-medium">{n(row["SLA Breach"])}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{mins(row["Avg Time"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dashboardRows.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No dashboard data</p>
          )}
        </div>
      </div>

      {/* Branch Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-800">Branch Summary</h3>
        </div>
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Branch</th>
                <th className="text-right px-3 py-2.5 font-medium">Arrival</th>
                <th className="text-right px-3 py-2.5 font-medium">Selected</th>
                <th className="text-right px-3 py-2.5 font-medium">Waiting</th>
                <th className="text-right px-3 py-2.5 font-medium">SLA</th>
                <th className="text-right px-3 py-2.5 font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {branchTable.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-800">{String(row.Name || "-")}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{n(row.TotalArrival)}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700 font-medium">{n(row.Selection)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{n(row.Waiting)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-700">{n(row.SlaBreach)}</td>
                  <td className="px-3 py-2.5 text-right text-blue-700 font-medium">{pct(row.SelectionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {branchTable.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No branch data</p>
          )}
        </div>
      </div>
    </div>
  );
}
