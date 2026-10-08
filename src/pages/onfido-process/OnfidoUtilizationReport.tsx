import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useWfmInputsAccess } from "./OnfidoManpowerPlanSheet";
import { UTILIZATION_COLUMNS, parseUtilizationCsv, utilizationTemplateCsv, type ImportRow } from "./onfidoUtilizationCsv";
import { DASH, EmptyNote, SectionCard, fmtDate, fmtDateTime, fmtInt, fmtNum, fmtRatioPct } from "./onfidoReportShared";

/**
 * Utilization tab ("Utilization Format.xlsx"): one row per day, columns from UTILIZATION_COLUMNS.
 * Import-driven: every WFM / calculated column shows the value that was uploaded, exactly as
 * stored, or blank. Nothing here calculates, defaults or totals. Actual Task, POA Live, AHT,
 * POA AHT, GD/MCN/SLA/APS and Escalated Task are read from the uploaded Onfido reports.
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
interface Report { from: string; to: string; days: Day[]; throughDate: string | null }

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

/** An uploaded value exactly as stored (no rounding, no padding); blank when nothing was uploaded. */
const stored = (v: number | null, suffix = "") => (v === null ? "" : `${v}${suffix}`);

function cellFor(col: (typeof UTILIZATION_COLUMNS)[number], d: Day): string {
  if ("source" in col) {
    switch (col.source) {
      case "month": return d.month;
      case "wc": return fmtDate(d.wc);
      case "actualTask": return fmtInt(d.inputs.actualTask);
      case "poaLive": return fmtInt(d.inputs.poaLive);
      case "aht": return d.aht === null ? DASH : fmtNum(d.aht, 1);
      case "poaAht": return d.poaAht === null ? DASH : fmtNum(d.poaAht, 1);
      case "gd": return fmtRatioPct(d.gdRatio);
      case "mcn": return fmtRatioPct(d.mcnRatio);
      case "sla": return fmtRatioPct(d.slaRatio);
      case "aps": return fmtRatioPct(d.apsRatio);
      case "escalatedTask": return fmtInt(d.inputs.escalatedTask);
    }
  }
  const pct = col.kind === "pct" ? "%" : "";
  switch (col.field) {
    case "inputDate": return fmtDate(d.date);
    case "forecastTask": return stored(d.inputs.forecastTask);
    case "forecastTaskPoa": return stored(d.inputs.forecastTaskPoa);
    case "manualFarCases": return stored(d.inputs.manualFarCases);
    case "adhocTime": return stored(d.inputs.adhocTime);
    case "analystQc": return stored(d.inputs.analystQc);
    case "facialChecks": return stored(d.inputs.facialChecks);
    case "crossTrainingTaskPoa": return stored(d.inputs.crossTrainingTaskPoa);
    case "poaLiveAuditsPq": return stored(d.inputs.poaLiveAuditsPq);
    case "fixedUtilizationForecast": return stored(d.derived.utilizationForecast);
    case "fixedUtilizationWithAdhoc": return stored(d.derived.utilizationWithAdhoc);
    case "fixedUtilizationWithoutAdhoc": return stored(d.derived.utilizationWithoutAdhoc);
    case "fixedUtilizationWithAdhocPct": return stored(d.derived.utilizationWithAdhocPct, pct);
    case "fixedUtilizationWithoutAdhocPct": return stored(d.derived.utilizationWithoutAdhocPct, pct);
    case "fixedPoaAnsweringPct": return stored(d.derived.poaAnsweringPct, pct);
    case "fixedEscalatedPct": return stored(d.derived.escalatedPct, pct);
    case "remarks": return d.remarks ?? "";
    default: return "";
  }
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([utilizationTemplateCsv()], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "utilization_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function OnfidoUtilizationReport() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [selected, setSelected] = useState<string | null>(null);
  const { canEdit, isChecking: isCheckingCanEdit, isError: canEditCheckFailed } = useWfmInputsAccess();
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
      subtitle="Every column is shown exactly as uploaded by WFM (Bulk upload); nothing is calculated here and a column with no uploaded value stays blank. Actual Task, POA Live, AHT, GD%, MCN%, SLA, APS and Escalated Task come from the uploaded reports."
      right={
        <div className="flex items-end gap-3">
          <div className="oc-field">
            <label htmlFor="ut-month">Month</label>
            <select id="ut-month" className="oc-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <button type="button" className="oc-btn-ghost" onClick={downloadTemplate}>Download template</button>
          <ImportInputs disabled={!canEdit} onSaved={() => report.refetch()} />
          {!canEdit && !isCheckingCanEdit && (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {canEditCheckFailed
                ? "Could not check bulk-upload permission."
                : "Your role can't bulk-upload utilization inputs."}
            </span>
          )}
        </div>
      }
    >
      {report.isLoading && <EmptyNote>Loading...</EmptyNote>}
      {report.error instanceof Error && <EmptyNote>Could not load utilization: {report.error.message}</EmptyNote>}
      {data && (
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table className="oc-table">
            <thead>
              <tr>{UTILIZATION_COLUMNS.map((c) => <th key={c.header} className={c.header === "Date" || c.header === "Month" || c.header === "WC" || c.header === "Remarks" ? undefined : "oc-right"}>{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.date} className="oc-row-click" onClick={() => setSelected(d.date)}>
                  {UTILIZATION_COLUMNS.map((c) => <td key={c.header} className={c.header === "Date" || c.header === "Month" || c.header === "WC" || c.header === "Remarks" ? undefined : "oc-right"}>{cellFor(c, d)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UtilizationDrawer day={day} canEdit={canEdit} onClose={() => setSelected(null)} onSaved={() => report.refetch()} />
    </SectionCard>
  );
}

// ── Row drawer: full record + WFM input form ─────────────────────────────────

type FormKey = Exclude<keyof ImportRow, "inputDate" | "remarks">;
const FORM_FIELDS: { key: FormKey; label: string }[] = UTILIZATION_COLUMNS.flatMap((c) =>
  "field" in c && c.kind !== "date" && c.kind !== "text" ? [{ key: c.field as FormKey, label: c.header }] : []);

/** The stored value of one editable field, as text ("" when nothing was uploaded). */
function storedField(d: Day, k: FormKey): string {
  const v: Record<FormKey, number | null> = {
    forecastTask: d.inputs.forecastTask, forecastTaskPoa: d.inputs.forecastTaskPoa, manualFarCases: d.inputs.manualFarCases,
    adhocTime: d.inputs.adhocTime, analystQc: d.inputs.analystQc, facialChecks: d.inputs.facialChecks,
    crossTrainingTaskPoa: d.inputs.crossTrainingTaskPoa, poaLiveAuditsPq: d.inputs.poaLiveAuditsPq,
    fixedUtilizationForecast: d.derived.utilizationForecast, fixedUtilizationWithAdhoc: d.derived.utilizationWithAdhoc,
    fixedUtilizationWithoutAdhoc: d.derived.utilizationWithoutAdhoc, fixedUtilizationWithAdhocPct: d.derived.utilizationWithAdhocPct,
    fixedUtilizationWithoutAdhocPct: d.derived.utilizationWithoutAdhocPct, fixedPoaAnsweringPct: d.derived.poaAnsweringPct,
    fixedEscalatedPct: d.derived.escalatedPct,
  };
  return stored(v[k]);
}

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
    FORM_FIELDS.map((f) => [f.key, storedField(day, f.key)]),
  ) as Record<FormKey, string>);
  const [remarks, setRemarks] = useState(day.remarks ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => hrmsApi.put("/api/onfido-process/wfm-inputs/utilization", { rows: [{ inputDate: day.date, ...form, remarks }] }),
    onSuccess: async () => { setMessage({ tone: "ok", text: "Saved." }); await qc.invalidateQueries({ queryKey: ["onfido-process"] }); onSaved(); },
    onError: (e: unknown) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not save." }),
  });
  const i = day.inputs;
  return (
    <div className="mt-4 space-y-5">
      <div>
        <div className="oc-kv-label">From the uploaded reports</div>
        <table className="oc-table"><tbody>
          <tr><td>Actual Task (DOC tasks)</td><td className="oc-right">{fmtInt(i.actualTask)}</td></tr>
          <tr><td>POA Live (POA tasks)</td><td className="oc-right">{fmtInt(i.poaLive)}</td></tr>
          <tr><td>AHT / POA AHT (sec)</td><td className="oc-right">{day.aht === null ? DASH : fmtNum(day.aht, 1)} / {day.poaAht === null ? DASH : fmtNum(day.poaAht, 1)}</td></tr>
          <tr><td>GD% / MCN% / SLA / APS</td><td className="oc-right">{fmtRatioPct(day.gdRatio)} / {fmtRatioPct(day.mcnRatio)} / {fmtRatioPct(day.slaRatio)} / {fmtRatioPct(day.apsRatio)}</td></tr>
          <tr><td>Escalated Task (DOC tasks flagged escalated)</td><td className="oc-right">{fmtInt(i.escalatedTask)}</td></tr>
        </tbody></table>
      </div>
      <div>
        <div className="oc-kv-label">Uploaded values (saved exactly as provided)</div>
        {day.hasManualInputs
          ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Last saved {fmtDateTime(day.inputsUpdatedAt)}{day.inputsUpdatedBy ? ` by ${day.inputsUpdatedBy}` : ""}</div>
          : <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing entered for this day yet.</div>}
        {canEdit ? (
          <form className="mt-3 grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); setMessage(null); save.mutate(); }}>
            {FORM_FIELDS.map((f) => (
              <div className="oc-field" key={f.key}>
                <label htmlFor={`ut-${f.key}`}>{f.label}</label>
                <input id={`ut-${f.key}`} type="text" inputMode="decimal" className="oc-input" value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
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
            {FORM_FIELDS.map((f) => <tr key={f.key}><td>{f.label}</td><td className="oc-right">{storedField(day, f.key)}</td></tr>)}
            <tr><td>Remarks</td><td className="oc-right">{day.remarks ?? DASH}</td></tr>
          </tbody></table>
        )}
      </div>
    </div>
  );
}

// ── CSV import ───────────────────────────────────────────────────────────────

function ImportInputs({ onSaved, disabled }: { onSaved: () => void; disabled: boolean }) {
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
      {!pending && <button type="button" className="oc-btn-ghost" disabled={disabled} title={disabled ? "Needs an admin, COO, WFM or process manager role" : undefined} onClick={() => fileRef.current?.click()}>Bulk upload (CSV)</button>}
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
