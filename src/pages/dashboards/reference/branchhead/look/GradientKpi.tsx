import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, type LucideIcon } from "lucide-react";
import "./look.css";

export type KpiHue = "navy" | "emerald" | "violet" | "orange" | "cyan" | "rose" | "teal" | "indigo" | "amber" | "slate";

/**
 * Gradient stops per hue (darkest, lightest). White text on each stop is >= 4.5:1
 * (computed: lowest is amber #b45309 at 5.02:1, see the bh-ui report).
 */
export const KPI_HUES: Record<KpiHue, [string, string]> = {
  navy: ["#153f69", "#1e6fa8"], emerald: ["#065f46", "#047857"], violet: ["#5b21b6", "#7c3aed"], orange: ["#9a3412", "#c2410c"],
  cyan: ["#155e75", "#0e7490"], rose: ["#9f1239", "#be123c"], teal: ["#134e4a", "#0f766e"], indigo: ["#312e81", "#4338ca"],
  amber: ["#78350f", "#b45309"], slate: ["#1e293b", "#475569"],
};

export type KpiStatus = "warning" | "critical";
const STATUS: Record<KpiStatus, { word: string; Icon: LucideIcon }> = {
  warning: { word: "Warning", Icon: AlertTriangle },
  critical: { word: "Critical", Icon: AlertOctagon },
};

export interface GradientKpiProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hue?: KpiHue;
  icon?: LucideIcon;
  /** Shown as text + icon on the tile (never colour alone); critical also turns the tile rose. */
  status?: KpiStatus | null;
  onClick?: () => void;
}

/** Solid gradient tile (Process Operations look): tiny uppercase label, big value, one sub line, decorative circle. */
export function GradientKpi({ label, value, sub, hue = "navy", icon: Icon, status, onClick }: GradientKpiProps) {
  const tone = status === "critical" ? "rose" : hue;
  const s = status ? STATUS[status] : null;
  const body = (
    <>
      <span className="bhl-kpi-label">{Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}{label}</span>
      <span className="bhl-kpi-value">{value}</span>
      {sub ? <span className="bhl-kpi-sub">{sub}</span> : null}
      {s ? <span className="bhl-kpi-status"><s.Icon className="h-3 w-3" aria-hidden="true" />{s.word}</span> : null}
    </>
  );
  const cls = `bhl-kpi bhl-hue-${tone}`;
  if (!onClick) return <div className={cls} data-hue={tone}>{body}</div>;
  return <button type="button" className={cls} data-hue={tone} onClick={onClick}>{body}</button>;
}

/** Grid of tiles; `cols` widens the desktop grid to 5 or 6. */
export function KpiGrid({ label, cols, children }: { label: string; cols?: 4 | 5 | 6; children: ReactNode }) {
  return <ul aria-label={label} className="bhl-kpis" data-cols={cols}>{children}</ul>;
}

export const KpiCell = ({ children }: { children: ReactNode }) => <li>{children}</li>;
