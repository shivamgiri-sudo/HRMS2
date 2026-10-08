/**
 * Pure view-model of one person's timeline (GET /api/he/responses/timeline): items newest first, grouped by day, each with a kind word
 * (Sent / Reply / Answer / Status / Call) so the meaning never depends on the icon or colour. No DOM.
 */
import { whenText } from "./responsesModel";

// backend/src/modules/hiring-engine/response-timeline.service.ts
export type TimelineKind = "out" | "in" | "response" | "event" | "call";
export interface TimelineItem { at: string; kind: TimelineKind; channel: string | null; label: string; detail: string }
export interface Timeline { person: { name: string; mobileMasked: string }; items: TimelineItem[]; truncated: boolean }
export type TimelineKey = { responseId: number } | { matchId: string } | { leadId: string };

export const KIND_WORD: Record<TimelineKind, string> = { out: "Sent", in: "Reply", response: "Answer", event: "Status", call: "Call" };
const CHANNEL_WORD: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", voice_bot: "Voice bot", call_file: "Calling file", hr: "HR", web: "Email button", sms: "SMS" };

export function timelinePath(k: TimelineKey): string {
  if ("responseId" in k) return `/api/he/responses/timeline?responseId=${encodeURIComponent(String(k.responseId))}`;
  if ("matchId" in k) return `/api/he/responses/timeline?matchId=${encodeURIComponent(k.matchId)}`;
  return `/api/he/responses/timeline?leadId=${encodeURIComponent(k.leadId)}`;
}
export const keyOf = (k: TimelineKey | null): string => (!k ? "" : "responseId" in k ? `r${k.responseId}` : "matchId" in k ? `m${k.matchId}` : `l${k.leadId}`);

export interface TimelineDay { day: string; dayText: string; items: Array<TimelineItem & { time: string; kindWord: string; channelWord: string }> }
export function timelineDays(t: Timeline | null | undefined): TimelineDay[] {
  const sorted = [...(t?.items ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const out: TimelineDay[] = [];
  for (const i of sorted) {
    const day = i.at.slice(0, 10);
    let g = out[out.length - 1];
    if (!g || g.day !== day) { g = { day, dayText: whenText(day), items: [] }; out.push(g); }
    g.items.push({ ...i, time: i.at.length >= 16 ? i.at.slice(11, 16) : "", kindWord: KIND_WORD[i.kind] ?? "Note", channelWord: i.channel ? CHANNEL_WORD[i.channel] ?? i.channel : "" });
  }
  return out;
}
