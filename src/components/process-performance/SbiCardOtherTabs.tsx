import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import KpiScorecardDetail from "./KpiScorecardDetail";
import { KpiCard, type KpiScorecardRow } from "@/pages/ProcessKpiDashboardPage";
import { fmtDate } from "./lpCallShared";
import type { SbiAccounts, SbiCampaignRow, SbiDowntimeRow } from "./sbiCardTypes";
import { Empty, SortTable, inr, nz, pctTxt, timeTxt, type Col } from "./SbiCardShared";

const campCols: Array<Col<SbiCampaignRow>> = [
  { key: "c", label: "Campaign / bucket", align: "left", value: (r) => r.campaign },
  { key: "acc", label: "Accounts", value: (r) => r.accounts },
  { key: "dials", label: "Dials", value: (r) => r.dials },
  { key: "ans", label: "Answers", value: (r) => r.answers },
  { key: "con", label: "Connects", value: (r) => r.connects },
  { key: "ptp", label: "PTP", value: (r) => r.ptp },
  { key: "pad", label: "PAD", value: (r) => r.pad },
  { key: "otp", label: "OTP", value: (r) => r.otp },
  { key: "cr", label: "Contact %", value: (r) => r.contactRatePct, render: (r) => pctTxt(r.contactRatePct) },
  { key: "pr", label: "PTP %", value: (r) => r.ptpRatePct, render: (r) => pctTxt(r.ptpRatePct) },
];

export function SbiCardCampaignsTab({ rows }: { rows: SbiCampaignRow[] }) {
  if (!rows.length) return <Empty>No campaign data for this range. Upload the Dialer MIS to populate it.</Empty>;
  return <SortTable rows={rows} cols={campCols} caption="Performance by campaign / bucket" rowKey={(r) => r.campaign} />;
}

const dtCols: Array<Col<SbiDowntimeRow>> = [
  { key: "d", label: "Date", align: "left", value: (r) => r.date, render: (r) => fmtDate(r.date) },
  { key: "s", label: "Start", value: (r) => timeTxt(r.startTime) },
  { key: "u", label: "Up time", value: (r) => timeTxt(r.upTime) },
  { key: "m", label: "Downtime (min)", value: (r) => r.downtimeMinutes },
  { key: "i", label: "Impacted users", value: (r) => r.impactedUsers },
  { key: "r", label: "Reason", align: "left", value: (r) => r.reason ?? "—" },
  { key: "st", label: "Status", align: "left", value: (r) => r.status ?? "—" },
];

export function SbiCardDowntimeTab({ rows }: { rows: SbiDowntimeRow[] }) {
  if (!rows.length) return <Empty>No downtime recorded in this range.</Empty>;
  const total = rows.reduce((s, r) => s + (r.downtimeMinutes ?? 0), 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">{rows.length} incident(s), {nz(total)} minutes total downtime.</p>
      <SortTable rows={rows} cols={dtCols} caption="Dialer downtime incidents" rowKey={(r, i) => `${r.date}|${r.startTime}|${i}`} />
    </div>
  );
}

export function SbiCardAccountsTab({ accounts }: { accounts: SbiAccounts }) {
  if (!accounts || !accounts.total) return <Empty>No account file loaded. Upload the Account File to populate it.</Empty>;
  const maxCycle = Math.max(1, ...accounts.byBillingCycle.map((c) => c.count));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm text-slate-700">
        <span><b className="tabular-nums">{nz(accounts.total)}</b> accounts</span>
        <span>Total due <b className="tabular-nums">{inr(accounts.totalDue)}</b></span>
        <span>Current balance <b className="tabular-nums">{inr(accounts.curBal)}</b></span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="sbi-delq">
          <h3 id="sbi-delq" className="mb-2 text-sm font-bold text-slate-800">By delinquency</h3>
          <SortTable rows={accounts.byDelq} caption="Accounts by delinquency" rowKey={(r) => r.delq} cols={[
            { key: "d", label: "Delinquency", align: "left", value: (r) => r.delq },
            { key: "c", label: "Accounts", value: (r) => r.count },
            { key: "t", label: "Total due", value: (r) => r.totalDue, render: (r) => inr(r.totalDue) },
          ]} />
        </section>
        <section aria-labelledby="sbi-cycle">
          <h3 id="sbi-cycle" className="mb-2 text-sm font-bold text-slate-800">By billing cycle</h3>
          <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
            {accounts.byBillingCycle.map((c) => (
              <li key={c.cycle} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-slate-600">Cycle {c.cycle}</span>
                <span className="h-3 rounded bg-indigo-500" style={{ width: `${(c.count / maxCycle) * 100}%`, minWidth: 2 }} aria-hidden />
                <span className="tabular-nums text-slate-700">{nz(c.count)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function SbiCardKpiTab({ from, to }: { from: string; to: string }) {
  const [open, setOpen] = useState<KpiScorecardRow | null>(null);
  const q = useQuery({
    queryKey: ["process-kpi-dashboard", "scorecards", "SBI_CARD", from, to],
    queryFn: () => hrmsApi.get<HrmsEnvelope<KpiScorecardRow[]>>(`/api/process-kpi-dashboard/SBI_CARD/scorecards?from=${from}&to=${to}`),
  });
  const rows = q.data?.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">SLA targets scored against real records only ("Not tracked"/"No data" where no feed exists).</p>
        <Link to="/performance/process-kpi-dashboard" className="text-xs font-semibold text-indigo-600 hover:underline">Open Process KPI Dashboard →</Link>
      </div>
      {q.isLoading && <p className="text-sm text-slate-500"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Loading KPIs…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-600">Could not load KPI scorecards.</p>}
      {!q.isLoading && !q.isError && !rows.length && <Empty>No KPIs registered for SBI Card yet.</Empty>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => <KpiCard key={r.metricKey} row={r} onOpen={() => r.availability === "ok" && setOpen(r)} />)}
      </div>
      {open && <KpiScorecardDetail open onClose={() => setOpen(null)} processCode="SBI_CARD" row={open} baseQuery={{ from, to }} />}
    </div>
  );
}
