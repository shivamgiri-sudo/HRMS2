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
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  fontSize: 12,
  color: "#f1f5f9",
  padding: "6px 10px",
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
    <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-5 border border-slate-800/80">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
        Category Overview
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart
          data={data}
          outerRadius="70%"
          margin={{ top: 16, right: 36, bottom: 16, left: 36 }}
        >
          <PolarGrid stroke="#1e293b" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 11, fill: "#94a3b8", fontWeight: 600 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: "#475569" }}
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
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.15}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
