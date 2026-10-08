/** Deep-link state of the "Why?" drawer: ?why=<metric>&wby=&wfrom=&wto=&wcmp=&wcf=&wct=. Only the drawer's own params are touched. */
import { isValidDay } from "../urlState";
import { WHY_DIMENSIONS, type WhyDimension } from "./types";

export type Cmp = "prev" | "week" | "custom";
export interface WhyState { metric: string; by: WhyDimension; from: string; to: string; cmp: Cmp; cf: string; ct: string }

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const dayCount = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86400000) + 1;
export const addDays = (d: string, n: number): string => new Date(utc(d) + n * 86400000).toISOString().slice(0, 10);
export const WHY_PARAMS = ["why", "wby", "wfrom", "wto", "wcmp", "wcf", "wct"] as const;

/** A single day is best compared with the same weekday last week; a longer range with the period of equal length right before it. */
export const defaultCmp = (from: string, to: string): Cmp => (from === to ? "week" : "prev");

export function compareRange(s: Pick<WhyState, "from" | "to" | "cmp" | "cf" | "ct">): { from: string; to: string } {
  if (s.cmp === "custom" && isValidDay(s.cf) && isValidDay(s.ct)) return s.cf <= s.ct ? { from: s.cf, to: s.ct } : { from: s.ct, to: s.cf };
  if (s.cmp === "week") return { from: addDays(s.from, -7), to: addDays(s.to, -7) };
  const n = dayCount(s.from, s.to);
  return { from: addDays(s.from, -n), to: addDays(s.from, -1) };
}
/** "Same weekday last week" only makes sense when it does not overlap the current range. */
export const weekCompareValid = (from: string, to: string) => dayCount(from, to) <= 7;

export function parseWhy(sp: URLSearchParams, dash: { from: string; to: string }): WhyState | null {
  const metric = sp.get("why")?.trim();
  if (!metric) return null;
  let from = isValidDay(sp.get("wfrom")) ? sp.get("wfrom")! : dash.from;
  let to = isValidDay(sp.get("wto")) ? sp.get("wto")! : dash.to;
  if (from > to) [from, to] = [to, from];
  const by = WHY_DIMENSIONS.find((d) => d.key === sp.get("wby"))?.key ?? "tl";
  const c = sp.get("wcmp");
  const cmp: Cmp = c === "prev" || c === "week" || c === "custom" ? c : defaultCmp(from, to);
  return { metric, by, from, to, cmp, cf: isValidDay(sp.get("wcf")) ? sp.get("wcf")! : "", ct: isValidDay(sp.get("wct")) ? sp.get("wct")! : "" };
}

export function writeWhy(s: WhyState | null, base: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const k of WHY_PARAMS) out.delete(k);
  if (!s) return out;
  out.set("why", s.metric); out.set("wfrom", s.from); out.set("wto", s.to);
  if (s.by !== "tl") out.set("wby", s.by);
  if (s.cmp !== defaultCmp(s.from, s.to)) out.set("wcmp", s.cmp);
  if (s.cmp === "custom") { if (s.cf) out.set("wcf", s.cf); if (s.ct) out.set("wct", s.ct); }
  return out;
}

export function openWhyState(metric: string, from: string, to: string): WhyState {
  return { metric, by: "tl", from, to, cmp: defaultCmp(from, to), cf: "", ct: "" };
}
