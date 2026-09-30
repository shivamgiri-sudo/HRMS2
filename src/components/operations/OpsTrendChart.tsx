import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OpsTabConfig } from "./opsTabs";
import { fmtDate, type TrendPoint } from "./opsTypes";

interface Props {
  points: TrendPoint[] | undefined;
  series: NonNullable<OpsTabConfig["trend"]>;
}

export function OpsTrendChart({ points, series }: Props) {
  const hasData = !!points?.some((p) => series.some((s) => p[s.key] !== null && p[s.key] !== 0));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-foreground">Daily trend</CardTitle></CardHeader>
      <CardContent className="h-64">
        {!points ? (
          <div className="h-full animate-pulse rounded bg-muted" />
        ) : !hasData ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No daily data for this selection and period.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} fontSize={11} minTickGap={24} />
              <YAxis fontSize={11} width={40} />
              <Tooltip labelFormatter={(d: string) => fmtDate(d)} />
              <Legend />
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
