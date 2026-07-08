import React from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type TrendType = "up" | "down" | "stable";
type StatusType = "ok" | "warn" | "critical" | "unknown";

export interface KpiTile {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ReactNode;
  accent: string;
  trend?: TrendType;
  variancePct?: number | null;
  varianceLabel?: string;
  status?: StatusType;
  href?: string;
}

interface KpiRowProps {
  tiles: KpiTile[];
  cols?: 4 | 6 | 7;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function DeltaBadge({ trend, variancePct, varianceLabel }: { trend?: TrendType; variancePct?: number | null; varianceLabel?: string }) {
  if (!trend) return null;
  if (trend === "stable") return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-400">
      <Minus className="w-3 h-3" />
      {variancePct != null ? `${Math.abs(variancePct)}%` : varianceLabel ?? "stable"}
    </span>
  );
  const isUp = trend === "up";
  const color = isUp ? "text-emerald-600" : "text-red-500";
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Icon className="w-3 h-3" />
      {variancePct != null ? `${Math.abs(variancePct)}%` : varianceLabel}
    </span>
  );
}

function TileCard({ tile }: { tile: KpiTile }) {
  const iconBg = hexToRgba(tile.accent, 0.12);
  const statusDot: Record<StatusType, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-400",
    critical: "bg-red-500 animate-pulse",
    unknown: "bg-slate-300",
  };

  const inner = (
    <div
      className="relative bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex flex-col gap-3
        hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 cursor-pointer h-full"
      style={{ borderLeft: `3px solid ${tile.accent}` }}
    >
      {/* Status dot */}
      {tile.status && tile.status !== "unknown" && (
        <span className={`absolute top-3.5 right-3.5 w-2 h-2 rounded-full ${statusDot[tile.status]}`} />
      )}

      {/* Icon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: iconBg, color: tile.accent }}
      >
        <span className="[&_svg]:w-4 [&_svg]:h-4">{tile.icon}</span>
      </div>

      {/* Label */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 leading-none">
        {tile.label}
      </p>

      {/* Value */}
      <p
        className="text-2xl font-bold text-slate-900 leading-none"
        style={{ fontFamily: "'Fira Code', monospace" }}
      >
        {tile.value}
      </p>

      {/* Helper + Delta */}
      <div className="flex items-center justify-between gap-2 mt-auto">
        <span className="text-xs text-slate-400 leading-none truncate">{tile.helper}</span>
        <DeltaBadge trend={tile.trend} variancePct={tile.variancePct} varianceLabel={tile.varianceLabel} />
      </div>
    </div>
  );

  if (tile.href) return <Link to={tile.href} className="block h-full">{inner}</Link>;
  return inner;
}

export function KpiRow({ tiles, cols = 6 }: KpiRowProps) {
  const colClass = cols === 4
    ? "grid-cols-2 md:grid-cols-4"
    : cols === 7
    ? "grid-cols-2 sm:grid-cols-4 xl:grid-cols-7"
    : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";

  return (
    <div className={`grid ${colClass} gap-4`}>
      {tiles.map((tile, i) => <TileCard key={i} tile={tile} />)}
    </div>
  );
}

export default KpiRow;
