import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlReceivablesAgeing, type PnlReceivablesAgeingFilters } from "@/hooks/usePnlReceivablesAgeing";

/**
 * Receivables ageing buckets — days SINCE INVOICE, not days overdue (no due_date column exists).
 * Always shows the data-quality caveat badge: ~99% of the unpaid amount sits in the 90+ bucket,
 * which looks like a rarely-updated payment_status flag rather than a live AR curve.
 */

function money(value: number) {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function PnlReceivablesAgeingPanel({ filters }: { filters?: PnlReceivablesAgeingFilters }) {
  const { data, isLoading, isError, refetch } = usePnlReceivablesAgeing(filters);

  if (isLoading) return <Skeleton className="h-72 w-full rounded-none" />;
  if (isError || !data) {
    return (
      <p className="rounded-none border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
        Could not load receivables ageing.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>Retry</button>
      </p>
    );
  }

  const chartData = data.byProcess.slice(0, 15).map((row) => ({
    name: row.processName ?? "Not mapped",
    "0-30": row.buckets["0-30"],
    "31-60": row.buckets["31-60"],
    "61-90": row.buckets["61-90"],
    "90+": row.buckets["90+"],
  }));

  return (
    <Card className="rounded-none border border-border shadow-none">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-foreground">
            Receivable ageing (unpaid invoices)
          </CardTitle>
          <Badge
            variant="outline"
            className="flex items-center gap-1 border-amber-300 bg-amber-50 text-[10px] font-bold uppercase tracking-wide text-amber-700"
            title={data.caveat}
          >
            <AlertTriangle className="h-3 w-3" /> Data quality unconfirmed
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          As of {data.asOfDate} · buckets are days since invoice_date, not days overdue (no due_date
          column exists) · total unpaid {money(data.grandTotal)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          {data.caveat}
        </p>
        <div className="grid grid-cols-4 gap-2">
          {(["0-30", "31-60", "61-90", "90+"] as const).map((bucket) => (
            <div key={bucket} className="border border-border px-2 py-2 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{bucket} days</p>
              <p className="text-sm font-extrabold tabular-nums text-foreground">{money(data.totals[bucket])}</p>
            </div>
          ))}
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 89%)" />
              <XAxis type="number" tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 10 }} stroke="hsl(215 20% 35%)" />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} stroke="hsl(215 20% 35%)" />
              <Tooltip formatter={(value: number, name: string) => [money(Number(value)), name]} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="0-30" stackId="a" fill="hsl(212 74% 41%)" />
              <Bar dataKey="31-60" stackId="a" fill="#F59E0B" />
              <Bar dataKey="61-90" stackId="a" fill="#EA580C" />
              <Bar dataKey="90+" stackId="a" fill="#DC2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
