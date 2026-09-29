import { createContext, useContext, useEffect, useId, useState, type MutableRefObject, type RefObject } from "react";
import { Download } from "lucide-react";
import { exportDashboardToExcel, type ExcelSheetSpec } from "@/lib/dashboardExcelExport";

const NUMERIC = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;

function cellValue(text: string): string | number | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "" || t === "—" || t === "-") return null;
  return NUMERIC.test(t) ? Number(t.replace(/,/g, "")) : t;
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/**
 * Views that page or window their table register the full data here, so the page-level export
 * still contains every row the filters select, not just the rows on the current page. The paged
 * table itself carries data-export-skip so it is not exported twice.
 */
export type ExportSheetRegistry = MutableRefObject<Map<string, ExcelSheetSpec>>;
export const ExportSheetContext = createContext<ExportSheetRegistry | null>(null);

export function useRegisterExportSheet(spec: ExcelSheetSpec | null): void {
  const registry = useContext(ExportSheetContext);
  const id = useId();
  useEffect(() => {
    if (!registry) return;
    if (spec && spec.rows.length > 0) registry.current.set(id, spec);
    else registry.current.delete(id);
    return () => { registry.current.delete(id); };
  }, [registry, id, spec]);
}

/** Turns every visible table inside `root` into a sheet, exactly as displayed. */
export function collectVisibleTables(root: HTMLElement): ExcelSheetSpec[] {
  const sheets: ExcelSheetSpec[] = [];
  root.querySelectorAll("table").forEach((table, idx) => {
    if (!(table as HTMLElement).offsetParent || table.hasAttribute("data-export-skip")) return;
    const headRow = table.querySelector("thead tr:last-child") ?? table.querySelector("tr");
    if (!headRow) return;
    const headers = uniqueHeaders([...headRow.querySelectorAll("th,td")].map((c) => c.textContent ?? ""));
    const bodyRows = [...table.querySelectorAll("tbody tr")].filter((r) => r !== headRow);
    const rows = bodyRows
      .map((tr) => {
        const cells = [...tr.querySelectorAll("th,td")];
        const row: Record<string, string | number | null> = {};
        headers.forEach((h, i) => { row[h] = cells[i] ? cellValue(cells[i].textContent ?? "") : null; });
        return row;
      })
      .filter((r) => Object.values(r).some((v) => v !== null));
    if (rows.length === 0) return;
    const card = table.closest(".oc-card, section, .space-y-4 > div");
    const title = card?.querySelector("h2, h3, h4")?.textContent?.trim() || `Table ${idx + 1}`;
    sheets.push({ name: `${idx + 1} ${title}`, title, rows });
  });
  return sheets;
}

/** Exports the data currently shown on the page to a plain (gridline-free) Excel sheet — never raw source data. */
export function OnfidoExportButton({ targetRef, filename, label = "Export" }: { targetRef: RefObject<HTMLElement | null>; filename: string; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  const registry = useContext(ExportSheetContext);
  function run() {
    setError(null);
    try {
      if (!targetRef.current) return;
      exportDashboardToExcel(filename, [...collectVisibleTables(targetRef.current), ...(registry ? [...registry.current.values()] : [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 140) : "Export failed");
    }
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="oc-btn-ghost" onClick={run}>
        <Download className="h-3.5 w-3.5" /> {label}
      </button>
      {error && <span role="alert" style={{ fontSize: 11, color: "var(--red)" }}>{error}</span>}
    </span>
  );
}
