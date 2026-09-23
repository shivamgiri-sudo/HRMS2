import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DASH, EmptyNote, GranularityPills, MatrixLineChart, MatrixTable, SectionCard, SectionState, fmtDate, fmtHc, fmtPct,
  matrixIsEmpty, type AonRow, type DateRange, type Granularity, type Matrix, type MatrixFormat, type OverviewReport,
  type QueueRow, type Section,
} from "./onfidoReportShared";
import { OnfidoManpowerPlanSheet, QUEUE_OPTIONS, usePlanRecords, useCanEditWfmInputs } from "./OnfidoManpowerPlanSheet";

/**
 * Overview tab in the 23-Sep-26 format ("OVERVIEW PAGE NEED TO CHANGE.xlsx"), replacing the
 * earlier KPI-tile / month-wise layout entirely. Each section has its own Daily / Weekly /
 * Monthly toggle; the executive From / To range comes from the page's filter bar.
 * Figures with no source stay "-" (see the note on each section), never a made-up number.
 */

type TrendKey = Exclude<keyof OverviewReport, "granularity" | "from" | "to" | "manpower" | "aon">;

interface TrendSpec {
  key: TrendKey; title: string; accent: string; format: MatrixFormat; labelHeader: string; emptyText: string;
  subtitle?: string; formats?: MatrixFormat[]; chartRows?: number[]; secondAxisFrom?: number;
}

const PCT: MatrixFormat = { unit: "percent", digits: 1 };
const CNT: MatrixFormat = { unit: "count" };
const SEC: MatrixFormat = { unit: "seconds" };

const NO_APPROVED = "Approved HC has not been entered yet (use Manage approved HC), so buffer cannot be calculated.";

const TREND_SPECS: TrendSpec[] = [
  { key: "bufferTrend", title: "Manpower Buffer Trend", accent: "var(--blue)", format: PCT, formats: [PCT, CNT, CNT], chartRows: [0], labelHeader: "Metric", emptyText: NO_APPROVED, subtitle: "Buffer % = (Active HC - Approved HC) / Approved HC, Active HC as on the last day of each period." },
  { key: "attritionTrend", title: "Attrition Trend", accent: "var(--red)", format: PCT, formats: [{ unit: "percent", digits: 2 }, CNT], chartRows: [0], labelHeader: "Metric", emptyText: "No Agent Wise attrition data in this range.", subtitle: "Exits / average HC ((opening + closing) / 2) for each period." },
  { key: "shrinkageTrend", title: "Shrinkage Trend", accent: "var(--orange)", format: { unit: "percent", digits: 2 }, chartRows: [0, 1], labelHeader: "Metric", emptyText: "No Agent Wise shrinkage data in this range.", subtitle: "Actual UL / scheduled for each period." },
  { key: "docProcessingTrend", title: "Doc Processing Time Trend", accent: "var(--blue)", format: SEC, formats: [SEC, CNT], secondAxisFrom: 1, labelHeader: "Metric", emptyText: "No DOC tasks in this range.", subtitle: "AHT excludes the process_labelling_document_raw_extraction task type." },
  { key: "taskVolumeContribution", title: "Task Type Wise - Volume Contribution %", accent: "var(--purple)", format: PCT, labelHeader: "Task type", emptyText: "No DOC tasks in this range." },
  { key: "taskAht", title: "Task Type Wise AHT", accent: "var(--purple)", format: SEC, labelHeader: "Task type", emptyText: "No DOC tasks in this range." },
  { key: "internalQuality", title: "Task Type Wise Internal Quality", accent: "var(--orange)", format: PCT, labelHeader: "Task type", emptyText: "No internal QC audits in this range.", subtitle: "Error % per stage from the internal QC export (Yes / (Yes + No)); Overall = total error / total audits." },
  { key: "externalQuality", title: "Task Type Wise External Quality", accent: "var(--red)", format: PCT, labelHeader: "Task type", emptyText: "No external audits in this range.", subtitle: "Error % per stage from the external audit export; Overall = audits with an error / audits." },
  { key: "poaVolumeTime", title: "POA Volume & Processing Time Trend", accent: "var(--teal)", format: SEC, formats: [SEC, CNT], secondAxisFrom: 1, labelHeader: "Metric", emptyText: "No POA tasks in this range." },
  { key: "poaQuality", title: "POA Quality Trend", accent: "var(--teal)", format: PCT, labelHeader: "Metric", emptyText: "No POA audits in this range." },
  { key: "etmTrend", title: "ETM Trend Task Type Wise", accent: "var(--purple)", format: CNT, labelHeader: "Task type", emptyText: "No ETM tasks in this range." },
  { key: "taskSkipTrend", title: "Task Skip Trend", accent: "var(--yellow)", format: CNT, labelHeader: "Task type", emptyText: "No skipped tasks in this range.", subtitle: "The Task Skip upload covers DOC tasks only, so there is no POA row." },
  { key: "gdMcnTrend", title: "GD & MCN Trend", accent: "var(--blue)", format: PCT, labelHeader: "Metric", emptyText: "No GD / MCN SLA data in this range." },
  { key: "utilizationTrend", title: "Utilization Trend", accent: "var(--green)", format: PCT, labelHeader: "Metric", emptyText: "Utilization needs the forecast and adhoc inputs on the Utilization tab; none are entered for this range.", subtitle: "Calculated from the Utilization tab's formulas, only for periods where every input is present." },
  { key: "creCrqTrend", title: "CRE & CRQ Trend", accent: "var(--red)", format: CNT, labelHeader: "Metric", emptyText: "No client-reported escalations in this range." },
];

function pickRows(matrix: Matrix, idx: number[] | undefined, formats: MatrixFormat[] | undefined) {
  if (!idx) return { matrix, formats };
  return { matrix: { buckets: matrix.buckets, rows: idx.map((i) => matrix.rows[i]).filter(Boolean) }, formats: formats ? idx.map((i) => formats[i]) : undefined };
}

function useOverview(g: Granularity, range: DateRange, tl: string, am: string, enabled: boolean) {
  const qs = `from=${range.from}&to=${range.to}&granularity=${g}` + (tl ? `&tlName=${encodeURIComponent(tl)}` : "") + (am ? `&amName=${encodeURIComponent(am)}` : "");
  return useQuery({
    queryKey: ["onfido-process", "overview-report", g, range, tl, am],
    queryFn: () => hrmsApi.get<{ data: OverviewReport }>(`/api/onfido-process/overview-report?${qs}`),
    enabled,
  });
}

type Drill = { kind: "total" } | { kind: "queue"; queue: QueueRow } | { kind: "aon"; row: AonRow };

const N = (v: number | null): CSSProperties => (v !== null && v < 0 ? { color: "var(--red)" } : {});

export default function OnfidoOverviewReport({ range, tlFilter, amFilter }: { range: DateRange; tlFilter: string; amFilter: string }) {
  const [fallback, setFallback] = useState<Granularity>("monthly");
  const [overrides, setOverrides] = useState<Partial<Record<string, Granularity>>>({});
  const [drill, setDrill] = useState<Drill | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const canEdit = useCanEditWfmInputs();

  const gFor = (key: string): Granularity => overrides[key] ?? fallback;
  const setFor = (key: string, g: Granularity) => setOverrides((o) => ({ ...o, [key]: g }));
  const used = new Set<Granularity>([gFor("manpower"), gFor("aon"), ...TREND_SPECS.map((s) => gFor(s.key))]);
  const q = {
    daily: useOverview("daily", range, tlFilter, amFilter, used.has("daily")),
    weekly: useOverview("weekly", range, tlFilter, amFilter, used.has("weekly")),
    monthly: useOverview("monthly", range, tlFilter, amFilter, used.has("monthly")),
  };
  const dataFor = (key: string) => q[gFor(key)].data?.data;
  const loadingFor = (key: string) => q[gFor(key)].isLoading;
  const errorFor = (key: string) => (q[gFor(key)].error instanceof Error ? (q[gFor(key)].error as Error).message : null);

  const manpowerSection: Section<NonNullable<OverviewReport["manpower"]["data"]>> | undefined = dataFor("manpower")?.manpower;
  const aonSection = dataFor("aon")?.aon;
  const mp = manpowerSection?.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="oc-eyebrow">Range for every section</span>
          <GranularityPills value={fallback} onChange={(g) => { setFallback(g); setOverrides({}); }} />
        </div>
        <button type="button" className="oc-btn-ghost" onClick={() => setPlanOpen(true)}>
          {canEdit ? "Manage approved HC" : "View approved HC"}
        </button>
      </div>

      <SectionCard
        title="Manpower Status" accent="var(--blue)"
        subtitle={mp?.asOf ? `Active HC as on ${fmtDate(mp.asOf)}${mp.planEffectiveFrom ? ` · approved HC effective ${fmtDate(mp.planEffectiveFrom)}` : ""}` : "Snapshot at the end of the selected range"}
        right={<GranularityPills value={gFor("manpower")} onChange={(g) => setFor("manpower", g)} />}
      >
        <SectionState loading={loadingFor("manpower")} error={errorFor("manpower") ?? manpowerSection?.error} empty={!mp} emptyText="No manpower data in this range.">
          {mp && (
            <>
              <div style={{ overflowX: "auto" }}>
                <table className="oc-table">
                  <thead><tr><th className="oc-right">Approved HC</th><th className="oc-right">Required HC</th><th className="oc-right">Active HC</th><th className="oc-right">Buffer %</th><th className="oc-right">Shortfall</th></tr></thead>
                  <tbody>
                    <tr className="oc-row-click" onClick={() => setDrill({ kind: "total" })}>
                      <td className="oc-right">{fmtHc(mp.approvedHc)}</td><td className="oc-right">{fmtHc(mp.requiredHc)}</td>
                      <td className="oc-right">{fmtHc(mp.activeHc)}</td><td className="oc-right" style={N(mp.bufferPct)}>{fmtPct(mp.bufferPct)}</td>
                      <td className="oc-right">{fmtHc(mp.shortfall)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {mp.approvedHc === null && (
                <div className="oc-card-sub" style={{ marginTop: 8 }}>
                  {mp.approvedMissingFor.length > 0
                    ? `Approved HC has not been entered for ${mp.approvedMissingFor.join(", ")}, so the total, buffer and shortfall are blank (enter 0 for a queue with no approved staff).`
                    : NO_APPROVED}
                </div>
              )}
            </>
          )}
        </SectionState>
      </SectionCard>

      <SectionCard title="Queue Wise" accent="var(--teal)" subtitle="Required HC = Approved HC x 120%. Click a row for its approved-HC history.">
        <SectionState loading={loadingFor("manpower")} error={errorFor("manpower") ?? manpowerSection?.error} empty={!mp} emptyText="No manpower data in this range.">
          {mp && (
            <div style={{ overflowX: "auto" }}>
              <table className="oc-table">
                <thead><tr><th>Queue</th><th className="oc-right">Required HC</th><th className="oc-right">Active HC</th><th className="oc-right">Buffer %</th><th className="oc-right">Shortfall</th></tr></thead>
                <tbody>
                  {mp.queues.map((r) => (
                    <tr key={r.queue} className="oc-row-click" onClick={() => setDrill({ kind: "queue", queue: r })}>
                      <td>{r.label}</td><td className="oc-right">{fmtHc(r.requiredHc)}</td><td className="oc-right">{fmtHc(r.activeHc)}</td>
                      <td className="oc-right" style={N(r.bufferPct)}>{fmtPct(r.bufferPct)}</td><td className="oc-right">{fmtHc(r.shortfall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionState>
      </SectionCard>

      <SectionCard
        title="AON Wise" accent="var(--purple)"
        subtitle={aonSection?.data?.asOf ? `Active HC by live days as on ${fmtDate(aonSection.data.asOf)}. Click a bucket to see who is in it.` : "Active HC by live days"}
        right={<GranularityPills value={gFor("aon")} onChange={(g) => setFor("aon", g)} />}
      >
        <SectionState loading={loadingFor("aon")} error={errorFor("aon") ?? aonSection?.error} empty={!aonSection?.data || aonSection.data.totalHc === 0} emptyText="No on-floor headcount in this range.">
          {aonSection?.data && (
            <div style={{ overflowX: "auto" }}>
              <table className="oc-table">
                <thead><tr><th>AON (days)</th><th className="oc-right">Active HC</th><th className="oc-right">Contribution</th></tr></thead>
                <tbody>
                  {aonSection.data.rows.map((r) => (
                    <tr key={r.label} className="oc-row-click" onClick={() => setDrill({ kind: "aon", row: r })}>
                      <td>{r.label}</td><td className="oc-right">{fmtHc(r.activeHc)}</td><td className="oc-right">{fmtPct(r.contributionPct)}</td>
                    </tr>
                  ))}
                  {aonSection.data.unclassifiedHc > 0 && (
                    <tr className="oc-row-click" onClick={() => setDrill({ kind: "aon", row: { label: "Unclassified", activeHc: aonSection.data!.unclassifiedHc, contributionPct: null } })}>
                      <td>Unclassified (no live days in upload)</td><td className="oc-right">{fmtHc(aonSection.data.unclassifiedHc)}</td><td className="oc-right">{DASH}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionState>
      </SectionCard>

      {TREND_SPECS.map((s) => {
        const section = dataFor(s.key)?.[s.key] as Section<Matrix> | undefined;
        const g = gFor(s.key);
        const picked = section?.data ? pickRows(section.data, s.chartRows, s.formats) : null;
        return (
          <SectionCard key={s.key} title={s.title} accent={s.accent} subtitle={s.subtitle} right={<GranularityPills value={g} onChange={(x) => setFor(s.key, x)} />}>
            <SectionState loading={loadingFor(s.key)} error={errorFor(s.key) ?? section?.error} empty={matrixIsEmpty(section?.data)} emptyText={s.emptyText}>
              {section?.data && picked && (
                <>
                  <MatrixLineChart matrix={picked.matrix} granularity={g} format={s.format} formats={picked.formats} secondAxisFrom={s.secondAxisFrom} />
                  <MatrixTable matrix={section.data} granularity={g} format={s.format} formats={s.formats} labelHeader={s.labelHeader} />
                </>
              )}
            </SectionState>
          </SectionCard>
        );
      })}

      <OverviewDrillSheet drill={drill} range={range} tl={tlFilter} am={amFilter} onClose={() => setDrill(null)} />
      <OnfidoManpowerPlanSheet open={planOpen} onOpenChange={setPlanOpen} canEdit={canEdit} />
    </div>
  );
}

interface AonAnalystsResponse { asOf: string | null; rows: { empId: string | null; empName: string | null; analyst: string | null; tlName: string | null; amName: string | null; location: string | null; liveDays: number | null }[] }

function OverviewDrillSheet({ drill, range, tl, am, onClose }: { drill: Drill | null; range: DateRange; tl: string; am: string; onClose: () => void }) {
  const plan = usePlanRecords();
  const aonLabel = drill?.kind === "aon" ? drill.row.label : null;
  const aon = useQuery({
    queryKey: ["onfido-process", "aon-analysts", aonLabel, range, tl, am],
    queryFn: () => hrmsApi.get<{ data: AonAnalystsResponse }>(
      `/api/onfido-process/overview-report/aon-analysts?from=${range.from}&to=${range.to}&bucket=${encodeURIComponent(aonLabel ?? "")}`
      + (tl ? `&tlName=${encodeURIComponent(tl)}` : "") + (am ? `&amName=${encodeURIComponent(am)}` : "")),
    enabled: aonLabel !== null,
  });
  const planRows = (plan.data?.data ?? []).filter((r) => drill?.kind !== "queue" || r.processQueue === drill.queue.queue);
  const title = drill?.kind === "queue" ? drill.queue.label : drill?.kind === "aon" ? `AON ${drill.row.label}` : "Manpower status";
  return (
    <Sheet open={drill !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="!text-[color:var(--text)]">{title}</SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">{fmtDate(range.from)} to {fmtDate(range.to)}</SheetDescription>
        </SheetHeader>
        {drill?.kind === "queue" && (
          <div className="mt-4 space-y-2 text-sm" style={{ color: "var(--text)" }}>
            <div className="oc-kv-label">How Active HC was found</div>
            <div>
              {drill.queue.activeSource === "analysts_with_tasks" && "Distinct analysts who completed at least one task in this queue during the selected period."}
              {drill.queue.activeSource === "manual_entry" && "Entered by WFM with the approved HC (no uploaded report carries Encord staffing)."}
              {drill.queue.activeSource === null && "Not available: no Active HC has been entered for this queue."}
            </div>
            <div className="oc-kv-label mt-3">Figures</div>
            <div>Approved {fmtHc(drill.queue.approvedHc)} · Required {fmtHc(drill.queue.requiredHc)} · Active {fmtHc(drill.queue.activeHc)} · Buffer {fmtPct(drill.queue.bufferPct)} · Shortfall {fmtHc(drill.queue.shortfall)}</div>
          </div>
        )}
        {drill?.kind !== "aon" && (
          <>
            <div className="oc-kv-label mt-4">Approved HC history</div>
            <table className="oc-table">
              <thead><tr><th>Queue</th><th>Effective from</th><th className="oc-right">Approved HC</th><th className="oc-right">Required HC</th></tr></thead>
              <tbody>
                {planRows.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>None</td></tr>}
                {planRows.map((r) => (
                  <tr key={r.id}><td>{QUEUE_OPTIONS.find((o) => o.key === r.processQueue)?.label}</td><td>{fmtDate(r.effectiveFrom)}</td>
                    <td className="oc-right">{fmtHc(r.approvedHc)}</td><td className="oc-right">{fmtHc(r.approvedHc * 1.2)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {drill?.kind === "aon" && (
          <>
            <div className="oc-kv-label mt-4">Analysts on floor{aon.data?.data.asOf ? ` as on ${fmtDate(aon.data.data.asOf)}` : ""}</div>
            {aon.isLoading && <EmptyNote>Loading...</EmptyNote>}
            {!aon.isLoading && (
              <table className="oc-table">
                <thead><tr><th>Emp ID</th><th>Name</th><th>TL</th><th>AM</th><th>Location</th><th className="oc-right">Live days</th></tr></thead>
                <tbody>
                  {(aon.data?.data.rows ?? []).length === 0 && <tr className="oc-empty-row"><td colSpan={6}>None</td></tr>}
                  {(aon.data?.data.rows ?? []).map((r, i) => (
                    <tr key={`${r.empId}-${i}`}><td>{r.empId ?? DASH}</td><td>{r.empName ?? r.analyst ?? DASH}</td><td>{r.tlName ?? DASH}</td>
                      <td>{r.amName ?? DASH}</td><td>{r.location ?? DASH}</td><td className="oc-right">{r.liveDays ?? DASH}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
