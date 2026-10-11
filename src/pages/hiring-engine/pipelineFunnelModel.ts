/** Pure view-model of the pipeline funnel card (mirrors backend qualified-followup.pipeline-view.ts). No DOM. */
export interface PipelineSource {
  sourceType: "meta_live" | "meta_old" | "he"; label: string;
  enrolled: number; emailed: number; whatsapped: number; called: number; engaged: number; confirmed: number; arrived: number; stopped: number;
  waiting: { email: number; whatsapp: number; call: number }; lastEmailAt: string | null; lastWhatsappAt: string | null;
}
export interface PipelineView {
  generatedAt: string; windowOpen: boolean; nextWindowOpen: string;
  last24h: { emails: number; whatsapps: number; callResults: number; replies: number; confirmations: number };
  sources: PipelineSource[];
}
export interface Stage { key: string; label: string; value: number; pct: number }

/** Stages in the order a person moves through them; the percentage is of everyone enrolled in that drive. */
export function pipelineStages(s: PipelineSource): Stage[] {
  const base = Math.max(1, s.enrolled);
  const rows: Array<[string, string, number]> = [
    ["enrolled", "Qualified and enrolled", s.enrolled], ["emailed", "Emailed", s.emailed], ["whatsapped", "WhatsApped", s.whatsapped], ["called", "Called (result back)", s.called],
    ["engaged", "Replied / engaged", s.engaged], ["confirmed", "Slot confirmed", s.confirmed], ["arrived", "Arrived", s.arrived],
  ];
  return rows.map(([key, label, value]) => ({ key, label, value, pct: Math.min(100, Math.round((value / base) * 100)) }));
}

/** IST wall clock of an ISO instant, e.g. "Mon 12 Oct, 09:00 IST". */
export function whenIst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  return `${day}, ${d.toISOString().slice(11, 16)} IST`;
}

/** One sentence that explains the zeros: sending is open, or when it opens and how much is queued. */
export function windowBanner(v: PipelineView): string {
  const queued = v.sources.reduce((a, s) => a + s.waiting.email + s.waiting.whatsapp, 0);
  if (v.windowOpen) return `Sending is open (Mon to Sat, 09:00 to 20:00 IST). ${queued.toLocaleString("en-IN")} messages are queued and go out in turn.`;
  return `Sending is closed (Mon to Sat, 09:00 to 20:00 IST). It resumes ${whenIst(v.nextWindowOpen)}. ${queued.toLocaleString("en-IN")} messages are queued and start going out then.`;
}
