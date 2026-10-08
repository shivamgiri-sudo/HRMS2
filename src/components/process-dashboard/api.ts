import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import type { AgentDetail, AgentsResponse, DayDetail, LiveResponse, Overview, ProcessConfigSummary } from "./types";
import type { DashUrlState } from "./urlState";
import { csvFilename } from "./format";

export const PD_API = "/api/process-dashboard";
export const PAGE_SIZE = 25;

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const unwrap = async <T,>(req: Promise<HrmsEnvelope<T>>): Promise<T> => {
  const res = await req;
  return res.data as T;
};
const scope = (s: DashUrlState) => ({ from: s.from, to: s.to, tl: s.tl, lob: s.lob });

export const fetchConfigs = () => unwrap<ProcessConfigSummary[]>(hrmsApi.get(`${PD_API}/configs`));
export const fetchOverview = (id: string, s: DashUrlState) => unwrap<Overview>(hrmsApi.get(`${PD_API}/${encodeURIComponent(id)}/overview${qs(scope(s))}`));
export const fetchAgents = (id: string, s: DashUrlState) =>
  unwrap<AgentsResponse | AgentsResponse["rows"]>(hrmsApi.get(`${PD_API}/${encodeURIComponent(id)}/agents${qs({
    ...scope(s), q: s.q, sort: s.sort, dir: s.sort ? s.dir : undefined, limit: PAGE_SIZE, offset: (s.page - 1) * PAGE_SIZE })}`))
    .then((d): AgentsResponse => (Array.isArray(d) ? { rows: d, total: d.length } : d ?? {}));
export const fetchAgent = (id: string, code: string, s: DashUrlState) =>
  unwrap<AgentDetail>(hrmsApi.get(`${PD_API}/${encodeURIComponent(id)}/agents/${encodeURIComponent(code)}${qs({ from: s.from, to: s.to })}`));
export const fetchDay = (id: string, day: string, s: DashUrlState) =>
  unwrap<DayDetail>(hrmsApi.get(`${PD_API}/${encodeURIComponent(id)}/days/${encodeURIComponent(day)}${qs({ tl: s.tl, lob: s.lob })}`));
export const fetchLive = async (id: string, since?: string): Promise<LiveResponse> => {
  const res = await hrmsApi.get<HrmsEnvelope<LiveResponse> & LiveResponse>(`${PD_API}/${encodeURIComponent(id)}/live${qs({ since })}`);
  return (res.data ?? res) as LiveResponse;
};

/** Downloads export.csv through the authenticated blob helper (a plain <a href> would miss the bearer token). */
export async function downloadCsv(id: string, processCode: string, view: "agents" | "daily", s: DashUrlState): Promise<void> {
  const blob = await hrmsApi.getBlob(`${PD_API}/${encodeURIComponent(id)}/export.csv${qs({ view, from: s.from, to: s.to, tl: s.tl, lob: s.lob })}`);
  const url = URL.createObjectURL(blob as Blob);
  const a = document.createElement("a");
  a.href = url; a.download = csvFilename(processCode, view, s.from, s.to);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- support/inbound dialer source (process_inbound_config) ---------------- */
export interface InboundTabInfo { projectKey: string; name: string }
export interface InboundCandidateTable { table: string; rows: number | null; complete: boolean; missingColumns: string[]; usedBy: string[] }
export interface InboundStored {
  processId: string; projectKey: string; dialerTable: string; pattern: "A" | "B"; campaigns: string[]; mandate: number; required: number;
  hasFcr: boolean; fcrClientId: number | null; slSeconds: number | null; enabled: boolean; updatedAt?: string | null;
}
export interface InboundPreviewResult {
  table: string; campaignsAvailable: Array<{ campaign: string; calls: number; lastCall: string | null }>;
  detectedPattern: { pattern: "A" | "B"; reason: string };
  totals: { offered: number; answered: number; abandoned: number; from: string | null; to: string | null } | null;
  sample: Array<Record<string, unknown>>;
  problems: Array<{ severity: "error" | "warn"; code: string; message: string }>;
}
export interface InboundConfigInput { dialerTable: string; pattern: "A" | "B"; campaigns: string[]; mandate: number; required: number; hasFcr: boolean; fcrClientId: number | null; slSeconds: number | null; enabled: boolean }

/** null when the process has no enabled inbound config (or the caller may not open the inbound dashboard). Never throws: the tab is optional. */
export const fetchInboundTab = async (id: string): Promise<InboundTabInfo | null> => {
  try { return (await unwrap<InboundTabInfo | null>(hrmsApi.get(`${PD_API}/${encodeURIComponent(id)}/inbound`))) ?? null; } catch { return null; }
};
export const fetchInboundCandidates = () => unwrap<InboundCandidateTable[]>(hrmsApi.get(`${PD_API}/admin/inbound/tables`));
export const fetchInboundConfig = (id: string) => unwrap<InboundStored | null>(hrmsApi.get(`${PD_API}/admin/inbound/${encodeURIComponent(id)}`)).then((d) => d ?? null);
export const previewInboundConfig = (processId: string, config: InboundConfigInput) =>
  unwrap<InboundPreviewResult>(hrmsApi.post(`${PD_API}/admin/inbound/preview`, { processId, config }));
export const saveInboundConfig = (processId: string, config: InboundConfigInput) =>
  unwrap<InboundStored>(hrmsApi.put(`${PD_API}/admin/inbound/${encodeURIComponent(processId)}`, config));

/** Distinguishes a process that exists for this reader but has no dashboard config ("missing") from one that is unknown or out of scope ("forbidden"). */
export type ProbeResult = "exists" | "missing" | "forbidden" | "error";
export const probeProcess = async (id: string): Promise<ProbeResult> => {
  try { await hrmsApi.get(`${PD_API}/${encodeURIComponent(id)}/config`); return "exists"; } catch (e) {
    const status = (e as { status?: number })?.status;
    return status === 404 ? "missing" : status === 403 ? "forbidden" : "error";
  }
};
