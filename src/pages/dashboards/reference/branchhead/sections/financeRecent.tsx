import type { FinanceData, RecentGrn } from "../panelTypes";
import { formatCount, formatInr } from "../format";
import { CalendarClock, CheckCircle2, FileStack, Hourglass } from "lucide-react";
import { AccentCard, Chip, GradientKpi, KpiCell, KpiGrid, NavyTable, type ChipTone } from "../look";

/** Stage chip tone: approved is done, rejected is a problem, anything else is waiting (text carries the stage). */
export function stageTone(status: string): ChipTone {
  const s = String(status ?? "").toLowerCase();
  if (s.startsWith("approved") || s === "paid" || s === "closed") return "ok";
  if (s.startsWith("reject") || s === "cancelled") return "crit";
  return "warn";
}

/** Email section 3: the latest 15 GRNs (no drafts), as the email prints them. No requester or phone exists in the payload. */
export function FinanceRecent({ d }: { d: FinanceData }) {
  const rows = d.recentGrns ?? [];
  const total = rows.reduce((a, r) => a + (Number.isFinite(r.amountInclGst) ? r.amountInclGst : 0), 0);
  const waiting = rows.filter((r) => stageTone(r.status) === "warn");
  const done = rows.filter((r) => stageTone(r.status) === "ok");
  return (
    <div className="space-y-4">
    <KpiGrid label="Recent GRNs summary">
      <KpiCell><GradientKpi icon={FileStack} hue="navy" label="Latest GRNs" value={formatCount(rows.length)} sub={formatInr(total)} /></KpiCell>
      <KpiCell><GradientKpi icon={CheckCircle2} hue="emerald" label="Approved" value={formatCount(done.length)} sub={formatInr(done.reduce((a, r) => a + r.amountInclGst, 0))} /></KpiCell>
      <KpiCell><GradientKpi icon={Hourglass} hue="orange" label="Waiting" value={formatCount(waiting.length)} sub={formatInr(waiting.reduce((a, r) => a + r.amountInclGst, 0))} /></KpiCell>
      <KpiCell><GradientKpi icon={CalendarClock} hue="violet" label="Oldest waiting" value={waiting.length ? `${formatCount(Math.max(...waiting.map((r) => r.ageDays)))} days` : "—"} sub="Among these 15" /></KpiCell>
    </KpiGrid>
    <AccentCard title="Recent GRNs (latest 15, excluding drafts)" chip={`${rows.length} GRNs · ${formatInr(total)}`} accent="blue">
      <NavyTable<RecentGrn> caption="Latest 15 GRNs excluding drafts" rows={rows} limit={15} maxHeight={760} empty="No GRNs raised yet"
        columns={[
          { key: "no", label: "GRN no.", render: (r) => <span className="font-semibold">{r.grnNo ?? "—"}</span> },
          { key: "on", label: "Raised on", render: (r) => r.raisedOn || "—" },
          { key: "v", label: "Vendor", render: (r) => r.vendor ?? "—" },
          { key: "h", label: "Head", render: (r) => r.head ?? "—" },
          { key: "s", label: "Sub-head", render: (r) => r.subHead ?? "—" },
          { key: "a", label: "Amount incl. GST", num: true, render: (r) => formatInr(r.amountInclGst) },
          { key: "st", label: "Stage", render: (r) => <Chip tone={stageTone(r.status)}>{r.stageLabel || r.status}</Chip> },
          { key: "age", label: "Age (days)", num: true, render: (r) => formatCount(r.ageDays) },
        ]} />
    </AccentCard>
    </div>
  );
}
