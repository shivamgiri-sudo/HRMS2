import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { VizProps, VizStyle } from "../types";

export type VizCategory = "Tiles" | "Comparison" | "Trend" | "Part to whole" | "Distribution" | "Diagrams" | "Tables" | "Content";
export const VIZ_CATEGORIES: VizCategory[] = ["Tiles", "Comparison", "Trend", "Part to whole", "Distribution", "Diagrams", "Tables", "Content"];

/** Which Style-tab controls a visualisation understands. The editor only shows these. */
export type StyleOption =
  | "palette" | "legend" | "dataLabels" | "grid" | "axisTitles" | "curve" | "dots" | "numberFormat" | "topN"
  | "thresholds" | "target" | "range" | "higherIsBetter" | "sparkline" | "text" | "pageSize" | "showTotals";

/**
 * One visualisation type. Adding a chart = one VizDef in a viz file + it is picked up by registry.ts.
 * `needs` is [min, max] of dimensions and measures the chart can draw; the editor enforces it.
 */
export interface VizDef {
  type: string; label: string; category: VizCategory; icon: LucideIcon; description: string;
  needs: { dims: [number, number]; measures: [number, number] };
  /** Content widgets (text, header) have no query. */
  noQuery?: boolean;
  /** Default grid size on the 12-column layout (row height 40px). */
  defaultSize: { w: number; h: number };
  defaults?: Partial<VizStyle>;
  styleOptions: StyleOption[];
  Component: ComponentType<VizProps>;
}
