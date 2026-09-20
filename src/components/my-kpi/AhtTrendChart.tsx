import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { useState } from "react";
import { DrillDownDrawer, DrawerSection, DrawerKV } from "./DrillDownDrawer";

interface AprRow {
  date: string;
  agent_code: string;
  aht_seconds: number | null;
  calls: number | null;
  login_seconds: number | null;
  shrinkage_pct: number | null;
  talk_time?: number | null;
  dispo_time?: number | null;
}

function fmtAht(sec: number | null): string {
  if (sec == null || sec === 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(d: string): string {
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return d;
  }
}

type Props = {
  refetchInterval?: number;
  targetAht?: number;
  compactMode?: boolean;
};

export function AhtTrendChart({ refetchInterval, targetAht, compactMode = false }: Props) {
  const [selectedDay, setSelectedDay] = useState<AprRow | null>(null);

  const { data: rawRows, isLoading } = useQuery<AprRow[]>({
    queryKey: ["aht-trend"],
    queryFn: () => hrmsApi.get("/api/quality-dashboard/apr").then((r) => {
      const d = r.data?.data ?? r.data;
      return Array.isArray(d) ? d : [];
    }),
    refetchInterval,
    staleTime: refetchInterval ? refetchInterval * 0.8 : 60_000,
  });

  const rows = (rawRows ?? [])
    .filter((r) => r.aht_seconds != null && r.aht_seconds > 0)
    .slice(-14)
    .map((r) => ({
      ...r,
      label: fmtDate(r.date),
      ahtMin: r.aht_seconds != null ? Math.round((r.aht_seconds / 60) * 10) / 10 : null,
    }));

  if (isLoading) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${compactMode ? "p-3" : "p-5"} animate-pulse`}>
        <div className="h-4 w-40 bg-slate-100 rounded mb-4" />
        <div className={`bg-slate-100 rounded ${compactMode ? "h-28" : "h-48"}`} />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${compactMode ? "p-3" : "p-5"} text-center`}>
        <p className="text-xs text-slate-400">No AHT data available</p>
      </div>
    );
  }

  const avg = rows.reduce((s, r) => s + (r.aht_seconds ?? 0), 0) / rows.length;
  const effectiveTarget = targetAht ?? avg * 1.1;

  return (
    <>
      <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${compactMode ? "p-3" : "p-5"}`}>
        {!compactMode && (
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">AHT Trend</p>
              <p className="text-xs text-slate-400 mt-0.5">Average Handle Time · last {rows.length} days · click a bar for details</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-extrabold font-mono text-slate-900">{fmtAht(avg)}</p>
              <p className="text-[10px] text-slate-400">period avg</p>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height={compactMode ? 120 : 200}>
          <AreaChart
            data={rows}
            margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            onClick={(e) => {
              if (e?.activePayload?.[0]?.payload) {
                setSelectedDay(e.activePayload[0].payload as AprRow);
              }
            }}
          >
            <defs>
              <linearGradient id="ahtGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity="0.15" />
                <stop offset="95%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${v}m`} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`${v}m`, "AHT"]}
              labelStyle={{ color: "#0f172a", fontWeight: 600 }}
            />
            {effectiveTarget > 0 && (
              <ReferenceLine
                y={Math.round((effectiveTarget / 60) * 10) / 10}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: "Target", fill: "#d97706", fontSize: 10, position: "right" }}
              />
            )}
            <Area
              type="monotone"
              dataKey="ahtMin"
              stroke="#2563eb"
              strokeWidth={2}
              fill="url(#ahtGrad)"
              dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }}
              activeDot={{ r: 5, className: "cursor-pointer" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Day drill-down drawer */}
      {selectedDay && (
        <DrillDownDrawer
          open={!!selectedDay}
          onClose={() => setSelectedDay(null)}
          title={`AHT Detail — ${fmtDate(selectedDay.date)}`}
          subtitle={selectedDay.agent_code}
          badge={
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {fmtAht(selectedDay.aht_seconds)}
            </span>
          }
        >
          <DrawerSection label="Time Breakdown">
            <DrawerKV label="AHT" value={fmtAht(selectedDay.aht_seconds)} />
            <DrawerKV label="Total Calls" value={selectedDay.calls ?? "—"} />
            <DrawerKV label="Login Time" value={fmtAht(selectedDay.login_seconds)} />
            <DrawerKV label="Shrinkage %" value={selectedDay.shrinkage_pct != null ? `${Math.round(selectedDay.shrinkage_pct * 10) / 10}%` : "—"} />
          </DrawerSection>
        </DrillDownDrawer>
      )}
    </>
  );
}
