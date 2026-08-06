import { useState, useEffect, useCallback } from "react";
import { Download, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import * as XLSX from "xlsx";

interface BmiMonthCell {
  value: number | null;
  source: "auto" | "manual" | "unavailable";
  tooltip?: string;
}
interface BmiMetricRow {
  key: string;
  label: string;
  section: string;
  format: "number" | "currency" | "days" | "percent" | "hours";
  editable: boolean;
  cells: Record<string, BmiMonthCell>;
  total: number | null;
}
interface BmiData {
  months: string[];
  funnel: BmiMetricRow[];
  costs: BmiMetricRow[];
  quality: BmiMetricRow[];
  speed: BmiMetricRow[];
}

type SheetKey = "funnel" | "costs" | "quality" | "speed";
const SHEET_LABELS: Record<SheetKey, string> = {
  funnel: "1 — Funnel",
  costs: "2 — Costs",
  quality: "3 — Quality",
  speed: "4 — Speed",
};

function fmtMonth(m: string) {
  const [y, mo] = m.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mo) - 1]}-${y.slice(2)}`;
}

function fmtValue(v: number | null, format: BmiMetricRow["format"]) {
  if (v === null) return "—";
  switch (format) {
    case "currency": return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    case "percent":  return `${v.toFixed(1)}%`;
    case "days":     return `${v.toFixed(1)} d`;
    case "hours":    return `${v} hrs/wk`;
    default:         return v.toLocaleString("en-IN");
  }
}

function CellDisplay({ cell, format }: { cell: BmiMonthCell; format: BmiMetricRow["format"] }) {
  const text = fmtValue(cell.value, format);
  if (cell.source === "unavailable") {
    return (
      <span title={cell.tooltip} className="cursor-help text-slate-300 select-none">—</span>
    );
  }
  if (cell.source === "manual" && cell.value !== null) {
    return <span className="text-blue-700 font-medium">{text}</span>;
  }
  return <span>{text}</span>;
}

export function BMIBenchmarkTab() {
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState<BmiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<SheetKey>("funnel");
  const [editCell, setEditCell] = useState<{ key: string; month: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Load branch list
  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: { id: string; branch_name: string }[] }>("/api/branches")
      .then((r) => {
        if (r?.data) setBranches(r.data.map((b) => ({ id: b.id, name: b.branch_name })));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (branchId) q.set("branch_id", branchId);
      q.set("months", "6");
      const res = await hrmsApi.get<{ ok: boolean; data: BmiData }>(
        `/api/ats/bmi-benchmark?${q.toString()}`
      );
      if (res?.data) setData(res.data);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || "Failed to load BMI data");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);

  async function saveManual(key: string, month: string, raw: string) {
    if (!branchId) { toast.error("Select a branch to save manual entries"); return; }
    const num = parseFloat(raw);
    if (raw.trim() !== "" && isNaN(num)) { toast.error("Enter a valid number"); return; }
    setSaving(true);
    try {
      await hrmsApi.post("/api/ats/bmi-benchmark/manual", {
        branch_id: branchId,
        period_month: month,
        metric_key: key,
        value: raw.trim() === "" ? null : num,
      });
      toast.success("Saved");
      setEditCell(null);
      void load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  function exportExcel() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const sheets: SheetKey[] = ["funnel", "costs", "quality", "speed"];

    for (const sk of sheets) {
      const rows = data[sk];
      if (!rows?.length) continue;

      // Group rows by section for headers
      const headerRow = ["Metric", ...data.months.map(fmtMonth), "6-mo Total", "Example (how to fill)"];
      const sheetData: (string | number | null)[][] = [
        [`BMI Hiring Benchmark — ${sk.toUpperCase()}`],
        headerRow,
      ];

      let lastSection = "";
      for (const row of rows) {
        if (row.section !== lastSection) {
          sheetData.push([row.section]);
          lastSection = row.section;
        }
        const dataRow: (string | number | null)[] = [
          row.label,
          ...data.months.map((m) => row.cells[m]?.value ?? null),
          row.total,
          row.editable ? "Manual entry" : "Auto from HRMS",
        ];
        sheetData.push(dataRow);
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, `${sk.charAt(0).toUpperCase()}${sk.slice(1)}`);
    }

    XLSX.writeFile(wb, `BMI-Benchmark_${branchId ? branches.find(b => b.id === branchId)?.name ?? branchId : "All"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const rows: BmiMetricRow[] = data ? data[sheet] : [];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Branch</span>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 cursor-pointer rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 ml-auto">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Period</span>
          <span className="h-9 flex items-center text-sm font-medium text-slate-600">Last 6 months (rolling)</span>
        </div>
        <button
          onClick={exportExcel}
          disabled={!data || loading}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          Export Excel
        </button>
      </div>

      {/* Sheet tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit shadow-sm">
        {(Object.entries(SHEET_LABELS) as [SheetKey, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSheet(k)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              sheet === k
                ? "bg-blue-700 text-white"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1" />Auto from HRMS</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />Manual entry</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-slate-200 mr-1" />Not yet available</span>
        <span className="ml-2 text-blue-600 font-medium">✏️ click to edit manual rows</span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 sticky top-0">
            <tr>
              <th className="px-3 py-3 text-left font-bold whitespace-nowrap w-72">Metric</th>
              {data?.months.map((m) => (
                <th key={m} className="px-3 py-3 text-right font-bold whitespace-nowrap">{fmtMonth(m)}</th>
              ))}
              <th className="px-3 py-3 text-right font-bold whitespace-nowrap bg-slate-100">6-mo Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-3"><div className="animate-pulse h-4 bg-slate-100 rounded w-48" /></td>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-3 py-3"><div className="animate-pulse h-4 bg-slate-100 rounded w-12 ml-auto" /></td>
                  ))}
                </tr>
              ))
            ) : (
              (() => {
                let lastSection = "";
                return rows.map((row) => {
                  const sectionHeader = row.section !== lastSection ? (lastSection = row.section, row.section) : null;
                  return (
                    <>
                      {sectionHeader && (
                        <tr key={`section-${sectionHeader}`} className="bg-slate-50">
                          <td colSpan={(data?.months.length ?? 0) + 2} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                            {sectionHeader}
                          </td>
                        </tr>
                      )}
                      <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-slate-700 font-medium whitespace-nowrap">
                          {row.label}
                          {row.editable && <Pencil className="inline h-3 w-3 ml-1 text-blue-400" />}
                        </td>
                        {(data?.months ?? []).map((m) => {
                          const cell = row.cells[m];
                          const isEditing = editCell?.key === row.key && editCell?.month === m;
                          return (
                            <td
                              key={m}
                              className="px-3 py-2.5 text-right whitespace-nowrap"
                              onClick={() => {
                                if (row.editable && !isEditing) {
                                  setEditCell({ key: row.key, month: m });
                                  setEditValue(cell?.value != null ? String(cell.value) : "");
                                }
                              }}
                            >
                              {isEditing ? (
                                <span className="flex items-center justify-end gap-1">
                                  <input
                                    autoFocus
                                    className="w-20 text-right border border-blue-400 rounded px-1 py-0.5 text-sm outline-none"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") void saveManual(row.key, m, editValue);
                                      if (e.key === "Escape") setEditCell(null);
                                    }}
                                  />
                                  <button disabled={saving} onClick={() => void saveManual(row.key, m, editValue)}>
                                    <Check className="h-3.5 w-3.5 text-green-600" />
                                  </button>
                                  <button onClick={() => setEditCell(null)}>
                                    <X className="h-3.5 w-3.5 text-red-400" />
                                  </button>
                                </span>
                              ) : (
                                <CellDisplay cell={cell ?? { value: null, source: "auto" }} format={row.format} />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap bg-slate-50 font-semibold">
                          {row.total !== null ? fmtValue(row.total, row.format) : "—"}
                        </td>
                      </tr>
                    </>
                  );
                });
              })()
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
