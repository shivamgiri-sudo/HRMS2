import type { Theme, VizStyle } from "./types";

/** Series palettes. "accessible" (Okabe-Ito) is the default: distinguishable with the common colour-vision deficiencies. */
export const PALETTES: Record<string, { label: string; colors: string[] }> = {
  accessible: { label: "Accessible", colors: ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#555555"] },
  corporate: { label: "Corporate blue", colors: ["#1E40AF", "#3B82F6", "#F59E0B", "#0EA5E9", "#6366F1", "#14B8A6", "#64748B", "#93C5FD"] },
  gold: { label: "MAS gold", colors: ["#1A1A1A", "#D4AF37", "#8C6D1F", "#5B5B5B", "#E6C766", "#2F6FED", "#0D9488", "#A3A3A3"] },
  vivid: { label: "Vivid", colors: ["#2563EB", "#DB2777", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#CA8A04", "#DC2626"] },
  emerald: { label: "Emerald", colors: ["#047857", "#10B981", "#0EA5E9", "#F59E0B", "#065F46", "#6EE7B7", "#0369A1", "#64748B"] },
  sunset: { label: "Sunset", colors: ["#B91C1C", "#EA580C", "#F59E0B", "#DB2777", "#7C2D12", "#FB7185", "#FDBA74", "#78716C"] },
  mono: { label: "Monochrome", colors: ["#0F172A", "#334155", "#64748B", "#94A3B8", "#1E293B", "#475569", "#CBD5E1", "#020617"] },
  pastel: { label: "Pastel", colors: ["#60A5FA", "#F9A8D4", "#86EFAC", "#FDBA74", "#C4B5FD", "#67E8F9", "#FDE68A", "#A8A29E"] },
};
export const DEFAULT_PALETTE = "accessible";

/** Colours for a widget: its own per-series overrides first, then its palette, cycled to `n`. */
export function seriesColors(style: VizStyle, n: number, fallbackPalette = DEFAULT_PALETTE): string[] {
  const base = (PALETTES[style.palette ?? ""] ?? PALETTES[fallbackPalette] ?? PALETTES[DEFAULT_PALETTE]).colors;
  return Array.from({ length: Math.max(n, 1) }, (_, i) => style.colors?.[i] || base[i % base.length]);
}

/** Colour for a value from the widget's thresholds (highest threshold the value reaches), or null. */
export function thresholdColor(style: VizStyle, value: number | null): string | null {
  if (value === null || !style.thresholds?.length) return null;
  let hit: string | null = null;
  for (const t of [...style.thresholds].sort((a, b) => a.value - b.value)) if (value >= t.value) hit = t.color;
  return hit;
}

export const THEMES: Theme[] = [
  { key: "light", label: "Light", canvas: "#F8FAFC", card: "#FFFFFF", border: "#E2E8F0", text: "#0F172A", muted: "#475569", grid: "#E2E8F0", accent: "#1E40AF", dark: false },
  { key: "corporate", label: "Corporate", canvas: "#EFF4FB", card: "#FFFFFF", border: "#C7D7EE", text: "#0B2545", muted: "#44587A", grid: "#DCE6F5", accent: "#134074", dark: false },
  { key: "gold", label: "MAS Gold", canvas: "#FAF7EF", card: "#FFFFFF", border: "#E8DDBF", text: "#1A1A1A", muted: "#5B5B5B", grid: "#EFE7D2", accent: "#8C6D1F", dark: false },
  { key: "emerald", label: "Emerald", canvas: "#F0FDF7", card: "#FFFFFF", border: "#BBE7D3", text: "#064E3B", muted: "#3F6B5C", grid: "#D5F2E5", accent: "#047857", dark: false },
  { key: "midnight", label: "Midnight", canvas: "#0B1220", card: "#131C2E", border: "#26334D", text: "#E8EEF9", muted: "#A3B1CC", grid: "#22304A", accent: "#60A5FA", dark: true },
  { key: "contrast", label: "High contrast", canvas: "#FFFFFF", card: "#FFFFFF", border: "#000000", text: "#000000", muted: "#1F2937", grid: "#6B7280", accent: "#0000CC", dark: false },
];
export const themeOf = (key: string | undefined): Theme => THEMES.find((t) => t.key === key) ?? THEMES[0];
/** Palette that reads well on a theme when the widget has not chosen one. */
export const themePalette = (t: Theme): string => (t.key === "gold" ? "gold" : t.key === "emerald" ? "emerald" : t.key === "corporate" ? "corporate" : t.dark ? "pastel" : DEFAULT_PALETTE);
