import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCanEditWfmInputs } from "./OnfidoManpowerPlanSheet";
import { parseUtilizationCsv, type ImportRow } from "./onfidoUtilizationCsv";
import { DASH, EmptyNote, SectionCard, fmtDate, fmtDateTime, fmtInt, fmtNum, fmtPct, fmtRatioPct } from "./onfidoReportShared";

/**
 * Utilization tab ("Utilization Format.xlsx"): one row per day with the sheet's columns,
 * order and formulas, plus an MTD row. Actual Task, POA Live, AHT, POA AHT, GD/MCN/SLA/APS and
 * Escalated Task come from the uploaded Onfido reports; Forecasted Task, Forecasted Task POA,
 * Manual FAR Case, Adhoc Time, Analyst QC, Facial checks, Cross training task POA and POA Live
 * Audits / POA PQ Audits are entered by WFM (row drawer, or CSV import). Any formula whose
 * inputs are missing shows "-".
 */

interface Inputs {
  forecastTask: number | null; forecastTaskPoa: number | null; actualTask: number | null; manualFarCases: number | null;
  poaLive: number | null; adhocTime: number | null; analystQc: number | null; facialChecks: number | null;
  crossTrainingTaskPoa: number | null; poaLiveAuditsPq: number | null; escalatedTask: number | null;
}
interface Derived {
  utilizationForecast: number | null; utilizationWithAdhoc: number | null; utilizationWithoutAdhoc: number | null;
  utilizationWithAdhocPct: number | null; utilizationWithoutAdhocPct: number | null; poaAnsweringPct: number | null; escalatedPct: number | null;
}
interface Day {
  date: string; month: string; wc: string; inputs: Inputs; derived: Derived; aht: number | null; poaAht: number | null;
  gdRatio: number | null; mcnRatio: number | null; slaRatio: number | null; apsRatio: number | null;
  hasManualInputs: boolean; remarks: string | null; inputsUpdatedBy: string | null; inputsUpdatedAt: string | null;
}
interface Mtd { inputs: Inputs; derived: Derived; aht: number | null; poaAht: number | null; gdRatio: number | null; mcnRatio: number | null; slaRatio: number | null; apsRatio: number | null }
interface Report { from: string; to: string; days: Day[]; throughDate: string | null; mtd: Mtd }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_BACK = 12;

/** Closed set of months (this month and the previous 11) as { value: "2026-07", label: "Jul-26" }. */
function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: d.toISOString().slice(0, 7), label: `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}` };
  });
}

function monthBounds(ym: string): DateRangeLocal {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
interface DateRangeLocal { from: string; to: string }

const dec = (v: number | null) => (v === null ? DASH : fmtNum(v, 1));

function Cells({ i, d, aht, poaAht, gd, mcn, sla, aps }: { i: Inputs; d: Derived; aht: number | null; poaAht: number | null; gd: number | null; mcn: number | null; sla: number | null; aps: number | null }) {
  return (
    <>
      <td className="oc-right">{dec(i.forecastTask)}</td><td className="oc-right">{dec(i.forecastTaskPoa)}</td><td className="oc-right">{dec(d.utilizationForecast)}</td>
      <td className="oc-right">{fmtInt(i.actualTask)}</td><td className="oc-right">{fmtInt(i.manualFarCases)}</td><td className="oc-right">{fmtInt(i.poaLive)}</td>
      <td className="oc-right">{dec(i.adhocTime)}</td><td className="oc-right">{fmtInt(i.analystQc)}</td><td className="oc-right">{fmtInt(i.facialChecks)}</td>
      <td className="oc-right">{fmtInt(i.crossTrainingTaskPoa)}</td><td className="oc-right">{fmtInt(i.poaLiveAuditsPq)}</td>
      <td className="oc-right">{dec(aht)}</td><td className="oc-right">{dec(poaAht)}</td>
      <td className="oc-right">{fmtRatioPct(gd)}</td><td className="oc-right">{fmtRatioPct(mcn)}</td><td className="oc-right">{fmtRatioPct(sla)}</td><td className="oc-right">{fmtRatioPct(aps)}</td>
      <td className="oc-right">{dec(d.utilizationWithAdhoc)}</td><td className="oc-right">{dec(d.utilizationWithoutAdhoc)}</td>
      <td className="oc-right">{fmtPct(d.utilizationWithAdhocPct)}</td><td className="oc-right">{fmtPct(d.utilizationWithoutAdhocPct)}</td>
      <td className="oc-right">{fmtPct(d.poaAnsweringPct)}</td><td className="oc-right">{fmtInt(i.escalatedTask)}</td><td className="oc-right">{fmtPct(d.escalatedPct, 2)}</td>
    </>
  );
}

const HEADERS = [
  "Forecasted Task", "Forecasted Task POA", "Utilization Forecast", "Actual Task", "Manual FAR Case", "POA Live", "Adhoc Time", "Analyst QC",
  "Facial checks", "Cross training task POA", "POA Live Audits / POA PQ Audits", "AHT", "POA AHT", "GD%", "MCN%", "SLA", "APS",
  "Utilization with Adhoc", "Utilization without Adhoc", "Utilization with Adhoc %", "Utilization without Adhoc %", "POA Answering", "Escalated Task", "Escalated %",
];

export default function OnfidoUtilizationReport() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [selected, setSelected] = useState<string | null>(null);
  const canEdit = useCanEditWfmInputs();
  const range = monthBounds(month);
  const report = useQuery({
    queryKey: ["onfido-process", "utilization-report", range],
    queryFn: () => hrmsApi.get<{ data: Report }>(`/api/onfido-process/utilization-report?from=${range.from}&to=${range.to}`),
  });
  const data = report.data?.data;
  const day = data?.days.find((d) => d.date === selected) ?? null;

  return (
    <SectionCard
      title="Utilization" accent="var(--green)"
      subtitle="Actual Task, POA Live, AHT, GD%, MCN%, SLA, APS and Escalated Task come from the uploaded reports. The other inputs are entered by WFM; a formula with a missing input shows -."
      right={
        <div className="flex items-end gap-3">
          <div className="oc-field">
            <label htmlFor="ut-month">Month</label>
            <select id="ut-month" className="oc-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {canEdit && <ImportInputs onSaved={() => report.refetch()} />}
        </div>
      }
    >
      {report.isLoading && <EmptyNote>Loading...</EmptyNote>}
      {report.error instanceof Error && <EmptyNote>Could not load utilization: {report.error.message}</EmptyNote>}
      {data && (
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table className="oc-table">
            <thead>
              <tr><th>Date</th><th>Month</th><th>WC</th>{HEADERS.map((h) => <th key={h} className="oc-right">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.date} className="oc-row-click" onClick={() => setSelected(d.date)}>
                  <td>{fmtDate(d.date)}</td><td>{d.month}</td><td>{fmtDate(d.wc)}</td>
                  <Cells i={d.inputs} d={d.derived} aht={d.aht} poaAht={d.poaAht} gd={d.gdRatio} mcn={d.mcnRatio} sla={d.slaRatio} aps={d.apsRatio} />
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>MTD</td><td>{data.days[0]?.month ?? DASH}</td><td>MTD</td>
                <Cells i={data.mtd.inputs} d={data.mtd.derived} aht={data.mtd.aht} poaAht={data.mtd.poaAht} gd={data.mtd.gdRatio} mcn={data.mtd.mcnRatio} sla={data.mtd.slaRatio} aps={data.mtd.apsRatio} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="oc-card-sub" style={{ marginTop: 8 }}>
          MTD covers {fmtDate(data.from)} to {data.throughDate ? fmtDate(data.throughDate) : DASH} (the last day with data). A total is shown only when every day it covers has that input.
        </div>
      )}
      <UtilizationDrawer day={day} canEdit={canEdit} onClose={() => setSelected(null)} onSaved={() => report.refetch()} />
    </SectionCard>
  );
}

// ── Row drawer: full record + WFM input form ─────────────────────────────────

type FormKey = "forecastTask" | "forecastTaskPoa" | "manualFarCases" | "adhocTime" | "analystQc" | "facialChecks" | "crossTrainingTaskPoa" | "poaLiveAuditsPq";
const FORM_FIELDS: { key: FormKey; label: string; step: string }[] = [
  { key: "forecastTask", label: "Forecasted Task", step: "any" }, { key: "forecastTaskPoa", label: "Forecasted Task POA", step: "any" },
  { key: "manualFarCases", label: "Manual FAR Case", step: "1" }, { key: "adhocTime", label: "Adhoc Time", step: "any" },
  { key: "analystQc", label: "Analyst QC", step: "1" }, { key: "facialChecks", label: "Facial checks", step: "1" },
  { key: "crossTrainingTaskPoa", label: "Cross training task POA", step: "1" }, { key: "poaLiveAuditsPq", label: "POA Live Audits / POA PQ Audits", step: "1" },
];

function UtilizationDrawer({ day, canEdit, onClose, onSaved }: { day: Day | null; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={day !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="!text-[color:var(--text)]">Utilization · {day ? fmtDate(day.date) : ""}</SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">{day ? `${day.month} · week commencing ${fmtDate(day.wc)}` : ""}</SheetDescription>
        </SheetHeader>
        {day && <DrawerBody key={day.date} day={day} canEdit={canEdit} onSaved={onSaved} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ day, canEdit, onSaved }: { day: Day; canEdit: boolean; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<FormKey, string>>(() => Object.fromEntries(
    FORM_FIELDS.map((f) => [f.key, day.inputs[f.key] === null ? "" : String(day.inputs[f.key])]),
  ) as Record<FormKey, string>);
  const [remarks, setRemarks] = useState(day.remarks ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => hrmsApi.put("/api/onfido-process/wfm-inputs/utilization", { rows: [{ inputDate: day.date, ...form, remarks }] }),
    onSuccess: async () => { setMessage({ tone: "ok", text: "Saved." }); await qc.invalidateQueries({ queryKey: ["onfido-process"] }); onSaved(); },
    onError: (e: unknown) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not save." }),
  });
  const i = day.inputs; const d = day.derived;
  return (
    <div className="mt-4 space-y-5">
      <div>
        <div className="oc-kv-label">From the uploaded reports</div>
        <table className="oc-table"><tbody>
          <tr><td>Actual Task (DOC tasks)</td><td className="oc-right">{fmtInt(i.actualTask)}</td></tr>
          <tr><td>POA Live (POA tasks)</td><td className="oc-right">{fmtInt(i.poaLive)}</td></tr>
          <tr><td>AHT / POA AHT (sec)</td><td className="oc-right">{dec(day.aht)} / {dec(day.poaAht)}</td></tr>
          <tr><td>GD% / MCN% / SLA / APS</td><td className="oc-right">{fmtRatioPct(day.gdRatio)} / {fmtRatioPct(day.mcnRatio)} / {fmtRatioPct(day.slaRatio)} / {fmtRatioPct(day.apsRatio)}</td></tr>
          <tr><td>Escalated Task (DOC tasks flagged escalated)</td><td className="oc-right">{fmtInt(i.escalatedTask)}</td></tr>
        </tbody></table>
      </div>
      <div>
        <div className="oc-kv-label">Calculated (sheet formulas)</div>
        <table className="oc-table"><tbody>
          <tr><td>Utilization Forecast = D + E x (220/75)</td><td className="oc-right">{dec(d.utilizationForecast)}</td></tr>
          <tr><td>Utilization with Adhoc = G + H + I x (220/75) + J + K x 1.2 + M x (220/75) + N x (220/75)</td><td className="oc-right">{dec(d.utilizationWithAdhoc)}</td></tr>
          <tr><td>Utilization without Adhoc = G + I x (220/75)</td><td className="oc-right">{dec(d.utilizationWithoutAdhoc)}</td></tr>
          <tr><td>Utilization with Adhoc % = U / F</td><td className="oc-right">{fmtPct(d.utilizationWithAdhocPct)}</td></tr>
          <tr><td>Utilization without Adhoc % = V / F</td><td className="oc-right">{fmtPct(d.utilizationWithoutAdhocPct)}</td></tr>
          <tr><td>POA Answering = I / E</td><td className="oc-right">{fmtPct(d.poaAnsweringPct)}</td></tr>
          <tr><td>Escalated % = Z / G</td><td className="oc-right">{fmtPct(d.escalatedPct, 2)}</td></tr>
        </tbody></table>
      </div>
      <div>
        <div className="oc-kv-label">Entered by WFM</div>
        {day.hasManualInputs
          ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Last saved {fmtDateTime(day.inputsUpdatedAt)}{day.inputsUpdatedBy ? ` by ${day.inputsUpdatedBy}` : ""}</div>
          : <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing entered for this day yet.</div>}
        {canEdit ? (
          <form className="mt-3 grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); setMessage(null); save.mutate(); }}>
            {FORM_FIELDS.map((f) => (
              <div className="oc-field" key={f.key}>
                <label htmlFor={`ut-${f.key}`}>{f.label}</label>
                <input id={`ut-${f.key}`} type="number" min={0} step={f.step} className="oc-input" value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div className="oc-field col-span-2">
              <label htmlFor="ut-remarks">Remarks</label>
              <input id="ut-remarks" type="text" maxLength={255} className="oc-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <button type="submit" className="oc-pill-btn active" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</button>
              {message && <span role="status" style={{ fontSize: 12, color: message.tone === "ok" ? "var(--green)" : "var(--red)" }}>{message.text}</span>}
            </div>
          </form>
        ) : (
          <table className="oc-table mt-2"><tbody>
            {FORM_FIELDS.map((f) => <tr key={f.key}><td>{f.label}</td><td className="oc-right">{dec(i[f.key])}</td></tr>)}
            <tr><td>Remarks</td><td className="oc-right">{day.remarks ?? DASH}</td></tr>
          </tbody></table>
        )}
      </div>
    </div>
  );
}

// ── CSV import ───────────────────────────────────────────────────────────────

function ImportInputs({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ rows: ImportRow[]; errors: string[]; name: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const save = useMutation({
    mutationFn: (rows: ImportRow[]) => hrmsApi.put<{ data: { saved: number } }>("/api/onfido-process/wfm-inputs/utilization", { rows }),
    onSuccess: async (res) => {
      setMessage({ tone: "ok", text: `Saved ${res.data.saved} day(s).` });
      setPending(null);
      await qc.invalidateQueries({ queryKey: ["onfido-process"] });
      onSaved();
    },
    onError: (e: unknown) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not import." }),
  });
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    const parsed = parseUtilizationCsv(await file.text());
    setPending({ ...parsed, name: file.name });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} aria-label="Import utilization inputs from CSV" />
      {!pending && <button type="button" className="oc-btn-ghost" onClick={() => fileRef.current?.click()}>Import inputs (CSV)</button>}
      {pending && (
        <div style={{ fontSize: 12, maxWidth: 360, textAlign: "right" }}>
          <div>{pending.name}: {pending.rows.length} day(s) ready{pending.errors.length > 0 ? `, ${pending.errors.length} problem(s)` : ""}</div>
          {pending.errors.slice(0, 3).map((er) => <div key={er} style={{ color: "var(--red)" }}>{er}</div>)}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" className="oc-pill-btn" onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className="oc-pill-btn active" disabled={pending.rows.length === 0 || pending.errors.length > 0 || save.isPending} onClick={() => save.mutate(pending.rows)}>
              {save.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
      {message && <span role="status" style={{ fontSize: 12, color: message.tone === "ok" ? "var(--green)" : "var(--red)" }}>{message.text}</span>}
    </div>
  );
}
