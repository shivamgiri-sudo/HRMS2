// Pure helpers behind the Ops Control Tower's analytics panel and drill-down drawer (no React, no fetch).
import { formatDate } from "./opsControlTowerFormat";
import type {
  CountBlock, DetailBlockKey, NudgeInfo, NudgeResult, NudgeableBlock, OpsControlTowerSummary, RowExtras,
} from "./opsControlTowerTypes";

export const NUDGEABLE_BLOCKS: readonly NudgeableBlock[] = [
  "account-details-missing", "docs-pending", "penny-drop-missing", "digilocker-pending", "esign-pending", "appointment-letter", "bgv-pending",
];
export const isNudgeableBlock = (b: string): b is NudgeableBlock => (NUDGEABLE_BLOCKS as readonly string[]).includes(b);

// ── Funnel: the joiner journey in the order a new hire moves through it ───────────────────────
export interface FunnelStep { key: DetailBlockKey; label: string; sectionId: string; total: number }

export function buildFunnel(d: OpsControlTowerSummary): FunnelStep[] {
  return [
    { key: "account-details-missing", label: "Bank details", sectionId: "account-details", total: d.accountDetailsMissing.grandTotal },
    { key: "docs-pending", label: "Documents", sectionId: "docs-pending", total: d.docsPending.grandTotal },
    { key: "penny-drop-missing", label: "Penny drop", sectionId: "penny-drop", total: d.pennyDropMissing.grandTotal },
    { key: "digilocker-pending", label: "DigiLocker", sectionId: "digilocker", total: d.digilockerPending.grandTotal },
    { key: "esign-pending", label: "Joining-kit eSign", sectionId: "esign", total: d.esignPending.grandTotal },
    { key: "appointment-letter", label: "Appointment letter", sectionId: "appt", total: d.appointmentLetter.grandTotal },
    { key: "bgv-pending", label: "BGV", sectionId: "bgv", total: d.bgvPending.grandTotal },
    { key: "address-review-pending", label: "Address review", sectionId: "address-review", total: d.addressReviewPending.grandTotal },
    { key: "it-provisioning-pending", label: "IT", sectionId: "it-prov", total: d.itProvisioningPending.grandTotal },
    { key: "admin-provisioning-pending", label: "Admin", sectionId: "admin-prov", total: d.adminProvisioningPending.grandTotal },
    { key: "wfm-provisioning-pending", label: "WFM", sectionId: "wfm-prov", total: d.wfmProvisioningPending.grandTotal },
  ];
}

/** Index of the step holding the most pending joiners — the bottleneck to call out. */
export function bottleneck(steps: FunnelStep[]): FunnelStep | null {
  const top = steps.reduce<FunnelStep | null>((m, s) => (m === null || s.total > m.total ? s : m), null);
  return top && top.total > 0 ? top : null;
}

// ── Branch ranking: where the open work is concentrated ───────────────────────────────────────
export interface BranchRank {
  branchId: string; branchName: string; total: number;
  worstBlock: DetailBlockKey; worstLabel: string; worstCount: number;
}

export function rankBranches(d: OpsControlTowerSummary, limit = 8): BranchRank[] {
  const blocks: Array<[DetailBlockKey, string, CountBlock]> = [
    ["fnf-pending", "F&F", d.fnfPending], ["noc-pending", "NOC", d.nocPending],
    ["digilocker-pending", "DigiLocker", d.digilockerPending], ["esign-pending", "eSign", d.esignPending],
    ["appointment-letter", "Appt. letter", d.appointmentLetter], ["penny-drop-missing", "Penny drop", d.pennyDropMissing],
    ["account-details-missing", "Bank details", d.accountDetailsMissing], ["docs-pending", "Documents", d.docsPending], ["bgv-pending", "BGV", d.bgvPending], ["address-review-pending", "Address review", d.addressReviewPending],
    ["it-provisioning-pending", "IT", d.itProvisioningPending], ["admin-provisioning-pending", "Admin", d.adminProvisioningPending],
    ["wfm-provisioning-pending", "WFM", d.wfmProvisioningPending],
  ];
  const acc = new Map<string, BranchRank>();
  for (const [key, label, block] of blocks) {
    for (const r of block.branches) {
      const cur = acc.get(r.branchId) ?? { branchId: r.branchId, branchName: r.branchName, total: 0, worstBlock: key, worstLabel: label, worstCount: 0 };
      cur.total += r.count;
      if (r.count > cur.worstCount) { cur.worstBlock = key; cur.worstLabel = label; cur.worstCount = r.count; }
      acc.set(r.branchId, cur);
    }
  }
  for (const m of d.attendanceMismatch.branches) {
    const cur = acc.get(m.branchId) ?? { branchId: m.branchId, branchName: m.branchName, total: 0, worstBlock: "attendance-mismatch" as DetailBlockKey, worstLabel: "Attendance", worstCount: 0 };
    cur.total += m.count;
    if (m.count > cur.worstCount) { cur.worstBlock = "attendance-mismatch"; cur.worstLabel = "Attendance"; cur.worstCount = m.count; }
    acc.set(m.branchId, cur);
  }
  return [...acc.values()].filter((b) => b.total > 0).sort((a, b) => b.total - a.total || a.branchName.localeCompare(b.branchName)).slice(0, limit);
}

// ── Drawer: filtering, labels, links, export ──────────────────────────────────────────────────
export type BucketFilter = "all" | "0-2" | "3-7" | "8+";
export type NudgeFilter = "all" | "never" | "due";
export type Row = { employeeId: string; employeeCode: string; employeeName: string } & Partial<RowExtras> & Record<string, unknown>;

export function filterRows<T extends Partial<RowExtras>>(rows: T[], bucket: BucketFilter, nudge: NudgeFilter): T[] {
  return rows.filter((r) => {
    if (bucket !== "all" && r.ageBucket !== bucket) return false;
    if (nudge === "never" && (r.nudge?.count ?? 0) > 0) return false;
    if (nudge === "due" && r.nudge?.due !== true) return false;
    return true;
  });
}

export function countByBucket(rows: Array<Partial<RowExtras>>): Record<"0-2" | "3-7" | "8+", number> {
  const out = { "0-2": 0, "3-7": 0, "8+": 0 };
  for (const r of rows) if (r.ageBucket) out[r.ageBucket]++;
  return out;
}

export function nudgeLabel(n: NudgeInfo | undefined): string {
  if (!n || n.count === 0 || n.lastSentMs === null) return "Never notified";
  return `Notified ${n.count}× · last ${formatDate(n.lastSentMs)}`;
}

/** Red flag: open 3+ days and never notified — nobody has told the joiner. */
export function neglected(r: Partial<RowExtras>): boolean {
  return (r.daysOpen ?? 0) >= 3 && r.nudge !== undefined && r.nudge.count === 0;
}

export interface RowLink { label: string; href: string; /** The one action HR / payroll should take next; rendered as a button, listed first. */ primary?: boolean }
export function rowLinks(block: DetailBlockKey, r: { employeeId: string; candidateId?: string | null }): RowLink[] {
  const links: RowLink[] = [{ label: "Employee 360", href: `/employees/${r.employeeId}/360` }];
  // HR / payroll fix on behalf of the employee on the existing profile-completion page, which writes
  // to the same tables the candidate flow does. ?step= opens the right tab.
  const fix = (step: string, label: string) => links.unshift({ label, href: `/employees/${r.employeeId}/complete-profile?step=${step}`, primary: true });
  if (block === "account-details-missing") fix("bank", "Enter bank details");
  if (block === "penny-drop-missing") fix("bank", "Fix bank / penny drop");
  if (block === "docs-pending") { fix("documents", "Upload documents"); links.push({ label: "Joining docs", href: `/employees/${r.employeeId}/joining-documents` }); }
  if (block === "digilocker-pending" || block === "bgv-pending") fix("bgv", "Verification (DigiLocker / BGV)");
  if (block === "esign-pending") links.push({ label: "Joining docs", href: `/employees/${r.employeeId}/joining-documents` });
  if ((block === "bgv-pending" || block === "address-review-pending") && r.candidateId) {
    const l = { label: block === "address-review-pending" ? "Review address (BGV report)" : "BGV report", href: `/bgv-report-view/${r.candidateId}` };
    if (block === "address-review-pending") links.unshift({ ...l, primary: true }); else links.push(l);
  }
  return links;
}

export function nudgeTally(results: NudgeResult[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of results) t[r.status] = (t[r.status] ?? 0) + 1;
  return t;
}

/** Human summary for a toast after Notify / Notify all. */
export function nudgeSummary(tally: Record<string, number>): { text: string; tone: "success" | "warning" | "error" } {
  const sent = tally.sent ?? 0;
  const cooling = tally.skipped_cooldown ?? 0;
  const noContact = (tally.skipped_no_contact ?? 0) + (tally.skipped_not_joining ?? 0);
  const failed = (tally.failed ?? 0) + (tally.not_found ?? 0);
  if (tally.skipped_unconfigured) return { text: "WhatsApp is not configured yet — nothing was sent. It will work once the provider is set up.", tone: "warning" };
  const parts = [`${sent} sent`];
  if (cooling) parts.push(`${cooling} already notified in last 24h`);
  if (noContact) parts.push(`${noContact} skipped (no mobile / not joining)`);
  if (failed) parts.push(`${failed} failed`);
  return { text: parts.join(" · "), tone: failed > 0 ? "error" : sent > 0 ? "success" : "warning" };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rowsToCsv(rows: Row[]): string {
  const head = ["Employee code", "Name", "Days open", "Age bucket", "Notified count", "Last notified"];
  const lines = rows.map((r) => [
    r.employeeCode, r.employeeName, r.daysOpen ?? "", r.ageBucket ?? "", r.nudge?.count ?? "",
    r.nudge?.lastSentMs ? formatDate(r.nudge.lastSentMs) : "",
  ].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n");
}
