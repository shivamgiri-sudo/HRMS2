import React from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type TrendType = "up" | "down" | "stable";
type StatusType = "ok" | "warn" | "critical" | "unknown";

interface KpiTile {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ReactNode;
  accent: string;
  trend?: TrendType;
  variancePct?: number | null;
  status?: StatusType;
  href?: string;
}

interface KpiRowProps {
  tiles: KpiTile[];
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function StatusDot({ status }: { status?: StatusType }) {
  if (!status || status === "unknown") return null;

  const classMap: Record<StatusType, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-400",
    critical: "bg-red-500 animate-pulse",
    unknown: "bg-slate-300",
  };

  return (
    <span
      className={`absolute top-3 right-3 w-2 h-2 rounded-full ${classMap[status]}`}
    />
  );
}

function TrendBadge({
  trend,
  variancePct,
}: {
  trend?: TrendType;
  variancePct?: number | null;
}) {
  if (!trend || variancePct == null) return null;

  if (trend === "stable") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-400">
        <Minus className="w-3 h-3" />
        {variancePct}%
      </span>
    );
  }

  const isUp = trend === "up";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
        isUp ? "text-emerald-600" : "text-red-500"
      }`}
    >
      {isUp ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      {variancePct}%
    </span>
  );
}

function TileCard({ tile }: { tile: KpiTile }) {
  const iconBg = hexToRgba(tile.accent, 0.15);

  const inner = (
    <div
      className="relative bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 flex flex-col gap-2 hover:-translate-y-0.5 hover:shadow-md transition-all duration-150 h-full"
      style={{ borderLeft: `4px solid ${tile.accent}` }}
    >
      <StatusDot status={tile.status} />

      {/* Icon badge */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: iconBg, color: tile.accent }}
      >
        {tile.icon}
      </div>

      {/* Label */}
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider leading-tight">
        {tile.label}
      </p>

      {/* Value */}
      <p
        className="text-2xl font-black text-slate-900 leading-tight"
        style={{ fontFamily: "'Fira Code', monospace" }}
      >
        {tile.value}
      </p>

      {/* Helper + Trend */}
      <div className="flex items-center justify-between gap-1 mt-auto">
        <span className="text-xs text-slate-500 leading-tight">{tile.helper}</span>
        <TrendBadge trend={tile.trend} variancePct={tile.variancePct} />
      </div>
    </div>
  );

  if (tile.href) {
    return (
      <Link to={tile.href} className="block h-full">
        {inner}
      </Link>
    );
  }

  return inner;
}

export function KpiRow({ tiles }: KpiRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {tiles.map((tile, i) => (
        <TileCard key={i} tile={tile} />
      ))}
    </div>
  );
}

export default KpiRow;
