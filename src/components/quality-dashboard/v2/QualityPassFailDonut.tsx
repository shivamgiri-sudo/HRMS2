import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { QDSummary } from "./types";
import { safeNum } from "./types";
import { PanelShell, Spinner } from "./shared";

interface Props {
  summary: QDSummary | undefined;
  loading: boolean;
}

export function QualityPassFailDonut({ summary: s, loading }: Props) {
  if (loading || !s) {
    return (
      <PanelShell title="Pass / Fail Split" subtitle="Audits above vs. below 60% threshold">
        <Spinner size="sm" />
      </PanelShell>
    );
  }

  const passed = safeNum(s.calls_above_80) + safeNum(s.calls_60_80);
  const failed = safeNum(s.calls_below_50) + safeNum(s.calls_50_60);
  const total  = passed + failed || 1;
  const passPct = Math.round((passed / total) * 100);
  const failPct = 100 - passPct;

  return (
    <PanelShell title="Pass / Fail Split" subtitle="Audits above vs. below 60% threshold">
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <ResponsiveContainer width={110} height={110}>
            <PieChart>
              <Pie
                data={[
                  { name: "Pass", value: passed },
                  { name: "Fail", value: Math.max(failed, 0) },
                ]}
                cx="50%"
                cy="50%"
                innerRadius={32}
                outerRadius={50}
                paddingAngle={2}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
              >
                <Cell fill="#22c55e" />
                <Cell fill="#ef4444" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="min-w-0 space-y-2.5">
          {[
            { label: "Pass", pct: passPct, color: "bg-emerald-500", text: "text-emerald-700" },
            { label: "Fail", pct: failPct, color: "bg-red-500",     text: "text-red-600"    },
          ].map(({ label, pct, color, text }) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
              <span className="text-sm text-slate-600">{label}</span>
              <span className={`ml-auto font-black text-base tabular-nums ${text}`}>{pct}%</span>
            </div>
          ))}
          <p className="text-[11px] text-slate-400">
            {safeNum(s.audited_calls).toLocaleString()} total audits
          </p>
        </div>
      </div>
    </PanelShell>
  );
}
