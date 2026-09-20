import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";

interface ClapData {
  customer: number;
  logistic: number;
  agent: number;
  product: number;
  total?: number;
}

const CLAP_COLORS: Record<string, string> = {
  Customer: "#2563eb",
  Logistic: "#7c3aed",
  Agent: "#dc2626",
  Product: "#d97706",
};

const CLAP_DESCRIPTIONS: Record<string, string> = {
  Customer: "Issues caused by customer behaviour or misunderstanding",
  Logistic: "Delivery, shipping, or fulfilment-related complaints",
  Agent: "Issues attributable to agent handling or script adherence",
  Product: "Product quality or feature-related complaints",
};

type Props = {
  processId: string | number | null | undefined;
};

export function ClapBreakdown({ processId }: Props) {
  const { data, isLoading } = useQuery<ClapData>({
    queryKey: ["clap-voc", processId],
    queryFn: () =>
      hrmsApi
        .get(`/api/process-operations/${processId}/voice-of-customer`)
        .then((r) => r.data?.data ?? r.data),
    enabled: !!processId,
    staleTime: 120_000,
  });

  if (!processId) return null;

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-pulse">
        <div className="h-4 w-40 bg-slate-100 rounded mb-4" />
        <div className="h-36 bg-slate-100 rounded" />
      </div>
    );
  }

  if (!data) return null;

  const buckets = [
    { name: "Customer", value: data.customer ?? 0 },
    { name: "Logistic", value: data.logistic ?? 0 },
    { name: "Agent", value: data.agent ?? 0 },
    { name: "Product", value: data.product ?? 0 },
  ].filter((b) => b.value > 0);

  const total = buckets.reduce((s, b) => s + b.value, 0);
  if (total === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4">
        CLAP — Root Cause Analysis
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
        {/* Donut */}
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie
              data={buckets}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={70}
              paddingAngle={3}
              dataKey="value"
            >
              {buckets.map((b) => (
                <Cell key={b.name} fill={CLAP_COLORS[b.name] ?? "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [`${v} (${Math.round((v / total) * 100)}%)`, name]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Legend + percentages */}
        <div className="space-y-2">
          {buckets.map((b) => {
            const pct = Math.round((b.value / total) * 100);
            return (
              <div key={b.name} className="flex items-start gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1"
                  style={{ background: CLAP_COLORS[b.name] ?? "#94a3b8" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-slate-700">{b.name}</span>
                    <span className="text-xs font-mono font-bold text-slate-900">{pct}%</span>
                  </div>
                  <div className="h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: CLAP_COLORS[b.name] ?? "#94a3b8" }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{CLAP_DESCRIPTIONS[b.name]}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400 text-right">
        {total} total complaint{total !== 1 ? "s" : ""} analysed
      </div>
    </div>
  );
}
