/**
 * Pure view-model of a drive's "Confirmed to attend" list (GET /api/he/drives/:id/confirmed), which doubles as the arrival checklist:
 * rows by slot, how and when each person confirmed (icon + word), the other channels they also said yes on, a conflict flag when a later
 * answer went against the confirm, and the arrival state. The printable checklist is built from the same rows. No DOM.
 */
import { CHANNEL_LABEL, masked, whenText, type ResponseChannel } from "./responsesModel";

// backend/src/modules/hiring-engine/response-read.service.ts
export interface ConfirmedRow {
  matchId: string; leadId: string; name: string; mobileMasked: string; slotAt: string | null; confirmedVia: ResponseChannel | null; confirmedAt: string | null;
  otherChannels: ResponseChannel[]; conflict: boolean; state: string; arrivedAt: string | null;
}
export interface DriveConfirmed {
  drive: { id: string; requisitionId: string; date: string; branch: string; status: string; requisitionCode: string; role: string; slotStart: string | null; slotEnd: string | null };
  rows: ConfirmedRow[]; counts: { total: number; confirmed: number; arrived: number; noShow: number; conflicts: number };
}
export const confirmedPath = (driveId: string): string => `/api/he/drives/${encodeURIComponent(driveId)}/confirmed`;

export type ArrivalState = "arrived" | "expected" | "no_show" | "changed";
export const ARRIVAL_LABEL: Record<ArrivalState, string> = { arrived: "Arrived", expected: "Expected", no_show: "No-show", changed: "Changed answer" };
export function arrivalOf(state: string): ArrivalState {
  if (state === "arrived" || state === "selected") return "arrived";
  if (state === "no_show") return "no_show";
  if (state === "confirmed") return "expected";
  return "changed"; // declined / slot released after a confirm
}

export interface ConfirmedRowView {
  matchId: string; leadId: string; slotAt: string | null; slot: string; name: string; mobile: string; via: string; viaChannel: ResponseChannel | null; at: string; also: string;
  conflict: boolean; arrival: ArrivalState; arrivalText: string;
}
const hhmm = (s: string | null): string => (s && s.length >= 16 ? s.slice(11, 16) : "–");
const bySlot = (a: ConfirmedRow, b: ConfirmedRow): number => (a.slotAt ?? "~") < (b.slotAt ?? "~") ? -1 : (a.slotAt ?? "~") > (b.slotAt ?? "~") ? 1 : a.name.localeCompare(b.name);

export function confirmedRows(d: DriveConfirmed | null | undefined): ConfirmedRowView[] {
  return [...(d?.rows ?? [])].sort(bySlot).map((r) => {
    const arrival = arrivalOf(r.state);
    return {
      matchId: r.matchId, leadId: r.leadId, slotAt: r.slotAt, slot: hhmm(r.slotAt), name: r.name, mobile: masked(r.mobileMasked),
      via: r.confirmedVia ? CHANNEL_LABEL[r.confirmedVia] ?? r.confirmedVia : "Before tracking", viaChannel: r.confirmedVia, at: whenText(r.confirmedAt),
      also: r.otherChannels.map((c) => CHANNEL_LABEL[c] ?? c).join(", "), conflict: r.conflict, arrival,
      arrivalText: arrival === "arrived" && r.arrivedAt ? `Arrived ${hhmm(r.arrivedAt)}` : ARRIVAL_LABEL[arrival],
    };
  });
}
export function confirmedHeading(d: DriveConfirmed): string { return `Confirmed to attend (${d.counts.total})`; }
export function confirmedSummary(d: DriveConfirmed): string {
  const c = d.counts;
  return `${c.total} confirmed · ${c.arrived} arrived · ${c.noShow} no-show${c.conflicts ? ` · ${c.conflicts} changed their answer` : ""}`;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A standalone printable arrival checklist (escaped; masked mobiles only). */
export function checklistHtml(d: DriveConfirmed): string {
  const rows = confirmedRows(d);
  const title = `Arrival checklist: ${d.drive.requisitionCode} ${d.drive.role}, ${d.drive.branch}, ${whenText(d.drive.date)}`;
  const body = rows.map((r) => `<tr><td class="tick"></td><td>${esc(r.slot)}</td><td>${esc(r.name)}</td><td>${esc(r.mobile)}</td><td>${esc(r.via)}</td><td>${esc(r.conflict ? `${r.arrivalText} (check)` : r.arrivalText)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}`
    + `th,td{border:1px solid #444;padding:6px;text-align:left}.tick{width:28px}</style></head><body><h1 style="font-size:16px">${esc(title)}</h1>`
    + `<p>${esc(confirmedSummary(d))}</p><table><thead><tr><th>Here</th><th>Slot</th><th>Name</th><th>Mobile</th><th>Confirmed via</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}
