/**
 * Shared look of the SBI Card Collections analytics: the validated categorical order (blue, orange, aqua, yellow ...), one
 * sequential hue (blue) for magnitude, a neutral gray for context, and reserved status colours that always ship with a label.
 * Series colours never carry text; labels stay in slate ink.
 */
export const PAL = {
  blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100", magenta: "#e87ba4", green: "#008300", violet: "#4a3aa7", red: "#e34948",
  gray: "#cbd5e1", grayDark: "#94a3b8", ink: "#0f172a", inkSoft: "#475569", grid: "#e2e8f0",
} as const;

/** Sequential blue, t in 0..1 (more = darker). Used for heat cells and bars. */
export const seq = (t: number): string => `rgba(42,120,214,${(0.07 + 0.55 * Math.max(0, Math.min(1, t))).toFixed(3)})`;

/** Compact rupee amounts: 1.2 Cr / 4.8 L / 12,300. */
export const inrC = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a < 1e6 * 1 ? 2 : 1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1";
export const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const STAGE_META: Record<"promised" | "inProgress" | "untouched" | "exhausted" | "lapsed", { label: string; color: string; hint: string }> = {
  promised: { label: "Promised", color: PAL.aqua, hint: "PTP on file, not yet due or paid" },
  inProgress: { label: "In progress", color: PAL.blue, hint: "Worked, 1-3 attempts, no promise yet" },
  untouched: { label: "Untouched", color: PAL.grayDark, hint: "Zero attempts" },
  exhausted: { label: "Exhausted", color: PAL.orange, hint: "4+ attempts, no promise" },
  lapsed: { label: "Lapsed promise", color: PAL.red, hint: "Promise date passed" },
};
