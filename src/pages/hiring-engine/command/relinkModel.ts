/** Pure model of the campaign relink (K7BK): preview path, the preview read as sentences, the confirm body. No DOM, no regex literals. */
export interface RelinkPreview {
  campaignId: string; fromRequisitionId: string | null; fromCode: string | null; fromClosedReason: string | null;
  toRequisitionId: string; toCode: string; toBranch: string;
  move: { total: number; qualified: number; disqualified: number; pending: number }; stay: number; warnings: string[]; previewHash: string;
}

export const relinkPreviewPath = (campaignId: string, to: string): string => `/api/meta/campaigns/${encodeURIComponent(campaignId)}/relink-preview?to=${encodeURIComponent(to)}`;
export const relinkPath = (campaignId: string): string => `/api/meta/campaigns/${encodeURIComponent(campaignId)}/relink`;
/** Roles that may relink (the route's CAMPAIGN_WRITE_ROLES). */
export const RELINK_ROLES = ["super_admin", "admin", "hr", "recruitment_hr"] as const;

const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

export function previewLines(p: RelinkPreview): string[] {
  const from = p.fromCode || "the old requisition";
  const m = p.move;
  return [
    `${people(m.total)} not yet contacted move to ${p.toCode} (${m.qualified} qualified, ${m.disqualified} disqualified, ${m.pending} pending).`,
    `${people(p.stay)} already contacted stay on ${from}.`,
    `${p.toCode} becomes the campaign's main requisition; ${from} stays linked.`,
  ];
}

export function reasonError(reason: string): string | null {
  const t = reason.trim();
  return t.length < 3 || t.length > 300 ? "Give a reason (3 to 300 characters)" : null;
}

export function relinkBody(p: RelinkPreview, reason: string): { toRequisitionId: string; previewHash: string; reason: string; confirm: true } {
  return { toRequisitionId: p.toRequisitionId, previewHash: p.previewHash, reason: reason.trim(), confirm: true };
}

/** E9: a 409 from the relink carries the fresh preview (someone was contacted meanwhile); HR sees it and confirms again. */
export function freshPreviewFrom(e: unknown): RelinkPreview | null {
  const err = e as { status?: unknown; payload?: { preview?: unknown } } | null;
  const p = err?.status === 409 ? err.payload?.preview : null;
  return p && typeof p === "object" && typeof (p as RelinkPreview).previewHash === "string" ? (p as RelinkPreview) : null;
}
