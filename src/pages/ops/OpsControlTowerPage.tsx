/**
 * Ops Control Tower — branch-wise rollup of operational deliverables previously tracked by
 * hand in Excel (owner, 2026-09-22): attendance mismatch, roster upload, joining count, F&F
 * pending, NOC pending, DigiLocker pending, eSign pending, appointment letter (Day-7 SLA),
 * penny drop missing, account details missing, BGV pending, and IT/Admin/WFM provisioning
 * pending — the last six added to close the "employee ID created but X still pending" gap.
 * Data: GET /api/ops-control-tower (backend/src/modules/ops-control-tower/ops-control-tower.service.ts).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OpsDetailDrawer, type Selected } from "./OpsDetailDrawer";
import { OpsAnalyticsPanel } from "./OpsAnalyticsPanel";
import { OpsSyncHealth } from "./OpsSyncHealth";
import { MATRIX_COLUMNS, OpsBranchMatrix } from "./OpsBranchMatrix";
import { countSeverity, formatDateTime, SEVERITY_CLASS } from "./opsControlTowerFormat";
import {
  JOIN_BUCKETS,
  type BranchRef,
  type DetailBlockKey,
  type JoiningBlock,
  type OpsControlTowerSummary,
} from "./opsControlTowerTypes";

const BASE = "/api/ops-control-tower";
const REFRESH_MS = 120_000;

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// ── Shared table shell ───────────────────────────────────────────────────────────────────────
function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SectionShell({
  id, title, meaning, source, children,
}: { id: string; title: string; meaning: string; source: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-2.5 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="mt-0.5 max-w-[56ch] text-xs text-slate-500">{meaning}</p>
        </div>
        <span className="whitespace-nowrap rounded-full border bg-slate-50 px-2.5 py-0.5 font-mono text-[10.5px] text-slate-500">{source}</span>
      </div>
      {children}
    </section>
  );
}


// ── The 8 sections ───────────────────────────────────────────────────────────────────────────
function JoiningSection({ block }: { block: JoiningBlock }) {
  return (
    <SectionShell id="joining" title="Joining count" meaning={`Employees who joined on the selected date, by how many days after their employee code was created ("Same day" = 0, "-2" = 2 days after).`} source="DATEDIFF(date_of_joining, employees.created_at)">
      <Table head={<>
        <th className="px-3 py-2">Branch</th>
        <th className="px-3 py-2 text-right">Joining count</th>
        {JOIN_BUCKETS.map((b) => <th key={b} className="px-3 py-2 text-right">{b}</th>)}
      </>}>
        {block.branches.map((r) => (
          <tr key={r.branchId} className="border-b last:border-0">
            <td className="px-3 py-2 font-medium text-slate-900">{r.branchName}</td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{r.total}</td>
            {JOIN_BUCKETS.map((b) => <td key={b} className="px-3 py-2 text-right font-mono text-slate-500">{r.buckets[b] > 0 ? r.buckets[b] : "·"}</td>)}
          </tr>
        ))}
        <tr className="border-t-2 bg-slate-50 font-semibold">
          <td className="px-3 py-2">Grand Total</td>
          <td className="px-3 py-2 text-right font-mono">{block.grandTotal}</td>
          {JOIN_BUCKETS.map((b) => <td key={b} className="px-3 py-2 text-right font-mono">{block.grandBuckets[b]}</td>)}
        </tr>
      </Table>
    </SectionShell>
  );
}

// ── Summary strip ────────────────────────────────────────────────────────────────────────────
function SummaryTile({ label, n, sub, onClick }: { label: string; n: number; sub: string; onClick: () => void }) {
  const sev = countSeverity(n, 3, 8);
  return (
    <button type="button" onClick={onClick} className={`rounded-lg border-l-4 border bg-white px-3 py-2.5 text-left ${sev === "high" ? "border-l-red-500" : sev === "medium" ? "border-l-orange-500" : sev === "low" ? "border-l-amber-500" : "border-l-slate-200"}`}>
      <div className={`font-mono text-2xl font-semibold leading-tight ${SEVERITY_CLASS[sev]}`}>{n}</div>
      <div className="text-[11.5px] font-medium text-slate-600">{label}</div>
      <div className="text-[10.5px] text-slate-400">{sub}</div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────
// Sections a payroll_hr-only user may open (the server enforces the same list, PAYROLL_HR_BLOCKS).
const PAYROLL_ONLY_SECTIONS = new Set(["account-details", "penny-drop"]);

export default function OpsControlTowerPage() {
  const { hasAnyRole } = useWorkforceAccess();
  const payrollOnly = hasAnyRole("payroll_hr") && !hasAnyRole("super_admin", "admin", "hr", "hr_admin", "ceo", "branch_head", "operations_manager", "wfm", "payroll_head");
  const show = (sectionId: string) => !payrollOnly || PAYROLL_ONLY_SECTIONS.has(sectionId);
  const [date, setDate] = useState(() => todayISO());
  const [selected, setSelected] = useState<Selected | null>(null);

  const query = useQuery({
    queryKey: ["ops-control-tower", date],
    queryFn: () => hrmsApi.get<OpsControlTowerSummary>(`${BASE}?date=${date}`),
    refetchInterval: REFRESH_MS,
    staleTime: 60_000,
    placeholderData: (prev) => prev, // switching Today/Yesterday keeps the table on screen instead of blanking it
  });
  const data = query.data;

  const openSimple = (b: BranchRef, block: DetailBlockKey, title: string) => setSelected({ block, branchId: b.branchId, branchName: b.branchName, title });

  return (
    <DashboardLayout>
      <div className="w-full space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Operations</p>
            <h1 className="text-xl font-bold text-slate-900">Ops Control Tower</h1>
            <p className="text-sm text-slate-600">Every onboarding and operational deliverable, branch-wise. Click any number for the real records behind it. Counts cover current staff and new joiners; people who have left are excluded.</p>
          </div>
          {data && <span className="whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-mono text-xs text-amber-700">As of {formatDateTime(data.nowMs)}</span>}
        </div>

        {payrollOnly && (
          <div role="note" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Showing the bank and penny-drop items for your branch. Open a number to see the joiners, then use <strong>Enter bank details</strong> to fix it on their behalf.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2.5">
          <label htmlFor="dateSel" className="text-xs text-slate-500">Joining date</label>
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger id="dateSel" className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={todayISO()}>Today</SelectItem>
              <SelectItem value={new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}>Yesterday</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {query.isLoading && !data && (
          <div role="status" aria-busy="true" className="flex items-center gap-3 rounded-lg border bg-white p-5 text-sm text-slate-600">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            <span>Loading branch data… the first load after a restart can take a little while; after that it opens instantly.</span>
          </div>
        )}

        {query.isError && !data && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {query.error instanceof Error ? query.error.message : "Could not load the ops control tower."}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
              {show("mismatch") && <SummaryTile label="Attendance mismatched" n={data.attendanceMismatch.grandTotal} sub={`${data.attendanceMismatch.branches.filter((b) => b.count > 0).length} branches`} onClick={() => document.getElementById("mismatch")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("joining") && <SummaryTile label="Joined this date" n={data.joining.grandTotal} sub={`${data.joining.grandBuckets["Same day"]} same day`} onClick={() => document.getElementById("joining")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("fnf") && <SummaryTile label="F&F pending" n={data.fnfPending.grandTotal} sub="not yet paid" onClick={() => document.getElementById("fnf")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("noc") && <SummaryTile label="NOC pending" n={data.nocPending.grandTotal} sub="clearance open" onClick={() => document.getElementById("noc")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("digilocker") && <SummaryTile label="DigiLocker pending" n={data.digilockerPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("digilocker")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("esign") && <SummaryTile label="eSign overdue" n={data.esignPending.grandTotal} sub={`past Day ${data.esignSlaDays}`} onClick={() => document.getElementById("esign")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("appt") && <SummaryTile label="Appointment letter overdue" n={data.appointmentLetter.grandTotal} sub={`past Day ${data.appointmentLetterSlaDays}`} onClick={() => document.getElementById("appt")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("roster") && <SummaryTile label="Roster not current" n={data.rosterUploaded.branches.filter((b) => b.stale).length} sub="branches overdue" onClick={() => document.getElementById("roster")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("penny-drop") && <SummaryTile label="Penny drop missing" n={data.pennyDropMissing.grandTotal} sub="new joiners" onClick={() => document.getElementById("penny-drop")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("account-details") && <SummaryTile label="Account details missing" n={data.accountDetailsMissing.grandTotal} sub="no bank details yet" onClick={() => document.getElementById("account-details")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("docs-pending") && <SummaryTile label="Documents pending" n={data.docsPending.grandTotal} sub="mandatory, not yet uploaded" onClick={() => document.getElementById("docs-pending")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("bgv") && <SummaryTile label="BGV pending" n={data.bgvPending.grandTotal} sub="not yet clear" onClick={() => document.getElementById("bgv")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("address-review") && <SummaryTile label="Address awaiting HR review" n={data.addressReviewPending.grandTotal} sub="selfie submitted, undecided" onClick={() => document.getElementById("address-review")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("it-prov") && <SummaryTile label="IT provisioning pending" n={data.itProvisioningPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("it-prov")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("admin-prov") && <SummaryTile label="Admin provisioning pending" n={data.adminProvisioningPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("admin-prov")?.scrollIntoView({ behavior: "smooth" })} />}
              {show("wfm-prov") && <SummaryTile label="WFM provisioning pending" n={data.wfmProvisioningPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("wfm-prov")?.scrollIntoView({ behavior: "smooth" })} />}
            </div>

            {!payrollOnly && <OpsAnalyticsPanel data={data} onOpen={openSimple} />}

            {!payrollOnly && <OpsSyncHealth />}

            <OpsBranchMatrix data={data} columns={MATRIX_COLUMNS.filter((c) => show(c.id))} showRoster={show("roster")} onOpen={openSimple} />
            {!payrollOnly && <JoiningSection block={data.joining} />}
          </>
        )}
      </div>
      <OpsDetailDrawer selected={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
}
