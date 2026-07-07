import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

type AnyRow = Record<string, unknown>;

interface TrendsTabProps {
  processTable: AnyRow[];
  sourceTable: AnyRow[];
  slotTable: AnyRow[];
  loading?: boolean;
}

function n(v: unknown) { return Number(v || 0).toLocaleString("en-IN"); }
function pct(v: unknown) { return `${Number(v || 0).toFixed(1)}%`; }
function mins(v: unknown) {
  const m = Number(v || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function TrendsTab({ processTable, sourceTable, slotTable, loading }: TrendsTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  const processChartData = (processTable || []).slice(0, 8).map((p) => ({
    name: String(p.Name || "").slice(0, 14),
    Arrivals: Number(p.TotalArrival || 0),
    Selected: Number(p.Selection || 0),
    Rejected: Number(p.Rejection || 0),
  }));

  return (
    <div className="space-y-5">
      {/* Process Chart */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-3">By Process</h3>
        {processChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={processChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" fontSize={10} stroke="#64748b" angle={-20} textAnchor="end" height={50} />
              <YAxis fontSize={11} stroke="#64748b" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Arrivals" fill="#1e40af" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Selected" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Rejected" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-slate-400">No process data</div>
        )}
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Source Table */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-bold text-slate-800">By Source Channel</h3>
          </div>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                  <th className="text-right px-3 py-2 font-medium">Arrival</th>
                  <th className="text-right px-3 py-2 font-medium">Selected</th>
                  <th className="text-right px-3 py-2 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(sourceTable || []).map((row, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">{String(row.Name || "-")}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{n(row.TotalArrival)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">{n(row.Selection)}</td>
                    <td className="px-3 py-2 text-right text-blue-700">{pct(row.SelectionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(sourceTable || []).length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">No source data</p>
            )}
          </div>
        </div>

        {/* Slot Table */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-bold text-slate-800">By Time Slot</h3>
          </div>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Slot</th>
                  <th className="text-right px-3 py-2 font-medium">Arrival</th>
                  <th className="text-right px-3 py-2 font-medium">Selected</th>
                  <th className="text-right px-3 py-2 font-medium">SLA</th>
                  <th className="text-right px-3 py-2 font-medium">Avg Wait</th>
                </tr>
              </thead>
              <tbody>
                {(slotTable || []).map((row, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">{String(row.Name || "-")}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{n(row.TotalArrival)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">{n(row.Selection)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{n(row.SlaBreach)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{mins(row.AvgWaitMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(slotTable || []).length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">No slot data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
