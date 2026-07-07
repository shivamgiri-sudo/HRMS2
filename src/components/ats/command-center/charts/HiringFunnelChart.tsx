import { useMemo } from "react";
import { FunnelChart, Funnel, LabelList, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

interface HiringFunnelChartProps {
  data: FunnelStage[];
  loading?: boolean;
  className?: string;
}

export function HiringFunnelChart({ data, loading, className }: HiringFunnelChartProps) {
  const funnelData = useMemo(() => {
    return data.map((stage, index) => ({
      name: stage.stage,
      value: stage.count,
      fill: [
        "#1E40AF", // Deep blue
        "#3B82F6", // Blue
        "#60A5FA", // Light blue
        "#93C5FD", // Lighter blue
        "#DBEAFE", // Lightest blue
      ][index % 5],
    }));
  }, [data]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { name: string; value: number } }[] }) => {
    if (active && payload && payload.length) {
      const stage = payload[0].payload;
      const originalStage = data.find(d => d.stage === stage.name);
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="font-semibold text-slate-900">{stage.name}</p>
          <p className="text-sm text-slate-600">
            Count: <span className="font-bold">{stage.value.toLocaleString()}</span>
          </p>
          {originalStage && (
            <p className="text-sm text-slate-600">
              Percentage: <span className="font-bold">{originalStage.percentage}%</span>
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">
          Hiring Funnel
        </CardTitle>
        <p className="text-sm text-slate-500">
          Candidate progression through recruitment stages
        </p>
      </CardHeader>
      <CardContent>
        {funnelData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <FunnelChart>
              <Tooltip content={<CustomTooltip />} />
              <Funnel
                dataKey="value"
                data={funnelData}
                isAnimationActive
                animationDuration={800}
              >
                <LabelList
                  position="right"
                  fill="#000"
                  stroke="none"
                  dataKey="name"
                  formatter={(value: string, entry: { value: number }) =>
                    `${value}: ${entry.value.toLocaleString()}`
                  }
                />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center text-slate-500">
            No funnel data available
          </div>
        )}

        {/* Drop-off indicators */}
        {data.length > 1 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Stage Drop-off
            </p>
            {data.slice(0, -1).map((stage, index) => {
              const nextStage = data[index + 1];
              const dropOff = stage.count - nextStage.count;
              const dropOffRate = stage.count > 0
                ? Math.round((dropOff / stage.count) * 100)
                : 0;

              return (
                <div
                  key={stage.stage}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs"
                >
                  <span className="text-slate-600">
                    {stage.stage} → {nextStage.stage}
                  </span>
                  <span className="font-bold text-rose-600">
                    -{dropOff.toLocaleString()} ({dropOffRate}%)
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
