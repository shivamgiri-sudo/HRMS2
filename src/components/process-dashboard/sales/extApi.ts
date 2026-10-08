/** API client for the Sales / Outbound category templates (backend process-dashboard/sales|outbound, sql/1961). */
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { PD_API } from "../api";

export type Kind = "sales" | "outbound";
export interface Query { from?: string; to?: string; tl?: string; lob?: string; product?: string; q?: string; sort?: string; dir?: string; limit?: number; offset?: number; agent?: string }

export const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const unwrap = async <T,>(req: Promise<HrmsEnvelope<T>>): Promise<T> => (await req).data as T;
const base = (id: string, kind: Kind) => `${PD_API}/${encodeURIComponent(id)}/${kind}`;
/** Outbound calls its campaign filter "campaign"; it travels in the shared `lob` URL slot. */
const scope = (kind: Kind, s: Query) => ({ from: s.from, to: s.to, tl: s.tl, ...(kind === "sales" ? { lob: s.lob, product: s.product } : { campaign: s.lob }) });

export const fetchTab = async (id: string, kind: Kind): Promise<{ name: string; refreshSeconds: number } | null> => {
  try { return (await unwrap<{ name: string; refreshSeconds: number } | null>(hrmsApi.get(`${base(id, kind)}/tab`))) ?? null; } catch { return null; }
};
export const fetchOverview = <T,>(id: string, kind: Kind, s: Query) => unwrap<T>(hrmsApi.get(`${base(id, kind)}/overview${qs(scope(kind, s))}`));
export const fetchAgents = <T,>(id: string, kind: Kind, s: Query) =>
  unwrap<T>(hrmsApi.get(`${base(id, kind)}/agents${qs({ ...scope(kind, s), q: s.q, sort: s.sort, dir: s.sort ? s.dir : undefined, limit: s.limit, offset: s.offset })}`));
export const fetchAgent = <T,>(id: string, kind: Kind, code: string, s: Query) => unwrap<T>(hrmsApi.get(`${base(id, kind)}/agent/${encodeURIComponent(code)}${qs({ from: s.from, to: s.to })}`));
export const fetchDay = <T,>(id: string, date: string, s: Query) => unwrap<T>(hrmsApi.get(`${base(id, "sales")}/days/${encodeURIComponent(date)}${qs({ tl: s.tl, lob: s.lob, product: s.product })}`));
export const fetchDispositions = <T,>(id: string, s: Query) => unwrap<T>(hrmsApi.get(`${base(id, "outbound")}/dispositions${qs({ from: s.from, to: s.to, tl: s.tl, campaign: s.lob, agent: s.agent })}`));
export const fetchLive = (id: string, kind: Kind) => unwrap<{ etag: string; latestDate: string | null }>(hrmsApi.get(`${base(id, kind)}/live`));

/* ---- admin ---- */
export interface ColumnInfo { name: string; dataType: string; columnType?: string }
export interface TableInfo { table: string; rows: number | null }
export interface Problem { severity: "error" | "warn"; code: string; message: string }
const adm = (kind: Kind) => `${PD_API}/admin/${kind}`;
export const fetchTables = (kind: Kind, schema: string) => unwrap<TableInfo[]>(hrmsApi.get(`${adm(kind)}/tables${qs({ schema })}`));
export const fetchColumns = (kind: Kind, schema: string, table: string) => unwrap<ColumnInfo[]>(hrmsApi.get(`${adm(kind)}/columns${qs({ schema, table })}`));
export const suggest = (kind: Kind, schema: string, table: string, roster = false) =>
  unwrap<{ columns: ColumnInfo[]; columnMap: Record<string, string>; unmatched: string[] }>(hrmsApi.post(`${adm(kind)}/suggest`, { schema, table, roster }));
export const previewConfig = <T,>(kind: Kind, processId: string, config: unknown) => unwrap<T>(hrmsApi.post(`${adm(kind)}/preview`, { processId, config }));
export const fetchStored = <T,>(kind: Kind, id: string) => unwrap<T | null>(hrmsApi.get(`${adm(kind)}/${encodeURIComponent(id)}`)).then((d) => d ?? null);
export const saveStored = <T,>(kind: Kind, id: string, config: unknown) => unwrap<T>(hrmsApi.put(`${adm(kind)}/${encodeURIComponent(id)}`, config));
