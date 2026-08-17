import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { HeatmapCell } from "./types";
import { Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  from: string;
  to: string;
  queryKey: unknown[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function cellColor(score: number | undefined): string {
  if (score === undefined) return "bg-slate-100";
  if (score >= 85) return "bg-emerald-500";
  if (score >= 75) return "bg-emerald-300";
  if (score >= 65) return "bg-yellow-300";
  if (score >= 55) return "bg-orange-300";
  return "bg-red-400";
}

export function QualityHeatmapPanel({ from, to, queryKey }: Props) {
  const [hovered, setHovered] = useState<{ day: string; hour: number; cell: HeatmapCell } | null>(null);

  const { data, isLoading, isError } = useQuery<Record<string, Record<number, HeatmapCell>>>({
    queryKey: ["qd-heatmap", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ heatmap: Record<string, Record<number, HeatmapCell>> }>(
          `/api/quality-dashboard/heatmap?from=${from}&to=${to}`,
        )
        .then((r) => r.heatmap),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <PanelShell
      title="Quality Heatmap"
      subtitle="Hour × Day — hover a cell for avg score, call volume and critical count"
      action={<span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Hour × Day</span>}
    >
      {isLoading ? (
        <Spinner size="sm" />
      ) : isError ? (
        <ErrBanner msg="Failed to load heatmap" />
      ) : (
        <div className="relative overflow-x-auto">
          <div className="min-w-[680px]">
            {/* Hour labels — even hours only to avoid clutter */}
            <div className="mb-1 flex pl-20">
              {HOURS.filter((h) => h % 2 === 0).map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[9px] font-semibold text-slate-400"
                  style={{ width: `${(1 / 12) * 100}%` }}
                >
                  {h}h
                </div>
              ))}
            </div>

            {/* Grid */}
            {DAYS.map((day) => (
              <div key={day} className="mb-0.5 flex items-center gap-0.5">
                <div className="w-20 shrink-0 pr-2 text-right text-[11px] font-semibold text-slate-400">
                  {day.slice(0, 3)}
                </div>
                {HOURS.map((hour) => {
                  const cell = data?.[day]?.[hour];
                  return (
                    <div
                      key={hour}
                      className={`relative h-6 flex-1 cursor-pointer rounded-sm transition-transform hover:z-10 hover:scale-110 ${cellColor(cell?.score)}`}
                      onMouseEnter={() => cell && setHovered({ day, hour, cell })}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
              </div>
            ))}

            {/* Legend */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="font-semibold">Quality:</span>
              {[
                { color: "bg-red-400",     label: "<55%" },
                { color: "bg-orange-300",  label: "55–64%" },
                { color: "bg-yellow-300",  label: "65–74%" },
                { color: "bg-emerald-300", label: "75–84%" },
                { color: "bg-emerald-500", label: "≥85%" },
                { color: "bg-slate-100",   label: "No data" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1">
                  <div className={`h-3 w-3 rounded-sm ${color}`} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tooltip */}
          {hovered && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
              <p className="font-bold text-slate-900">
                {hovered.day} {hovered.hour}:00
              </p>
              <p className="text-slate-600">
                Avg Score: <strong>{hovered.cell.score}%</strong>
              </p>
              <p className="text-slate-600">Calls: {hovered.cell.calls}</p>
              {hovered.cell.critical > 0 && (
                <p className="font-semibold text-red-600">Critical: {hovered.cell.critical}</p>
              )}
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}
