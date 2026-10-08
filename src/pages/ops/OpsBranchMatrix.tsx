// One dense branch × metric matrix replacing twelve full-width two-column tables: every branch is one row,
// every deliverable one column, so the whole picture fits on a screen and a branch can be read across.
// Header cells keep the old section ids (the funnel and summary tiles scroll to them).
import { countSeverity, formatDate } from "./opsControlTowerFormat";
import type { BranchRef, CountBlock, DetailBlockKey, OpsControlTowerSummary } from "./opsControlTowerTypes";

export interface MatrixColumn {
  id: string;
  label: string;
  title: string;
  block: DetailBlockKey;
  mediumAt: number;
  highAt: number;
  count: (data: OpsControlTowerSummary, branchId: string) => number;
  total: (data: OpsControlTowerSummary) => number;
}

const fromBlock = (pick: (d: OpsControlTowerSummary) => CountBlock) => ({
  count: (d: OpsControlTowerSummary, id: string) => pick(d).branches.find((b) => b.branchId === id)?.count ?? 0,
  total: (d: OpsControlTowerSummary) => pick(d).grandTotal,
});

export const MATRIX_COLUMNS: MatrixColumn[] = [
  { id: "mismatch", label: "Attendance mismatch", title: "Days where the biometric machine and the HRMS attendance record do not agree (swiped in but HRMS shows 0 minutes, or no attendance record at all) and nobody has fixed it yet. Open person-days for current staff, all dates.", block: "attendance-mismatch", mediumAt: 5, highAt: 12,
    count: (d, id) => d.attendanceMismatch.branches.find((b) => b.branchId === id)?.count ?? 0, total: (d) => d.attendanceMismatch.grandTotal },
  { id: "fnf", label: "F&F (leavers)", title: "Exited employees whose full-and-final settlement has not been paid.", block: "fnf-pending", mediumAt: 3, highAt: 8, ...fromBlock((d) => d.fnfPending) },
  { id: "noc", label: "NOC (leavers)", title: "Exit clearance certificates not yet issued.", block: "noc-pending", mediumAt: 2, highAt: 6, ...fromBlock((d) => d.nocPending) },
  { id: "digilocker", label: "DigiLocker", title: "New joiners (last 30 days) whose Aadhaar/PAN pull via DigiLocker has not completed.", block: "digilocker-pending", mediumAt: 5, highAt: 15, ...fromBlock((d) => d.digilockerPending) },
  { id: "esign", label: "eSign Day 3", title: "Joining-kit documents not e-signed within 3 days of the employee code being created.", block: "esign-pending", mediumAt: 5, highAt: 15, ...fromBlock((d) => d.esignPending) },
  { id: "appt", label: "Appt. letter Day 7", title: "Appointment letter not e-signed within 7 days of the employee code being created.", block: "appointment-letter", mediumAt: 2, highAt: 6, ...fromBlock((d) => d.appointmentLetter) },
  { id: "penny-drop", label: "Penny drop", title: "New joiners (last 30 days) whose bank account has not been penny-drop verified.", block: "penny-drop-missing", mediumAt: 5, highAt: 15, ...fromBlock((d) => d.pennyDropMissing) },
  { id: "account-details", label: "Bank details", title: "New joiners with no bank account details captured in HRMS at all.", block: "account-details-missing", mediumAt: 5, highAt: 15, ...fromBlock((d) => d.accountDetailsMissing) },
  { id: "docs-pending", label: "Joining docs", title: "New joiners (last 30 days) with a mandatory joining document still not uploaded or verified.", block: "docs-pending", mediumAt: 5, highAt: 15, ...fromBlock((d) => d.docsPending) },
  { id: "bgv", label: "BGV", title: "New joiners whose background verification is not yet clear.", block: "bgv-pending", mediumAt: 5, highAt: 15, ...fromBlock((d) => d.bgvPending) },
  { id: "address-review", label: "Address review", title: "Address verification selfies submitted by new joiners that HR has not yet passed or failed (the GPS check only auto-passes within 50 m).", block: "address-review-pending", mediumAt: 3, highAt: 10, ...fromBlock((d) => d.addressReviewPending) },
  { id: "it-prov", label: "IT prov.", title: "Open IT provisioning task (domain/email/biometric) at joining.", block: "it-provisioning-pending", mediumAt: 3, highAt: 10, ...fromBlock((d) => d.itProvisioningPending) },
  { id: "admin-prov", label: "Admin prov.", title: "Open Admin provisioning task (biometric/ID card etc.) at joining.", block: "admin-provisioning-pending", mediumAt: 3, highAt: 10, ...fromBlock((d) => d.adminProvisioningPending) },
  { id: "wfm-prov", label: "WFM prov.", title: "Open WFM provisioning task at joining.", block: "wfm-provisioning-pending", mediumAt: 3, highAt: 10, ...fromBlock((d) => d.wfmProvisioningPending) },
];

const CELL_BG: Record<string, string> = {
  none: "text-slate-300",
  low: "bg-amber-50 text-amber-700",
  medium: "bg-orange-50 text-orange-700",
  high: "bg-red-50 text-red-700",
};

export function OpsBranchMatrix({ data, columns, showRoster, onOpen }: {
  data: OpsControlTowerSummary;
  columns: MatrixColumn[];
  showRoster: boolean;
  onOpen: (b: BranchRef, block: DetailBlockKey, title: string) => void;
}) {
  const branches: BranchRef[] = data.attendanceMismatch.branches.map((b) => ({ branchId: b.branchId, branchName: b.branchName }));
  const rosterByBranch = new Map(data.rosterUploaded.branches.map((b) => [b.branchId, b]));
  const staleCount = data.rosterUploaded.branches.filter((b) => b.stale).length;
  const hasLeaverColumns = columns.some((c) => c.id === "fnf" || c.id === "noc");

  return (
    <section aria-label="Branch overview" className="rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-bold text-slate-900">All branches at a glance</h2>
        <p className="text-xs text-slate-500">Click a number for the records behind it. Hover a column heading for its meaning. People who have left are not counted{hasLeaverColumns ? ", except in the two leaver columns (F&F, NOC)" : ""}.</p>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 top-0 z-20 border-b bg-slate-50 px-3 py-2">Branch</th>
              {columns.map((c) => (
                <th key={c.id} id={c.id} title={c.title} className="sticky top-0 z-10 scroll-mt-24 whitespace-nowrap border-b bg-slate-50 px-2 py-2 text-right">{c.label}</th>
              ))}
              {showRoster && <th id="roster" title="Most recent committed roster upload per branch." className="sticky top-0 z-10 scroll-mt-24 whitespace-nowrap border-b bg-slate-50 px-3 py-2 text-right">Roster last upload</th>}
            </tr>
          </thead>
          <tbody>
            {branches.map((br) => {
              const roster = rosterByBranch.get(br.branchId);
              return (
                <tr key={br.branchId} className="group">
                  <td className="sticky left-0 z-10 whitespace-nowrap border-b bg-white px-3 py-1.5 font-medium text-slate-900 group-hover:bg-slate-50">{br.branchName}</td>
                  {columns.map((c) => {
                    const n = c.count(data, br.branchId);
                    const sev = countSeverity(n, c.mediumAt, c.highAt);
                    return (
                      <td key={c.id} className={`border-b px-2 py-1.5 text-right font-mono ${CELL_BG[sev]}`}>
                        {n > 0 ? (
                          <button type="button" className="min-w-[2rem] rounded px-1 font-semibold hover:underline" aria-label={`${br.branchName}: ${n} ${c.label} — view records`}
                            onClick={() => onOpen(br, c.block, c.label)}>{n}</button>
                        ) : "·"}
                      </td>
                    );
                  })}
                  {showRoster && (
                    <td className={`whitespace-nowrap border-b px-3 py-1.5 text-right font-mono text-xs ${roster?.stale ? "font-semibold text-red-600" : "text-slate-500"}`}>{formatDate(roster?.lastDateMs ?? null)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="sticky bottom-0 left-0 z-20 border-t-2 bg-slate-50 px-3 py-2">Grand total</td>
              {columns.map((c) => <td key={c.id} className="sticky bottom-0 z-10 border-t-2 bg-slate-50 px-2 py-2 text-right font-mono">{c.total(data)}</td>)}
              {showRoster && <td className="sticky bottom-0 z-10 border-t-2 bg-slate-50 px-3 py-2 text-right text-xs">{staleCount ? `${staleCount} overdue` : "All current"}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
