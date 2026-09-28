/**
 * Shared pastel icon-circle color palette for Process Performance V2 — used
 * by the company grid (ProcessPerformanceV2Page), the per-company uploader
 * hub (UploaderHub), and the uploader workspace tab bar (UploaderWorkspace),
 * so a company's assigned color stays the same across every screen it
 * appears on rather than being redeclared per component.
 */
export const TONE_CLASSES = {
  slate: "bg-slate-900 text-white",
  rose: "bg-rose-100 text-rose-600",
  emerald: "bg-emerald-100 text-emerald-600",
  violet: "bg-violet-100 text-violet-600",
  sky: "bg-sky-100 text-sky-600",
  orange: "bg-orange-100 text-orange-600",
  amber: "bg-amber-100 text-amber-600",
  red: "bg-red-100 text-red-600",
  indigo: "bg-indigo-100 text-indigo-600",
  yellow: "bg-yellow-100 text-yellow-600",
  blue: "bg-blue-100 text-blue-600",
  pink: "bg-pink-100 text-pink-600",
  green: "bg-green-100 text-green-600",
  cyan: "bg-cyan-100 text-cyan-600",
  purple: "bg-purple-100 text-purple-600",
  fuchsia: "bg-fuchsia-100 text-fuchsia-600",
} as const;

export type Tone = keyof typeof TONE_CLASSES;

/** Solid-background variant (button/badge fills) for the same tone, used by
 * the uploader hub's "Upload" pill and its gradient header banner. */
export const TONE_SOLID_CLASSES: Record<Tone, string> = {
  slate: "bg-slate-900 text-white",
  rose: "bg-rose-500 text-white",
  emerald: "bg-emerald-500 text-white",
  violet: "bg-violet-500 text-white",
  sky: "bg-sky-500 text-white",
  orange: "bg-orange-500 text-white",
  amber: "bg-amber-500 text-white",
  red: "bg-red-500 text-white",
  indigo: "bg-indigo-500 text-white",
  yellow: "bg-yellow-500 text-white",
  blue: "bg-blue-500 text-white",
  pink: "bg-pink-500 text-white",
  green: "bg-green-500 text-white",
  cyan: "bg-cyan-500 text-white",
  purple: "bg-purple-500 text-white",
  fuchsia: "bg-fuchsia-500 text-white",
};

/** Gradient background for the hero/hub header banner, matching the tone. */
export const TONE_GRADIENT_CLASSES: Record<Tone, string> = {
  slate: "from-slate-100 to-slate-50",
  rose: "from-rose-100 to-rose-50",
  emerald: "from-emerald-100 to-emerald-50",
  violet: "from-violet-100 to-violet-50",
  sky: "from-sky-100 to-sky-50",
  orange: "from-orange-100 to-orange-50",
  amber: "from-amber-100 to-amber-50",
  red: "from-red-100 to-red-50",
  indigo: "from-indigo-100 to-indigo-50",
  yellow: "from-yellow-100 to-yellow-50",
  blue: "from-blue-100 to-blue-50",
  pink: "from-pink-100 to-pink-50",
  green: "from-green-100 to-green-50",
  cyan: "from-cyan-100 to-cyan-50",
  purple: "from-purple-100 to-purple-50",
  fuchsia: "from-fuchsia-100 to-fuchsia-50",
};
