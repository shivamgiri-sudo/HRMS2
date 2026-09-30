/** URL <-> dashboard state. Only non-default values are written so shared links stay short. */
export type Preset = "today" | "yesterday" | "7d" | "mtd" | "lastmonth";
export const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "7d", label: "Last 7 days" },
  { key: "mtd", label: "Month to date" }, { key: "lastmonth", label: "Last month" },
];
export interface DashUrlState {
  from: string; to: string; tl: string; lob: string; q: string;
  agent: string; day: string; metric: string; sort: string; dir: "asc" | "desc"; page: number;
}
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isValidDay = (s: string | null | undefined): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

export function presetRange(p: Preset, now: Date = new Date()): { from: string; to: string } {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  switch (p) {
    case "today": return { from: isoDay(now), to: isoDay(now) };
    case "yesterday": { const t = isoDay(new Date(y, m, d - 1)); return { from: t, to: t }; }
    case "7d": return { from: isoDay(new Date(y, m, d - 6)), to: isoDay(now) };
    case "lastmonth": return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
    case "mtd": default: return { from: isoDay(new Date(y, m, 1)), to: isoDay(now) };
  }
}
export function detectPreset(from: string, to: string, now: Date = new Date()): Preset | null {
  for (const p of PRESETS) { const r = presetRange(p.key, now); if (r.from === from && r.to === to) return p.key; }
  return null;
}

export function defaultState(now: Date = new Date()): DashUrlState {
  return { ...presetRange("mtd", now), tl: "", lob: "", q: "", agent: "", day: "", metric: "", sort: "", dir: "desc", page: 1 };
}

export function parseUrlState(sp: URLSearchParams, now: Date = new Date()): DashUrlState {
  const def = defaultState(now);
  let from = isValidDay(sp.get("from")) ? sp.get("from")! : def.from;
  let to = isValidDay(sp.get("to")) ? sp.get("to")! : def.to;
  if (from > to) [from, to] = [to, from];
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  return {
    from, to, tl: sp.get("tl")?.trim() ?? "", lob: sp.get("lob")?.trim() ?? "", q: sp.get("q")?.trim() ?? "",
    agent: sp.get("agent")?.trim() ?? "", day: isValidDay(sp.get("day")) ? sp.get("day")! : "",
    metric: sp.get("metric")?.trim() ?? "", sort: sp.get("sort")?.trim() ?? "",
    dir: sp.get("dir") === "asc" ? "asc" : "desc", page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Writes onto a copy of `base` so unrelated query params (e.g. ?process= on the Operations page) survive. */
export function serializeUrlState(s: DashUrlState, base: URLSearchParams = new URLSearchParams(), now: Date = new Date()): URLSearchParams {
  const out = new URLSearchParams(base);
  const def = defaultState(now);
  const set = (k: string, v: string, dflt = "") => { if (v && v !== dflt) out.set(k, v); else out.delete(k); };
  set("from", s.from, def.from); set("to", s.to, def.to);
  set("tl", s.tl); set("lob", s.lob); set("q", s.q); set("agent", s.agent); set("day", s.day);
  set("metric", s.metric); set("sort", s.sort);
  if (s.sort && s.dir === "asc") out.set("dir", "asc"); else out.delete("dir");
  if (s.page > 1) out.set("page", String(s.page)); else out.delete("page");
  return out;
}
