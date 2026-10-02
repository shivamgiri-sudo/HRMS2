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
  indigo:  "from-white via-indigo-50/70 to-indigo-100/70",
  emerald: "from-white via-emerald-50/70 to-emerald-100/70",
  rose:    "from-white via-rose-50/70 to-rose-100/70",
  amber:   "from-white via-amber-50/70 to-amber-100/70",
  cyan:    "from-white via-cyan-50/70 to-cyan-100/70",
  violet:  "from-white via-violet-50/70 to-violet-100/70",
  slate:   "from-white via-slate-50 to-slate-100",
};

/** Solid accent used for the hero's left edge and icon chip. */
export const HERO_ACCENT: Record<Accent, { bar: string; chip: string; eyebrow: string }> = {
  indigo:  { bar: "bg-indigo-500",  chip: "bg-indigo-100 text-indigo-700",   eyebrow: "text-indigo-700" },
  emerald: { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700", eyebrow: "text-emerald-700" },
  rose:    { bar: "bg-rose-500",    chip: "bg-rose-100 text-rose-700",       eyebrow: "text-rose-700" },
  amber:   { bar: "bg-amber-500",   chip: "bg-amber-100 text-amber-700",     eyebrow: "text-amber-700" },
  cyan:    { bar: "bg-cyan-500",    chip: "bg-cyan-100 text-cyan-700",       eyebrow: "text-cyan-700" },
  violet:  { bar: "bg-violet-500",  chip: "bg-violet-100 text-violet-700",   eyebrow: "text-violet-700" },
  slate:   { bar: "bg-slate-500",   chip: "bg-slate-200 text-slate-700",     eyebrow: "text-slate-600" },
};
