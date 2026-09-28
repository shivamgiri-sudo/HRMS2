import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Database, Loader2, Upload, PlugZap } from "lucide-react";
import type { KpiScorecardRow } from "./ProcessKpiDashboardPage";

/**
 * Process Data Sources — where a client supplies the figures HRMS cannot
 * measure itself (Prepaid %, Net Revenue, ROI, the email/reshipment TATs, PAN
 * Submission, GS1's three TATs).
 *
 * Two ways in, one destination: type or upload the numbers, or connect the
 * client's own database and map a metric to a column. Both land in
 * process_metric_actual and surface on the Process KPI Dashboard through the
 * same resolver as every other source.
 *
 * Only metrics the registry marks as client-supplied are offered. Every closed
 * set here is a dropdown, per the Form Input Rule: a free-text metric key or
 * aggregate would fork the key space silently and produce rows no dashboard
 * ever reads.
 */

interface ProcessOption { processCode: string; billingName: string; projectName: string }
interface ProcessHeader { processCode: string; processId: string; billingName: string }
interface ValueRow {
  metricKey: string;
  scoreDate: string;
  value: number | null;
  source: string;
  note: string | null;
}

const AGGREGATES = ["SUM", "AVG", "COUNT", "MAX", "MIN"] as const;

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstOfMonth = () => isoLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
interface ImportOutcome {
  row: number;
  metricKey: string;
  scoreDate: string;
  value: number | null;
  ok: boolean;
  message?: string;
  /** Present only on a dry run, and only where a figure already exists for that day. */
  replaces?: number | null;
}

interface ImportResult {
  imported: number;
  errors: Array<{ row: number; message: string }>;
  outcomes: ImportOutcome[];
  dryRun: boolean;
}

const todayIso = () => isoLocal(new Date());

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400";
const labelCls = "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";
const cardCls = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

export default function ProcessDataSourcePage() {
  const qc = useQueryClient();
  const [processCode, setProcessCode] = useState<string | null>(null);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayIso());
  const [drawerRow, setDrawerRow] = useState<ValueRow | null>(null);

  const { data: procData } = useQuery({
    queryKey: ["process-kpi-dashboard", "processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessOption[]>>("/api/process-kpi-dashboard/processes"),
  });
  const processes = procData?.data ?? [];
  const activeCode = processCode ?? processes[0]?.processCode ?? null;

  const { data: headerData } = useQuery({
    queryKey: ["process-kpi-dashboard", "header", activeCode],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessHeader>>(`/api/process-kpi-dashboard/${activeCode}/header`),
    enabled: !!activeCode,
  });
  const processId = headerData?.data?.processId ?? null;

  // Only the metrics that are actually client-supplied are offered. A metric
  // measured by an internal pipeline must not be hand-editable here -- that
  // would let a typed figure quietly overwrite a measured one.
  const { data: scoreData } = useQuery({
    queryKey: ["process-kpi-dashboard", "scorecards", activeCode, from, to],
    queryFn: () => hrmsApi.get<HrmsEnvelope<KpiScorecardRow[]>>(
      `/api/process-kpi-dashboard/${activeCode}/scorecards?from=${from}&to=${to}`,
    ),
    enabled: !!activeCode,
  });
  const suppliableMetrics = (scoreData?.data ?? []).filter(
    (m) => m.note?.includes("upload or database connection") || m.availability === "ok",
  );

  const valuesQuery = useQuery({
    queryKey: ["process-data-source", "values", processId, from, to],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ValueRow[]>>(
      `/api/process-data-source/${processId}/values?from=${from}&to=${to}`,
    ),
    enabled: !!processId,
  });
  const values = valuesQuery.data?.data ?? [];

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["process-data-source", "values", processId] });
    qc.invalidateQueries({ queryKey: ["process-kpi-dashboard", "scorecards", activeCode] });
  };

  const [entry, setEntry] = useState({ metricKey: "", scoreDate: todayIso(), value: "", note: "" });
  const saveValue = useMutation({
    mutationFn: () => hrmsApi.post(`/api/process-data-source/${processId}/values`, {
      metricKey: entry.metricKey,
      scoreDate: entry.scoreDate,
      value: entry.value.trim() === "" ? null : Number(entry.value),
      note: entry.note || null,
    }),
    onSuccess: () => {
      invalidateAll();
      setEntry((e) => ({ ...e, value: "", note: "" }));
    },
  });

  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportOutcome[] | null>(null);

  /**
   * metricKey,date,value[,note] per line — the same four columns the single
   * entry form collects, so one mental model covers both.
   *
   * A leading header row is dropped rather than reported as a broken row:
   * every spreadsheet export has one, and rejecting it teaches people the
   * upload is unreliable.
   */
  const parseRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const body = lines.length && /^metric[_ ]?key\s*,/i.test(lines[0]) ? lines.slice(1) : lines;
    return body.map((line) => {
      const [metricKey, scoreDate, value, ...note] = line.split(",").map((c) => c.trim());
      return { metricKey, scoreDate, value, note: note.join(",") || undefined };
    });
  };

  const runImport = (dryRun: boolean) =>
    hrmsApi.post<HrmsEnvelope<ImportResult>>(`/api/process-data-source/${processId}/import`, {
      rows: parseRows(pasted),
      dry_run: dryRun,
    });

  // Checked before it writes, against the same registry and date rules the write
  // uses. Pasting a month and discovering afterwards that half the rows were
  // rejected leaves the dashboard a blend of new and stale figures that still
  // looks complete.
  const checkRows = useMutation({
    mutationFn: () => runImport(true),
    onSuccess: (res) => setPreview(res.data.outcomes),
  });

  const importRows = useMutation({
    mutationFn: () => runImport(false),
    onSuccess: (res) => {
      setPreview(res.data.outcomes);
      invalidateAll();
    },
  });

  /** Reads a .csv/.txt in the browser; nothing is uploaded until Check is run. */
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPasted(String(reader.result ?? ""));
      setFileName(file.name);
      setPreview(null);
    };
    reader.readAsText(file);
  };

  const readyCount = preview?.filter((o) => o.ok).length ?? 0;
  const blockedCount = preview?.filter((o) => !o.ok).length ?? 0;

  const [conn, setConn] = useState({
    integration_name: "", host: "", port: "3306", database: "",
    username: "", password: "", db_type: "mysql",
  });
  const [connKey, setConnKey] = useState("");
  const createConnector = useMutation({
    mutationFn: () => hrmsApi.post<HrmsEnvelope<{ integration_key: string }>>("/api/external-db", {
      ...conn, port: Number(conn.port), process_id: processId, tables: [],
    }),
    onSuccess: (res) => setConnKey(res.data.integration_key),
  });
  const testConnector = useMutation({
    mutationFn: () => hrmsApi.post<HrmsEnvelope<{ ok: boolean; error?: string }>>(
      `/api/external-db/${connKey}/test`, {}),
  });

  const [mapping, setMapping] = useState({
    metricKey: "", table: "", valueColumn: "", aggregate: "SUM", dateColumn: "",
  });
  const refresh = useMutation({
    mutationFn: () => hrmsApi.post<HrmsEnvelope<{ written: number }>>(
      `/api/process-data-source/${processId}/connector-refresh`,
      { connectorKey: connKey, ...mapping, from, to },
    ),
    onSuccess: invalidateAll,
  });

  const metricOptions = suppliableMetrics.map((m) => (
    <option key={m.metricKey} value={m.metricKey}>{m.lobLabel} — {m.label}</option>
  ));

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header className="flex items-start gap-3">
          <Database className="mt-1 h-6 w-6 text-slate-500" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Process Data Sources</h1>
            <p className="text-sm text-slate-600">
              Supply the figures HRMS cannot measure itself — enter them, paste them in, or connect
              this client's own database. Anything supplied here appears on the Process KPI Dashboard.
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className={labelCls}>Process</label>
            <select className={inputCls} value={activeCode ?? ""} onChange={(e) => setProcessCode(e.target.value)}>
              {processes.map((p) => (
                <option key={p.processCode} value={p.processCode}>{p.billingName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>From</label>
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <section className={cardCls}>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Supplied values</h2>
          {valuesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : values.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing supplied for this window yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 text-left">Metric</th>
                  <th className="text-left">Date</th>
                  <th className="text-right">Value</th>
                  <th className="pl-4 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {values.map((r) => (
                  <tr
                    key={`${r.metricKey}-${r.scoreDate}`}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => setDrawerRow(r)}
                  >
                    <td className="py-2">{r.metricKey}</td>
                    <td>{r.scoreDate}</td>
                    <td className="text-right tabular-nums">{r.value ?? "—"}</td>
                    <td className="pl-4">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                        {r.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={cardCls}>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Add a value</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <label className={labelCls}>Metric</label>
              <select className={inputCls} value={entry.metricKey}
                      onChange={(e) => setEntry((s) => ({ ...s, metricKey: e.target.value }))}>
                <option value="">Select a metric…</option>
                {metricOptions}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" className={inputCls} value={entry.scoreDate}
                     onChange={(e) => setEntry((s) => ({ ...s, scoreDate: e.target.value }))} />
            </div>
            <div className="w-36">
              <label className={labelCls}>Value</label>
              <input type="number" className={inputCls} value={entry.value} placeholder="blank = no reading"
                     onChange={(e) => setEntry((s) => ({ ...s, value: e.target.value }))} />
            </div>
            <div className="min-w-48 flex-1">
              <label className={labelCls}>Note</label>
              <input className={inputCls} value={entry.note}
                     onChange={(e) => setEntry((s) => ({ ...s, note: e.target.value }))} />
            </div>
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!entry.metricKey || !processId || saveValue.isPending}
              onClick={() => saveValue.mutate()}
            >
              {saveValue.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Leaving the value blank records “no reading” for that day, which is different from a measured zero.
          </p>
          {saveValue.isError && (
            <p className="mt-2 text-sm text-rose-600">{(saveValue.error as Error).message}</p>
          )}
        </section>

        <section className={cardCls}>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Upload className="h-4 w-4" /> Upload a month at once
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Choose a CSV or paste rows: <code>metricKey,YYYY-MM-DD,value,note</code>, one per line. A
            header row is ignored. Nothing is saved until you have seen what it will do.
          </p>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
              Choose file
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
          </div>

          <textarea
            className={`${inputCls} h-28 font-mono text-xs`}
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); setPreview(null); }}
            placeholder={"gs1_email_tat_sec,2026-08-01,3200\ngs1_email_tat_sec,2026-08-02,2980"}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              disabled={!pasted.trim() || !processId || checkRows.isPending}
              onClick={() => checkRows.mutate()}
            >
              {checkRows.isPending ? "Checking…" : "Check rows"}
            </button>
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!preview || readyCount === 0 || importRows.isPending}
              onClick={() => importRows.mutate()}
            >
              {importRows.isPending
                ? "Importing…"
                : preview
                  ? `Import ${readyCount} row${readyCount === 1 ? "" : "s"}`
                  : "Import rows"}
            </button>
            {preview && blockedCount > 0 && (
              <span className="text-xs text-rose-600">
                {blockedCount} row{blockedCount === 1 ? "" : "s"} will be skipped
              </span>
            )}
          </div>

          {(checkRows.isError || importRows.isError) && (
            <p className="mt-2 text-sm text-rose-600">
              {((checkRows.error ?? importRows.error) as Error).message}
            </p>
          )}

          {importRows.data && !importRows.data.data.dryRun && (
            <p className="mt-2 text-sm text-emerald-700">
              Imported {importRows.data.data.imported} row(s).
            </p>
          )}

          {preview && preview.length > 0 && (
            <div className="mt-3 max-h-64 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    <th className="px-2 py-1.5 font-medium">Metric</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Value</th>
                    <th className="px-2 py-1.5 font-medium">What will happen</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((o) => (
                    <tr key={`${o.row}-${o.metricKey}-${o.scoreDate}`} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-400">{o.row}</td>
                      <td className="px-2 py-1.5 font-mono">{o.metricKey || "—"}</td>
                      <td className="px-2 py-1.5 font-mono">{o.scoreDate || "—"}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {o.value === null ? <span className="text-slate-400">no reading</span> : o.value}
                      </td>
                      <td className="px-2 py-1.5">
                        {!o.ok ? (
                          <span className="text-rose-600">{o.message}</span>
                        ) : o.replaces !== undefined ? (
                          <span className="text-amber-700">
                            replaces {o.replaces === null ? "no reading" : o.replaces}
                          </span>
                        ) : (
                          <span className="text-emerald-700">new</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={cardCls}>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <PlugZap className="h-4 w-4" /> Connect this client's database
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Read-only. Credentials are encrypted at rest and never returned to this screen.
            MySQL only for now — a SQL Server connector will be refused with a message rather than fail obscurely.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {([
              ["integration_name", "Name", "text"], ["host", "Host", "text"], ["port", "Port", "number"],
              ["database", "Database", "text"], ["username", "Username", "text"], ["password", "Password", "password"],
            ] as const).map(([field, label, type]) => (
              <div key={field}>
                <label className={labelCls}>{label}</label>
                <input type={type} className={inputCls} value={conn[field]}
                       onChange={(e) => setConn((c) => ({ ...c, [field]: e.target.value }))} />
              </div>
            ))}
            <div>
              <label className={labelCls}>Type</label>
              <select className={inputCls} value={conn.db_type}
                      onChange={(e) => setConn((c) => ({ ...c, db_type: e.target.value }))}>
                <option value="mysql">MySQL</option>
                <option value="mssql">SQL Server</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
                    disabled={!processId || createConnector.isPending}
                    onClick={() => createConnector.mutate()}>
              {createConnector.isPending ? "Saving…" : "Save connection"}
            </button>
            <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
                    disabled={!connKey || testConnector.isPending}
                    onClick={() => testConnector.mutate()}>
              {testConnector.isPending ? "Testing…" : "Test connection"}
            </button>
            {connKey && <span className="text-xs text-slate-500">Connector: {connKey}</span>}
            {testConnector.data && (
              <span className={testConnector.data.data.ok ? "text-sm text-emerald-700" : "text-sm text-rose-600"}>
                {testConnector.data.data.ok ? "Connected." : testConnector.data.data.error}
              </span>
            )}
          </div>

          <h3 className="mt-5 mb-2 text-sm font-semibold text-slate-800">Map a metric to a column</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label className={labelCls}>Metric</label>
              <select className={inputCls} value={mapping.metricKey}
                      onChange={(e) => setMapping((m) => ({ ...m, metricKey: e.target.value }))}>
                <option value="">Select a metric…</option>
                {metricOptions}
              </select>
            </div>
            {([["table", "Table"], ["valueColumn", "Value column"], ["dateColumn", "Date column"]] as const)
              .map(([field, label]) => (
                <div key={field} className="w-40">
                  <label className={labelCls}>{label}</label>
                  <input className={inputCls} value={mapping[field]}
                         onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))} />
                </div>
              ))}
            <div className="w-32">
              <label className={labelCls}>Aggregate</label>
              <select className={inputCls} value={mapping.aggregate}
                      onChange={(e) => setMapping((m) => ({ ...m, aggregate: e.target.value }))}>
                {AGGREGATES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={!connKey || !mapping.metricKey || refresh.isPending}
                    onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
          {refresh.isError && <p className="mt-2 text-sm text-rose-600">{(refresh.error as Error).message}</p>}
          {refresh.data && (
            <p className="mt-2 text-sm text-emerald-700">Pulled {refresh.data.data.written} day(s) of values.</p>
          )}
        </section>
      </div>

      {drawerRow && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDrawerRow(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{drawerRow.metricKey}</h3>
                <p className="text-sm text-slate-500">{drawerRow.scoreDate}</p>
              </div>
              <button className="text-sm text-slate-500" onClick={() => setDrawerRow(null)}>Close</button>
            </div>
            <dl className="space-y-3 text-sm">
              {([
                ["Metric", drawerRow.metricKey],
                ["Date", drawerRow.scoreDate],
                ["Value", drawerRow.value === null ? "— (no reading recorded)" : String(drawerRow.value)],
                ["Source", drawerRow.source],
                ["Note", drawerRow.note ?? "None"],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
