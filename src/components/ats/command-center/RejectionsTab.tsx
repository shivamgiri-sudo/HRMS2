import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

type AnyRow = Record<string, unknown>;

interface RejectionsTabProps {
  candidateRows: AnyRow[];
  loading?: boolean;
}

const COLORS = ["#dc2626", "#ef4444", "#f87171", "#fca5a5", "#fecaca", "#991b1b", "#b91c1c", "#7f1d1d"];

function n(v: unknown) { return Number(v || 0).toLocaleString("en-IN"); }

export function RejectionsTab({ candidateRows, loading }: RejectionsTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  const rejections = (candidateRows || []).filter((r) => r._rejected || r._hardRejectReason);

  // Group by rejection reason
  const reasonMap: Record<string, number> = {};
  rejections.forEach((r) => {
    const reason = String(r._hardRejectReason || r.rejection_voc || "Unspecified");
    reasonMap[reason] = (reasonMap[reason] || 0) + 1;
  });

  const reasonData = Object.entries(reasonMap)
    .map(([reason, count]) => ({ name: reason, value: count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const total = rejections.length;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Total Rejections</p>
          <p className="text-2xl font-bold text-rose-700 mt-1">{n(total)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Unique Reasons</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{Object.keys(reasonMap).length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Top Reason</p>
          <p className="text-sm font-bold text-slate-900 mt-1">{reasonData[0]?.name || "N/A"}</p>
          <p className="text-xs text-slate-500">{reasonData[0]?.value || 0} candidates</p>
        </div>
      </div>

      {/* Pie + Legend */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-3">Rejection Reasons</h3>
        {reasonData.length > 0 ? (
          <div className="flex flex-col lg:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={260} className="max-w-xs">
              <PieChart>
                <Pie data={reasonData} cx="50%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" stroke="none">
                  {reasonData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2 w-full">
              {reasonData.map((r, idx) => (
                <div key={r.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: COLORS[idx % COLORS.length] }} />
                  <span className="flex-1 text-slate-700 truncate">{r.name}</span>
                  <span className="font-bold text-slate-900">{r.value}</span>
                  <span className="text-slate-500 w-10 text-right">{total > 0 ? `${Math.round((r.value / total) * 100)}%` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-slate-400">No rejections in this period</div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-800">Rejected Candidates ({total})</h3>
        </div>
        <div className="overflow-auto max-h-96">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium">ID</th>
                <th className="text-left px-3 py-2 font-medium">Candidate</th>
                <th className="text-left px-3 py-2 font-medium">Branch</th>
                <th className="text-left px-3 py-2 font-medium">Stage</th>
                <th className="text-left px-3 py-2 font-medium">Reason</th>
                <th className="text-left px-3 py-2 font-medium">VOC</th>
              </tr>
            </thead>
            <tbody>
              {rejections.slice(0, 50).map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-600">{String(row.CandidateID || "-")}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{String(row.FullName || "-")}</td>
                  <td className="px-3 py-2 text-slate-600">{String(row.Branch || "-")}</td>
                  <td className="px-3 py-2 text-slate-600">{String(row._endStage || "-")}</td>
                  <td className="px-3 py-2 text-rose-700 font-medium">{String(row._hardRejectReason || "-")}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[150px] truncate">{String(row.rejection_voc || "-")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rejections.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No rejections in this period</p>
          )}
        </div>
      </div>
    </div>
  );
}
