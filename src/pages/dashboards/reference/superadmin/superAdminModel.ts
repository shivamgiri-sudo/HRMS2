import type { RoleInsights } from "../../kit";

export type Light = "ok" | "warn" | "down" | "unknown";

export interface SystemTile {
  id: string;
  name: string;
  group: string;
  status: Light;
  headline: string;
  detail: string;
  href: string;
}

type Row = RoleInsights["tables"][number]["rows"][number];

export function tableRows(insights: RoleInsights | undefined, key: string): Row[] {
  return insights?.tables.find((t) => t.key === key)?.rows ?? [];
}

export function toSystems(insights: RoleInsights | undefined): SystemTile[] {
  return tableRows(insights, "systems").map((r) => ({
    id: String(r.id), name: String(r.name), group: String(r.group),
    status: (["ok", "warn", "down"].includes(String(r.status)) ? r.status : "unknown") as Light,
    headline: String(r.headline ?? ""), detail: String(r.detail ?? ""), href: String(r.href ?? "/integration-hub"),
  }));
}

export const LIGHT = {
  ok: { dot: "bg-emerald-500", ring: "ring-emerald-200", text: "text-emerald-700", label: "Operational" },
  warn: { dot: "bg-amber-500", ring: "ring-amber-300", text: "text-amber-700", label: "Degraded" },
  down: { dot: "bg-rose-500 kit-alert-dot", ring: "ring-rose-300", text: "text-rose-700", label: "Failing" },
  unknown: { dot: "bg-slate-400", ring: "ring-slate-200", text: "text-slate-600", label: "Unknown" },
} as const;

export function countLights(systems: SystemTile[]) {
  return {
    ok: systems.filter((s) => s.status === "ok").length,
    warn: systems.filter((s) => s.status === "warn").length,
    down: systems.filter((s) => s.status === "down").length,
    unknown: systems.filter((s) => s.status === "unknown").length,
  };
}

/** Org-wide payroll data gaps, read from the summary bundle so they sit beside the provider's checks. */
export interface PayrollGap { label: string; count: number | null; href: string; hint: string }

export const STATE_TONE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  down: "bg-rose-50 text-rose-700 ring-rose-200",
  idle: "bg-slate-100 text-slate-600 ring-slate-200",
  off: "bg-slate-100 text-slate-500 ring-slate-200",
  silent: "bg-slate-100 text-slate-600 ring-slate-200",
};
