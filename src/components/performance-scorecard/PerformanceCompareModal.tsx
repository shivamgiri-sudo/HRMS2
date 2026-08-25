import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { ScorecardRow } from "./performanceScorecardColumns";

// teamAttritionPct/teamShrinkagePct/teamRevenue are hardcoded null by the
// backend today (performance-scorecard-snapshot.service.ts — the KPI-role-
// template metric computation was never built), so they're deliberately
// excluded here — a selectable series that always plots a flat empty line
// would look like a broken chart rather than an unbuilt feature. Only
// lateByMinutes and qualityScore are real, populated per-row metrics.
const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
  { key: "qualityScore", label: "Quality", color: "#15803d" },
];

interface PerformanceCompareModalProps {
  open: boolean;
  onClose: () => void;
  employeeName: string;
  rows: ScorecardRow[]; // all snapshot-date rows for one employee across the selected range
}

export default function PerformanceCompareModal({ open, onClose, employeeName, rows }: PerformanceCompareModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["lateByMinutes", "qualityScore"]));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < 4) next.add(key);
      return next;
    });
  };

  const chartData = rows.map((r) => ({
    date: r.snapshotDate,
    lateByMinutes: r.lateByMinutes,
    qualityScore: r.qualityScore,
  }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare metrics — {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 flex-wrap mb-4">
          {COMPARABLE_METRICS.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.has(m.key as string)} onCheckedChange={() => toggle(m.key as string)} />
              {m.label}
            </label>
          ))}
        </div>
        {chartData.length === 0 ? (
          <div className="text-sm text-gray-500 py-10 text-center">No data points in the selected date range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              {COMPARABLE_METRICS.filter((m) => selected.has(m.key as string)).map((m) => (
                <Line key={m.key} type="monotone" dataKey={m.key as string} stroke={m.color} name={m.label} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </DialogContent>
    </Dialog>
  );
}
