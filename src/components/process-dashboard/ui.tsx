import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { SparkPoint } from "./types";

export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1";
export const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const SERIES_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#db2777", "#4d7c0f"];
export const btn = `inline-flex min-h-[36px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-xl bg-slate-100 motion-safe:animate-pulse ${className}`} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className={`${btn} border-red-300`}>Retry</button>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">{children}</p>;
}

/** Decorative SVG sparkline (the value itself is always printed beside it). */
export function Sparkline({ points, stroke = "#2563eb", width = 72, height = 22 }: { points?: SparkPoint[]; stroke?: string; width?: number; height?: number }) {
  const vals = (points ?? []).map((p) => p.value).filter((v): v is number => typeof v === "number");
  if (vals.length < 2) return <span aria-hidden="true" className="inline-block text-slate-400" style={{ width }}>{"—"}</span>;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (vals.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`}><path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function loadPref<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
export function savePref(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: preference just isn't persisted */ }
}
