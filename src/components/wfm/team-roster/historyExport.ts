import type { HistoryExportRow } from "@/hooks/useTeamRoster";

const DETAIL_COLUMNS: Array<[string, keyof HistoryExportRow]> = [
  ["Branch", "branch"], ["Process", "process"], ["Submission", "submissionNo"], ["Status", "status"],
  ["Raised by", "raisedBy"], ["Raised by code", "raisedByCode"], ["Raised at", "raisedAt"],
  ["Period from", "periodFrom"], ["Period to", "periodTo"], ["Manager approver", "managerApprover"],
  ["Manager decision", "managerDecision"], ["Manager decided by", "managerDecidedBy"], ["Manager decided at", "managerDecidedAt"], ["Manager remarks", "managerRemarks"],
  ["WFM decision", "wfmDecision"], ["WFM decided by", "wfmDecidedBy"], ["WFM decided at", "wfmDecidedAt"], ["WFM remarks", "wfmRemarks"],
  ["Applied at", "appliedAt"],
  ["Employee code", "employeeCode"], ["Employee", "employeeName"], ["Roster date", "rosterDate"], ["Kind", "kind"],
  ["Old", "oldAssignment"], ["New", "newAssignment"], ["Reason", "reason"], ["Line result", "lineResult"], ["Skip reason", "skipReason"], ["Note", "submissionNote"],
];

/** Header + one row per raised cell, in the order the server sorted them (branch, process, manager). */
export function detailRows(rows: HistoryExportRow[]): string[][] {
  return [DETAIL_COLUMNS.map(([h]) => h), ...rows.map((r) => DETAIL_COLUMNS.map(([, k]) => r[k]))];
}

/** Branch x process x manager roll-up: how many requests, cells raised, applied, skipped and rejected. */
export function summaryRows(rows: HistoryExportRow[]): Array<Array<string | number>> {
  type Acc = { branch: string; process: string; manager: string; submissions: Set<string>; raised: number; applied: number; skipped: number; rejected: number; pending: number };
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const key = `${r.branch}|${r.process}|${r.raisedBy}`;
    let g = groups.get(key);
    if (!g) { g = { branch: r.branch, process: r.process, manager: r.raisedBy, submissions: new Set(), raised: 0, applied: 0, skipped: 0, rejected: 0, pending: 0 }; groups.set(key, g); }
    g.submissions.add(r.submissionNo);
    g.raised += 1;
    if (r.status === "rejected") g.rejected += 1;
    else if (r.lineResult === "applied") g.applied += 1;
    else if (r.lineResult === "skipped" || r.lineResult === "failed") g.skipped += 1;
    else if (r.status === "pending_manager" || r.status === "pending_wfm") g.pending += 1;
  }
  const header = ["Branch", "Process", "Raised by (manager)", "Requests", "Cells raised", "Applied", "Skipped/failed", "Rejected", "Awaiting approval"];
  return [header, ...[...groups.values()].map((g) => [g.branch, g.process, g.manager, g.submissions.size, g.raised, g.applied, g.skipped, g.rejected, g.pending])];
}
