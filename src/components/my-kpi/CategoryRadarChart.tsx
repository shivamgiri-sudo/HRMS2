import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 12,
  color: "#0f172a",
  padding: "6px 10px",
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
};

type CategoryStat = {
  category: string;
  label: string;
  avgScore: number;
};

type Props = {
  categories: CategoryStat[];
};

export function CategoryRadarChart({ categories }: Props) {
  const data = categories.map((c) => ({
    axis: c.label.length > 10 ? c.label.substring(0, 9) + "…" : c.label,
    full: c.label,
    value: Math.round(c.avgScore),
  }));

  if (data.length < 2) return null;

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
        Category Overview
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart
          data={data}
          outerRadius="70%"
          margin={{ top: 16, right: 36, bottom: 16, left: 36 }}
        >
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: "#94a3b8" }}
            axisLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(_label, payload) =>
              payload?.[0]?.payload?.full ?? ""
            }
            formatter={(v: number) => [`${v}%`, "Score"]}
          />
          <Radar
            dataKey="value"
            stroke="#2563eb"
            fill="#2563eb"
            fillOpacity={0.12}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
