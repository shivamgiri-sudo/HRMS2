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
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { countSeverity, formatDate, formatDateTime, SEVERITY_CLASS } from "./opsControlTowerFormat";
import {
  JOIN_BUCKETS,
  type BranchRef,
  type CountBlock,
  type DateBlock,
  type DetailBlockKey,
  type DetailRow,
  type JoiningBlock,
  type MismatchBlock,
  type OpsControlTowerSummary,
} from "./opsControlTowerTypes";

const BASE = "/api/ops-control-tower";
const REFRESH_MS = 120_000;

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

interface Selected {
  block: DetailBlockKey;
  branchId: string;
  branchName: string;
  title: string;
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

const CountCell = ({ n, onClick, mediumAt = 3, highAt = 8 }: { n: number; onClick?: () => void; mediumAt?: number; highAt?: number }) => {
  const sev = countSeverity(n, mediumAt, highAt);
  const cls = `font-mono font-semibold ${SEVERITY_CLASS[sev]} ${n > 0 && onClick ? "cursor-pointer hover:underline" : ""}`;
  return n > 0 && onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={`${n} — view records`}>{n}</button>
  ) : (
    <span className={cls}>{n}</span>
  );
};

// ── The 8 sections ───────────────────────────────────────────────────────────────────────────
function MismatchSection({ block, onOpen }: { block: MismatchBlock; onOpen: (b: BranchRef) => void }) {
  return (
    <SectionShell id="mismatch" title="Attendance mismatched" meaning="Biometric punch disagrees with roster/shift, still unresolved." source="attendance_reconciliation_issue">
      <Table head={<><th className="px-4 py-2">Branch</th><th className="px-4 py-2 text-right">Mismatched</th><th className="px-4 py-2 text-right">Correction done — last date</th></>}>
        {block.branches.map((r) => (
          <tr key={r.branchId} className="border-b last:border-0">
            <td className="px-4 py-2 font-medium text-slate-900">{r.branchName}</td>
            <td className="px-4 py-2 text-right"><CountCell n={r.count} onClick={() => onOpen(r)} mediumAt={5} highAt={12} /></td>
            <td className={`px-4 py-2 text-right font-mono text-xs ${r.stale ? "font-semibold text-red-600" : "text-slate-500"}`}>{formatDate(r.correctionLastDateMs)}</td>
          </tr>
        ))}
        <tr className="border-t-2 bg-slate-50 font-semibold">
          <td className="px-4 py-2">Grand Total</td>
          <td className="px-4 py-2 text-right font-mono">{block.grandTotal}</td>
          <td className="px-4 py-2 text-right">—</td>
        </tr>
      </Table>
    </SectionShell>
  );
}

function RosterDateSection({ block }: { block: DateBlock }) {
  return (
    <SectionShell id="roster" title="Roster uploaded — last date" meaning="Most recent committed roster upload per branch (same data as the Roster Upload Tracker)." source="wfm_roster_import_batch.committed_at">
      <Table head={<><th className="px-4 py-2">Branch</th><th className="px-4 py-2 text-right">Roster uploaded — last date</th></>}>
        {block.branches.map((r) => (
          <tr key={r.branchId} className="border-b last:border-0">
            <td className="px-4 py-2 font-medium text-slate-900">{r.branchName}</td>
            <td className={`px-4 py-2 text-right font-mono text-xs ${r.stale ? "font-semibold text-red-600" : "text-slate-600"}`}>{formatDate(r.lastDateMs)}</td>
          </tr>
        ))}
        <tr className="border-t-2 bg-slate-50 font-semibold">
          <td className="px-4 py-2">Grand Total</td>
          <td className="px-4 py-2 text-right text-xs">{block.branches.filter((b) => b.stale).length ? `${block.branches.filter((b) => b.stale).length} branch(es) overdue` : "All current"}</td>
        </tr>
      </Table>
    </SectionShell>
  );
}

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

interface SimpleSectionDef { id: string; title: string; meaning: string; source: string; block: DetailBlockKey; mediumAt?: number; highAt?: number }

function SimpleCountSection({ def, block, onOpen }: { def: SimpleSectionDef; block: CountBlock; onOpen: (b: BranchRef, block: DetailBlockKey, title: string) => void }) {
  return (
    <SectionShell id={def.id} title={def.title} meaning={def.meaning} source={def.source}>
      <Table head={<><th className="px-4 py-2">Branch</th><th className="px-4 py-2 text-right">{def.title}</th></>}>
        {block.branches.map((r) => (
          <tr key={r.branchId} className="border-b last:border-0">
            <td className="px-4 py-2 font-medium text-slate-900">{r.branchName}</td>
            <td className="px-4 py-2 text-right"><CountCell n={r.count} onClick={() => onOpen(r, def.block, def.title)} mediumAt={def.mediumAt} highAt={def.highAt} /></td>
          </tr>
        ))}
        <tr className="border-t-2 bg-slate-50 font-semibold">
          <td className="px-4 py-2">Grand Total</td>
          <td className="px-4 py-2 text-right font-mono">{block.grandTotal}</td>
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

// ── Drawer ────────────────────────────────────────────────────────────────────────────────────
function rowLabel(block: DetailBlockKey, row: DetailRow): { days: number; note: string } {
  switch (block) {
    case "attendance-mismatch": { const r = row as import("./opsControlTowerTypes").AttendanceMismatchDetailRow; return { days: r.daysOpen, note: r.issueType.replace(/_/g, " ") }; }
    case "fnf-pending": { const r = row as import("./opsControlTowerTypes").FnfDetailRow; return { days: r.daysOpen, note: `${r.status} · ₹${r.netPayable.toLocaleString("en-IN")}` }; }
    case "noc-pending": { const r = row as import("./opsControlTowerTypes").NocDetailRow; return { days: r.daysOpen, note: r.status.replace(/_/g, " ") }; }
    case "esign-pending": { const r = row as import("./opsControlTowerTypes").SlaDetailRow; return { days: r.daysOverdue, note: `Day 3 was ${formatDate(r.dueDateMs)}` }; }
    case "appointment-letter": { const r = row as import("./opsControlTowerTypes").SlaDetailRow; return { days: r.daysOverdue, note: `Day 7 was ${formatDate(r.dueDateMs)}` }; }
    default: { const r = row as import("./opsControlTowerTypes").OnboardingDetailRow; return { days: r.daysOpen, note: r.status.replace(/_/g, " ") }; }
  }
}

function DetailDrawer({ selected, onClose }: { selected: Selected | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["ops-control-tower-detail", selected?.block, selected?.branchId],
    enabled: selected !== null,
    queryFn: () => hrmsApi.get<{ rows: DetailRow[] }>(`${BASE}/${selected!.block}/${selected!.branchId}`),
  });
  return (
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-10">
          <SheetTitle>{selected ? `${selected.title} — ${selected.branchName}` : ""}</SheetTitle>
          <SheetDescription>{query.data ? `${query.data.rows.length} record${query.data.rows.length === 1 ? "" : "s"}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        {query.isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
        {query.isError && <p className="mt-6 text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Could not load this list."}</p>}
        {query.data && (
          <ul className="mt-4 space-y-2">
            {query.data.rows.map((row, i) => {
              const base = row as { employeeId: string; employeeCode: string; employeeName: string };
              const { days, note } = rowLabel(selected!.block, row);
              return (
                <li key={base.employeeId ?? i} className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{base.employeeName || "—"}</div>
                    <div className="font-mono text-xs text-slate-500">{base.employeeCode}</div>
                    <div className="text-xs text-slate-500">{note}</div>
                  </div>
                  {Number.isFinite(days) && (
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 font-mono text-xs font-semibold ${days > 2 ? "bg-red-50 text-red-700" : days > 0 ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {days}d
                    </span>
                  )}
                </li>
              );
            })}
            {query.data.rows.length === 0 && <p className="text-sm text-slate-400">No records.</p>}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────
export default function OpsControlTowerPage() {
  const [date, setDate] = useState(() => todayISO());
  const [selected, setSelected] = useState<Selected | null>(null);

  const query = useQuery({
    queryKey: ["ops-control-tower", date],
    queryFn: () => hrmsApi.get<OpsControlTowerSummary>(`${BASE}?date=${date}`),
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;

  const openSimple = (b: BranchRef, block: DetailBlockKey, title: string) => setSelected({ block, branchId: b.branchId, branchName: b.branchName, title });
  const openMismatch = (b: BranchRef) => setSelected({ block: "attendance-mismatch", branchId: b.branchId, branchName: b.branchName, title: "Attendance mismatched" });

  const SIMPLE_DEFS: SimpleSectionDef[] = [
    { id: "fnf", title: "F&F pending", meaning: "Exited employees whose full-and-final settlement has not been paid.", source: "full_final_calculation.status", block: "fnf-pending", mediumAt: 3, highAt: 8 },
    { id: "noc", title: "NOC pending", meaning: "Exit clearance certificates not yet issued — asset return or signatory sign-off outstanding.", source: "noc_case.status", block: "noc-pending", mediumAt: 2, highAt: 6 },
    { id: "digilocker", title: "DigiLocker documents pending", meaning: "New joiners (last 30 days) whose Aadhaar/PAN pull via DigiLocker has not completed.", source: "ats_onboarding_bridge.digilocker_status", block: "digilocker-pending", mediumAt: 5, highAt: 15 },
    { id: "esign", title: "eSign overdue — joining kit (Day 3)", meaning: "Joining-kit documents not e-signed within 3 days of the employee code being created.", source: "ats_onboarding_bridge vs created_at + 3d", block: "esign-pending", mediumAt: 5, highAt: 15 },
    { id: "appt", title: "Appointment letter eSigned before Day 7", meaning: "Employees whose appointment letter should have been e-signed within 7 days of their code being created, and has not.", source: "appointment_letter_issue vs created_at + 7d", block: "appointment-letter", mediumAt: 2, highAt: 6 },
    { id: "penny-drop", title: "Employee ID created but Penny Drop is missing", meaning: "New joiners (last 30 days) whose bank account has not been penny-drop verified successfully.", source: "bank_penny_drop_log.penny_drop_status", block: "penny-drop-missing", mediumAt: 5, highAt: 15 },
    { id: "account-details", title: "Employee ID created — no Account details in HRMS yet", meaning: "New joiners with no bank account details captured in HRMS at all.", source: "employee_bank_detail (row missing)", block: "account-details-missing", mediumAt: 5, highAt: 15 },
    { id: "bgv", title: "Employee ID created — BGV is pending", meaning: "New joiners whose background verification report is not yet marked clear.", source: "candidate_bgv_report.overall_status", block: "bgv-pending", mediumAt: 5, highAt: 15 },
    { id: "it-prov", title: "Employee ID created — IT Provisioning is pending", meaning: "New joiners with an open IT provisioning task (domain/email/biometric) at joining.", source: "it_provisioning_request (assigned_role = branch_it)", block: "it-provisioning-pending", mediumAt: 3, highAt: 10 },
    { id: "admin-prov", title: "Employee ID created — Admin Provisioning is pending", meaning: "New joiners with an open Admin provisioning task (biometric/ID card etc.) at joining.", source: "it_provisioning_request (assigned_role = admin)", block: "admin-provisioning-pending", mediumAt: 3, highAt: 10 },
    { id: "wfm-prov", title: "Employee ID created — WFM Provisioning is pending", meaning: "New joiners with an open WFM provisioning task at joining.", source: "it_provisioning_request (assigned_role = wfm)", block: "wfm-provisioning-pending", mediumAt: 3, highAt: 10 },
  ];

  const BLOCK_DATA: Record<string, CountBlock | undefined> = data ? {
    "fnf-pending": data.fnfPending,
    "noc-pending": data.nocPending,
    "digilocker-pending": data.digilockerPending,
    "esign-pending": data.esignPending,
    "appointment-letter": data.appointmentLetter,
    "penny-drop-missing": data.pennyDropMissing,
    "account-details-missing": data.accountDetailsMissing,
    "bgv-pending": data.bgvPending,
    "it-provisioning-pending": data.itProvisioningPending,
    "admin-provisioning-pending": data.adminProvisioningPending,
    "wfm-provisioning-pending": data.wfmProvisioningPending,
  } : {};

  return (
    <DashboardLayout>
      <div className="max-w-full space-y-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Operations</p>
            <h1 className="text-2xl font-bold text-slate-900">Ops Control Tower</h1>
            <p className="text-sm text-slate-600">Every onboarding and operational deliverable, branch-wise. Click any number for the real records behind it.</p>
          </div>
          {data && <span className="whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-mono text-xs text-amber-700">As of {formatDateTime(data.nowMs)}</span>}
        </div>

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

        {query.isError && !data && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {query.error instanceof Error ? query.error.message : "Could not load the ops control tower."}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-5">
              <SummaryTile label="Attendance mismatched" n={data.attendanceMismatch.grandTotal} sub={`${data.attendanceMismatch.branches.filter((b) => b.count > 0).length} branches`} onClick={() => document.getElementById("mismatch")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="Joined this date" n={data.joining.grandTotal} sub={`${data.joining.grandBuckets["Same day"]} same day`} onClick={() => document.getElementById("joining")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="F&F pending" n={data.fnfPending.grandTotal} sub="not yet paid" onClick={() => document.getElementById("fnf")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="NOC pending" n={data.nocPending.grandTotal} sub="clearance open" onClick={() => document.getElementById("noc")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="DigiLocker pending" n={data.digilockerPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("digilocker")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="eSign overdue" n={data.esignPending.grandTotal} sub={`past Day ${data.esignSlaDays}`} onClick={() => document.getElementById("esign")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="Appointment letter overdue" n={data.appointmentLetter.grandTotal} sub={`past Day ${data.appointmentLetterSlaDays}`} onClick={() => document.getElementById("appt")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="Roster not current" n={data.rosterUploaded.branches.filter((b) => b.stale).length} sub="branches overdue" onClick={() => document.getElementById("roster")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="Penny drop missing" n={data.pennyDropMissing.grandTotal} sub="new joiners" onClick={() => document.getElementById("penny-drop")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="Account details missing" n={data.accountDetailsMissing.grandTotal} sub="no bank details yet" onClick={() => document.getElementById("account-details")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="BGV pending" n={data.bgvPending.grandTotal} sub="not yet clear" onClick={() => document.getElementById("bgv")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="IT provisioning pending" n={data.itProvisioningPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("it-prov")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="Admin provisioning pending" n={data.adminProvisioningPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("admin-prov")?.scrollIntoView({ behavior: "smooth" })} />
              <SummaryTile label="WFM provisioning pending" n={data.wfmProvisioningPending.grandTotal} sub="new joiners" onClick={() => document.getElementById("wfm-prov")?.scrollIntoView({ behavior: "smooth" })} />
            </div>

            <MismatchSection block={data.attendanceMismatch} onOpen={openMismatch} />
            <RosterDateSection block={data.rosterUploaded} />
            <JoiningSection block={data.joining} />
            {SIMPLE_DEFS.map((def) => {
              const block = BLOCK_DATA[def.block];
              return block ? <SimpleCountSection key={def.id} def={def} block={block} onOpen={openSimple} /> : null;
            })}
          </>
        )}
      </div>
      <DetailDrawer selected={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
}
