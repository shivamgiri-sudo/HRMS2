import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell
} from "recharts";

type AnyRow = Record<string, unknown>;

interface SourcingTabProps {
  sourceTable: AnyRow[];
  reusablePool: AnyRow[];
  loading?: boolean;
}

const COLORS = ["#0f172a", "#1e40af", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#6366f1", "#a78bfa"];

function n(v: unknown) { return Number(v || 0).toLocaleString("en-IN"); }
function pct(v: unknown) { return `${Number(v || 0).toFixed(1)}%`; }

export function SourcingTab({ sourceTable, reusablePool, loading }: SourcingTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  const chartData = (sourceTable || []).map((s) => ({
    name: String(s.Name || "").slice(0, 14),
    Arrivals: Number(s.TotalArrival || 0),
    Selected: Number(s.Selection || 0),
    Rejected: Number(s.Rejection || 0),
  }));

  const pieData = (sourceTable || []).slice(0, 6).map((s) => ({
    name: String(s.Name || "Unknown"),
    value: Number(s.TotalArrival || 0),
  }));

  return (
    <div className="space-y-5">
      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pie */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Source Mix</h3>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={85} dataKey="value" stroke="none">
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {pieData.map((s, idx) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[idx % COLORS.length] }} />
                    <span className="flex-1 truncate text-slate-700">{s.name}</span>
                    <span className="font-bold text-slate-900">{n(s.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-52 items-center justify-center text-sm text-slate-400">No source data</div>
          )}
        </div>

        {/* Bar */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Source Performance</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" fontSize={10} stroke="#64748b" angle={-20} textAnchor="end" height={50} />
                <YAxis fontSize={11} stroke="#64748b" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Arrivals" fill="#1e40af" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Selected" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-52 items-center justify-center text-sm text-slate-400">No source data</div>
          )}
        </div>
      </div>

      {/* Source Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-800">Source Channel Details</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Source</th>
                <th className="text-right px-3 py-2.5 font-medium">Arrival</th>
                <th className="text-right px-3 py-2.5 font-medium">Selected</th>
                <th className="text-right px-3 py-2.5 font-medium">Rejected</th>
                <th className="text-right px-3 py-2.5 font-medium">Selection Rate</th>
              </tr>
            </thead>
            <tbody>
              {(sourceTable || []).map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-800">{String(row.Name || "-")}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{n(row.TotalArrival)}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700 font-medium">{n(row.Selection)}</td>
                  <td className="px-3 py-2.5 text-right text-rose-700">{n(row.Rejection)}</td>
                  <td className="px-3 py-2.5 text-right text-blue-700 font-medium">{pct(row.SelectionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(sourceTable || []).length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No source data</p>
          )}
        </div>
      </div>

      {/* Reusable Pool */}
      {(reusablePool || []).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-bold text-slate-800">Reusable Pool ({reusablePool.length})</h3>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">ID</th>
                  <th className="text-left px-3 py-2 font-medium">Candidate</th>
                  <th className="text-left px-3 py-2 font-medium">Branch</th>
                  <th className="text-left px-3 py-2 font-medium">Quality</th>
                  <th className="text-left px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {reusablePool.slice(0, 30).map((row, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-600">{String(row.CandidateID || "-")}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{String(row.FullName || "-")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(row.Branch || "-")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(row._candidateQualityLabel || "-")}</td>
                    <td className="px-3 py-2 text-blue-700">{String(row._reusableReason || "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
