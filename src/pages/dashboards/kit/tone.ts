import type { InsightTone } from "../../../../backend/src/modules/dashboards/role-insights/types";

export type Tone = InsightTone;

/** One source of truth for tone colours so every kit component reads as one system. */
export const TONE: Record<Tone, { solid: string; text: string; soft: string; ring: string; chip: string; hex: string; hexSoft: string }> = {
  blue:   { solid: "bg-blue-600",    text: "text-blue-700",    soft: "bg-blue-50",    ring: "ring-blue-200",    chip: "bg-blue-100 text-blue-800",       hex: "#2563eb", hexSoft: "#dbeafe" },
  green:  { solid: "bg-emerald-600", text: "text-emerald-700", soft: "bg-emerald-50", ring: "ring-emerald-200", chip: "bg-emerald-100 text-emerald-800", hex: "#059669", hexSoft: "#d1fae5" },
  amber:  { solid: "bg-amber-500",   text: "text-amber-700",   soft: "bg-amber-50",   ring: "ring-amber-200",   chip: "bg-amber-100 text-amber-800",     hex: "#d97706", hexSoft: "#fef3c7" },
  red:    { solid: "bg-rose-600",    text: "text-rose-700",    soft: "bg-rose-50",    ring: "ring-rose-200",    chip: "bg-rose-100 text-rose-800",       hex: "#e11d48", hexSoft: "#ffe4e6" },
  violet: { solid: "bg-violet-600",  text: "text-violet-700",  soft: "bg-violet-50",  ring: "ring-violet-200",  chip: "bg-violet-100 text-violet-800",   hex: "#7c3aed", hexSoft: "#ede9fe" },
  slate:  { solid: "bg-slate-500",   text: "text-slate-700",   soft: "bg-slate-50",   ring: "ring-slate-200",   chip: "bg-slate-100 text-slate-700",     hex: "#64748b", hexSoft: "#f1f5f9" },
};

export const SERIES_COLORS = ["#2563eb", "#059669", "#d97706", "#e11d48", "#7c3aed", "#0891b2", "#64748b"];

export type Accent = "indigo" | "emerald" | "rose" | "amber" | "cyan" | "violet" | "slate";

/** Hero gradients — one per role family so each dashboard is recognisable at a glance. */
export const HERO_GRADIENT: Record<Accent, string> = {
  indigo:  "from-[#0b1f44] via-[#1e2f7a] to-[#4338ca]",
  emerald: "from-[#052e2b] via-[#065f46] to-[#0d9488]",
  rose:    "from-[#3b0a1f] via-[#9f1239] to-[#e11d48]",
  amber:   "from-[#3a1d05] via-[#b45309] to-[#f59e0b]",
  cyan:    "from-[#082f49] via-[#0e7490] to-[#06b6d4]",
  violet:  "from-[#2e1065] via-[#5b21b6] to-[#8b5cf6]",
  slate:   "from-[#0f172a] via-[#1e293b] to-[#475569]",
};
