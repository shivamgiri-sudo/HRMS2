/** Follow-up switches card (Master tab): pure view-model. The server enforces roles and the inbound rule; this only words the screen. */

export type SourceMode = "off" | "dry_run" | "test" | "canary" | "live";
export type SourceType = "meta_live" | "meta_old" | "he";

export interface SwitchesView {
  ceiling: SourceMode;
  killSwitch: boolean;
  envPaused?: boolean;
  inboundGate?: boolean;
  sources: Record<SourceType, { mode: SourceMode; effective: SourceMode }>;
  canary: Array<{ sourceType: SourceType; requisitionId: string; code: string | null; branch: string | null }>;
  caps: Array<{ prefix: string; dailyMax: number; usedToday: number }>;
  budget: { max: number; quality: string | null; used: number };
  inbound: { lastInboundAt: string | null; inbound7d: number; verified: boolean; acknowledged: boolean };
  counts: Record<string, Record<string, number>>;
}

export interface OpenRequisition { id: string; requisition_code: string | null; designation_name?: string | null; branch_name: string | null }

export const SOURCES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
export const MODES: readonly SourceMode[] = ["off", "dry_run", "test", "canary", "live"];
const RANK: Record<SourceMode, number> = { off: 0, dry_run: 1, test: 2, canary: 3, live: 4 };

export const SOURCE_LABEL: Record<SourceType, string> = { meta_live: "Live Meta leads", meta_old: "Old Meta data", he: "Hiring Engine pool" };
export const MODE_LABEL: Record<SourceMode, string> = { off: "Off", dry_run: "Dry run", test: "Test", canary: "Canary", live: "Live" };

const ADMIN = ["super_admin", "admin"];
export const canEditSwitches = (roles: readonly string[] | null | undefined): boolean => (roles ?? []).some((r) => ADMIN.includes(r));

/** What actually runs, and why it differs from the screen value. */
export function effectiveText(mode: SourceMode, effective: SourceMode, ceiling: SourceMode): string {
  if (mode === effective) return MODE_LABEL[effective];
  if (RANK[mode] > RANK[ceiling] && effective === ceiling) return `${MODE_LABEL[effective]} (limited by server setting)`;
  if ((mode === "canary" || mode === "live") && effective === "dry_run") return "Dry run (Pinbot inbound not verified)";
  return MODE_LABEL[effective];
}

export function needsConfirm(mode: SourceMode): boolean {
  return mode === "canary" || mode === "live";
}

/** Text of the confirmation step; `needsAck` when the owner must also accept the unverified-inbound risk. */
export function confirmFor(source: SourceType, mode: SourceMode, inbound: SwitchesView["inbound"]): { text: string; needsAck: boolean } {
  const who = mode === "live" ? "every new person from this source" : "people of the canary requisitions";
  const needsAck = !inbound.verified && !inbound.acknowledged;
  return {
    text: `${SOURCE_LABEL[source]} to ${MODE_LABEL[mode]}: real email, WhatsApp and calls go to ${who}. The engine and the old Meta outreach step aside for them.`,
    needsAck,
  };
}

export function putBody(mode: SourceMode, acknowledge: boolean): { mode: SourceMode; acknowledgeInboundUnverified?: true } {
  return needsConfirm(mode) && acknowledge ? { mode, acknowledgeInboundUnverified: true } : { mode };
}

/** Canary picker: open requisitions not already on this source's list. The list from /api/he/requisitions/open is open by definition. */
export function pickerOptions(reqs: readonly OpenRequisition[], view: SwitchesView, source: SourceType): OpenRequisition[] {
  const listed = new Set(view.canary.filter((c) => c.sourceType === source).map((c) => c.requisitionId));
  return reqs.filter((r) => !listed.has(r.id));
}

export function budgetPercent(b: SwitchesView["budget"]): number {
  return b.max <= 0 ? 100 : Math.min(100, Math.round((b.used / b.max) * 100));
}

export function countsLine(c: Record<string, number> | undefined): string {
  const e = Object.entries(c ?? {}).filter(([, n]) => n > 0);
  return e.length ? e.map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`).join(", ") : "no journeys";
}

export function inboundLine(i: SwitchesView["inbound"]): { ok: boolean; text: string } {
  const last = i.lastInboundAt ? `last reply ${i.lastInboundAt}` : "no reply received yet";
  if (i.verified) return { ok: true, text: `Verified. ${last}, ${i.inbound7d} in 7 days.` };
  return { ok: false, text: `Not verified${i.acknowledged ? " (risk acknowledged by the owner)" : ""}. ${last}, ${i.inbound7d} in 7 days.` };
}
