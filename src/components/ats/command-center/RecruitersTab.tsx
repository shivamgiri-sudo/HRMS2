import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

type AnyRow = Record<string, unknown>;

interface RecruitersTabProps {
  recruiterTable: AnyRow[];
  loading?: boolean;
}

function n(v: unknown) { return Number(v || 0).toLocaleString("en-IN"); }
function pct(v: unknown) { return `${Number(v || 0).toFixed(1)}%`; }
function mins(v: unknown) {
  const m = Number(v || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function RecruitersTab({ recruiterTable, loading }: RecruitersTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  const chartData = (recruiterTable || []).slice(0, 10).map((r) => ({
    name: String(r.Recruiter || "").slice(0, 12),
    Sourced: Number(r.SourcedCount || 0),
    Attended: Number(r.AttendedCount || 0),
    "Sel%": Number(r.SelectionRate || 0),
  }));

  return (
    <div className="space-y-5">
      {/* Top 3 */}
      {recruiterTable.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(recruiterTable || []).slice(0, 3).map((r, i) => (
            <div key={i} className={`rounded-lg border p-4 ${i === 0 ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-black text-slate-300">#{i + 1}</span>
                <div>
                  <p className="text-sm font-bold text-slate-900">{String(r.Recruiter || "")}</p>
                  <p className="text-xs text-slate-500">{String(r.Branch || "")}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-slate-500">Sourced</p>
                  <p className="text-sm font-bold">{n(r.SourcedCount)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Sel %</p>
                  <p className="text-sm font-bold text-emerald-700">{pct(r.SelectionRate)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">SLA %</p>
                  <p className="text-sm font-bold text-blue-700">{pct(r.SlaCompliancePercent)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Recruiter Performance</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" fontSize={10} stroke="#64748b" angle={-20} textAnchor="end" height={50} />
              <YAxis fontSize={11} stroke="#64748b" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Sourced" fill="#1e40af" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Attended" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Full Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-800">All Recruiters</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Recruiter</th>
                <th className="text-left px-3 py-2.5 font-medium">Branch</th>
                <th className="text-right px-3 py-2.5 font-medium">Sourced</th>
                <th className="text-right px-3 py-2.5 font-medium">Attended</th>
                <th className="text-right px-3 py-2.5 font-medium">Sel %</th>
                <th className="text-right px-3 py-2.5 font-medium">SLA %</th>
                <th className="text-right px-3 py-2.5 font-medium">Avg Wait</th>
                <th className="text-left px-3 py-2.5 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody>
              {(recruiterTable || []).map((r, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-800">{String(r.Recruiter || "-")}</td>
                  <td className="px-3 py-2.5 text-slate-600">{String(r.Branch || "-")}</td>
                  <td className="px-3 py-2.5 text-right">{n(r.SourcedCount)}</td>
                  <td className="px-3 py-2.5 text-right">{n(r.AttendedCount)}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-emerald-700">{pct(r.SelectionRate)}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-blue-700">{pct(r.SlaCompliancePercent)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{mins(r.AvgWaitMinutes)}</td>
                  <td className="px-3 py-2.5">
                    {r.AttentionFlag ? (
                      <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        {String(r.AttentionFlag)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(recruiterTable || []).length === 0 && (
            <p className="text-center text-xs text-slate-400 py-8">No recruiter data</p>
          )}
        </div>
      </div>
    </div>
  );
}
