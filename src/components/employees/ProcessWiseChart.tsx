import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ProcessWiseChartProps {
  processes: Array<{ id: string; name: string; employeeCount: number }>;
}

export const ProcessWiseChart = ({ processes }: ProcessWiseChartProps) => {
  const chartData = useMemo(() => {
    return processes
      .filter((p) => p.employeeCount > 0)
      .sort((a, b) => b.employeeCount - a.employeeCount)
      .map((p) => ({
        name: p.name,
        count: p.employeeCount,
      }));
  }, [processes]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-950 mb-3">
        Process-wise Active Employees
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="name"
            stroke="#666"
            fontSize={11}
            angle={-25}
            textAnchor="end"
            height={70}
            tick={{ fill: "#475569" }}
          />
          <YAxis stroke="#666" fontSize={11} tick={{ fill: "#475569" }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              fontSize: "12px",
            }}
          />
          <Bar dataKey="count" fill="#3BAD49" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
