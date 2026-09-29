import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "./opsTypes";
import type { ForecastDay } from "./useOpsCommand";

interface Props {
  days: ForecastDay[] | undefined;
  shrinkagePct: number | null | undefined;
  mandate: number | null | undefined;
}

/** Next 14 days: people rostered to work, expected present after recent absence, against the mandate. */
export function OpsForecast({ days, shrinkagePct, mandate }: Props) {
  const data = days?.map((d) => ({ ...d, label: `${d.date.slice(8)}/${d.date.slice(5, 7)} ${d.weekday}` }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Next 14 days — roster vs mandate</CardTitle>
        <p className="text-xs text-muted-foreground">
          Expected present = rostered × (1 − {shrinkagePct ?? "—"}% recent planned + absence shrinkage; missing punches are not treated as absence).
          {mandate ? ` Mandate: ${mandate.toLocaleString("en-IN")}.` : " No mandate configured for this scope."}
        </p>
      </CardHeader>
      <CardContent className="h-72">
        {!data ? <div className="h-full animate-pulse rounded bg-muted" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="label" fontSize={10} interval={0} angle={-30} textAnchor="end" height={54} />
              <YAxis fontSize={11} width={44} />
              <Tooltip labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtDate(p[0].payload.date) : "")} />
              <Legend verticalAlign="top" />
              <Bar dataKey="rostered" name="Rostered to work" fill="#2563eb" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expectedPresent" name="Expected present" fill="#059669" radius={[3, 3, 0, 0]} />
              {mandate ? <Line dataKey="mandate" name="Mandate" stroke="#e11d48" strokeWidth={2} strokeDasharray="5 4" dot={false} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
