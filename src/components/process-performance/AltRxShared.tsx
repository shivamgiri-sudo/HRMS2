import { useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { getAuthToken } from "@/lib/hrmsApi";
import { apiUrl } from "@/lib/apiBase";

/** Shared pieces for the ALT RX dashboard, uploader and MIS panel: the analysis shape, the calls, and the drop zone. */

export interface Counts { inflow: number; closure: number; within: number; out: number }
export interface Row { key: string; daily: Counts[]; weeks: Counts[]; mtd: Counts }
export interface Analysis {
  file: {
    name: string; sheet: string; rows: number; columns: number;
    missingExpected: string[]; unexpected: string[]; expectedColumns: string[];
  };
  headline: Counts & { closurePct: number | null; frtPct: number | null; agents: number; brands: number; tickets: number };
  days: string[];
  daily: Counts[];
  agents: { rows: Row[] };
  types: { rows: Row[] };
  brands: { rows: Row[] };
  skipped: { missingDate: number; duplicateTicketIds: number };
}

/**
 * The Dump loaded in this page session. The uploader, dashboard and MIS all read it, so a file
 * dropped in one shows in the others. It lives in the browser only and is lost on reload, until
 * saved uploads (sql/1784) exist.
 */
export interface AltRxSession { analysis: Analysis; fileName: string; file: File }
let session: AltRxSession | null = null;
const listeners = new Set<() => void>();
export function setAltRxSession(next: AltRxSession | null) {
  session = next;
  listeners.forEach((l) => l());
}
export function useAltRxSession(): AltRxSession | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => session,
  );
}

export const WEEK_LABELS =["Week-1", "Week-2", "Week-3", "Week-4", "Week-5"] as const;

export const sumCounts = (list: Counts[]): Counts =>
  list.reduce((s, c) => ({ inflow: s.inflow + c.inflow, closure: s.closure + c.closure, within: s.within + c.within, out: s.out + c.out }), { inflow: 0, closure: 0, within: 0, out: 0 });

export const ratio = (a: number, b: number): number | null => (b ? a / b : null);
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
export const num = (v: number) => v.toLocaleString("en-IN");
export const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const weekIndexOf = (iso: string) => Math.min(4, Math.ceil(Number(iso.slice(8, 10)) / 7) - 1);

/** Week totals for a day list (Week-1..5 by day of month). */
export function weekTotals(days: string[], daily: Counts[]): Counts[] {
  return WEEK_LABELS.map((_, w) => sumCounts(days.flatMap((d, i) => (weekIndexOf(d) === w ? [daily[i]] : []))));
}

export async function postFile(path: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  return fetch(apiUrl(path), { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` }, body: form });
}

export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return String(body.error) + (body.detail ? ` ${body.detail}` : "");
  } catch { /* not JSON */ }
  return fallback;
}

export async function analyzeFile(file: File): Promise<Analysis> {
  const res = await postFile("/api/process-performance/alt-rx/analyze", file);
  if (!res.ok) throw new Error(await errorMessage(res, "The Dump could not be analysed."));
  return (await res.json()).data as Analysis;
}

export async function downloadMis(file: File): Promise<void> {
  const res = await postFile("/api/process-performance/alt-rx/mis-export", file);
  if (!res.ok) throw new Error(await errorMessage(res, "The MIS could not be created."));
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "ALT_RX_MIS.xlsx";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Drag-and-drop or browse for the Dump. Calls onFile with the chosen file. */
export function DumpDropZone({ onFile, busy, compact = false }: { onFile: (f: File) => void; busy: boolean; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (f: File | null | undefined) => { if (f) onFile(f); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-center transition-colors ${compact ? "p-4" : "p-6"} ${dragging ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
    >
      <Upload className="h-5 w-5 text-slate-400" />
      <p className="text-sm font-semibold text-slate-700">{busy ? "Reading the Dump…" : "Drop the ALT RX Dump here"}</p>
      <p className="text-xs text-slate-500">.xlsx, .xls or .csv, up to 15 MB. Read on the server and not stored.</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
      >
        Browse file
      </button>
      <input
        ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }}
      />
    </div>
  );
}

/** From / To created-day range. Limits come from the saved Dump's first and last day. */
export function DateRangeInputs({
  from, to, min, max, onFrom, onTo, onReset,
}: {
  from: string; to: string; min?: string; max?: string;
  onFrom: (v: string) => void; onTo: (v: string) => void; onReset: () => void;
}) {
  const box = "flex flex-col rounded-lg bg-white px-3 py-1.5 text-[11px] text-slate-500";
  const input = "mt-0.5 bg-transparent text-sm font-semibold text-slate-800 outline-none";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className={box}>
        From
        <input type="date" value={from} min={min} max={to || max} onChange={(e) => onFrom(e.target.value)} className={input} />
      </label>
      <label className={box}>
        To
        <input type="date" value={to} min={from || min} max={max} onChange={(e) => onTo(e.target.value)} className={input} />
      </label>
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      >
        Reset range
      </button>
    </div>
  );
}
