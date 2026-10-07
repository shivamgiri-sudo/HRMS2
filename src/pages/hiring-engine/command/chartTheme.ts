/**
 * Chart theme of the Drive Command Center. Palette: analytics-kit blue / orange / aqua (light) with the dark steps validated by the
 * dataviz validator (see the Task 9 report). Aqua is below 3:1 on the light surface, so every chart also carries a direct label, a
 * marker shape and a texture per drive type, plus a text table: type is never conveyed by colour alone.
 * Pure except the two hooks, which touch the DOM only inside effects (false during server render).
 */
import { useSyncExternalStore } from "react";
import type { SourceType } from "./driveCommandTypes";

const LIGHT: Record<SourceType, string> = { meta_live: "#2a78d6", meta_old: "#eb6834", he: "#1baf7a" };
const DARK: Record<SourceType, string> = { meta_live: "#3987e5", meta_old: "#d95926", he: "#199e70" };

export function seriesColor(t: SourceType, dark: boolean): string { return (dark ? DARK : LIGHT)[t] ?? (dark ? "#94a3b8" : "#64748b"); }

/** Texture per type (angle 0 = horizontal lines, 45 / 135 = diagonals); the pattern id is referenced from an SVG <pattern>. */
export const TYPE_PATTERN: Record<SourceType, { id: string; angle: 0 | 45 | 135 }> = {
  meta_live: { id: "tex-meta-live", angle: 45 },
  meta_old: { id: "tex-meta-old", angle: 135 },
  he: { id: "tex-he", angle: 0 },
};
export const TYPE_SHAPE: Record<SourceType, "circle" | "triangle" | "square"> = { meta_live: "circle", meta_old: "triangle", he: "square" };

/** Sequential blue ramp, light to dark; step 0 is "none". Cells always print their number, so the light end may recede. */
export const SEQ_RAMP: readonly string[] = ["#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
export function sequentialStep(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) return 0;
  return Math.min(SEQ_RAMP.length - 1, Math.max(1, Math.ceil((value / max) * (SEQ_RAMP.length - 1))));
}

const NEUTRAL = { light: "#f0efec", dark: "#383835" };
const BLUE_ARM = { light: ["#9ec5f4", "#5598e7", "#256abf"], dark: ["#184f95", "#256abf", "#3987e5"] };
const RED_ARM = { light: ["#f4b8b8", "#e87474", "#d03b3b"], dark: ["#7a2a2a", "#a93232", "#d03b3b"] };
/** Blue = above the comparison, red = below, grey = within 5 points; three steps per arm. The cell text carries the sign too. */
export function divergingColor(delta: number, dark: boolean): string {
  const mode = dark ? "dark" : "light";
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return NEUTRAL[mode];
  const arm = delta > 0 ? BLUE_ARM[mode] : RED_ARM[mode];
  const m = Math.abs(delta);
  return arm[m < 0.15 ? 0 : m < 0.3 ? 1 : 2];
}

export const STATUS_COLOR = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", neutral: "#64748b" } as const;
export const TEXT_SIZE = { tick: 11, label: 12, legend: 12, tooltip: 12, title: 14 } as const;
export const TARGET_COLOR = { light: "#475569", dark: "#cbd5e1" } as const;

/** Animation settings from the reduced-motion preference, passed in (pure modules never read the window). */
export interface ChartMotion { animate: boolean; durationMs: number }
export function chartMotion(prefersReducedMotion: boolean): ChartMotion {
  return prefersReducedMotion ? { animate: false, durationMs: 0 } : { animate: true, durationMs: 300 };
}

function subscribeMedia(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMedia,
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false),
    () => false,
  );
}

function subscribeDark(cb: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeDark, () => (typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false), () => false);
}
