import { toTable } from "./shape";
import type { Cell, QueryResult } from "./types";

const safeName = (s: string) => (s || "export").replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || "export";

/** RFC 4180 CSV. A leading = + - @ is prefixed with ' so a spreadsheet never runs a cell as a formula. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(title: string, result: QueryResult): void {
  const t = toTable(result);
  download(`${safeName(title)}.csv`, new Blob(["﻿", toCsv(t.header, t.rows)], { type: "text/csv;charset=utf-8" }));
}

/** One sheet per widget. The xlsx library is loaded only when someone exports. */
export async function exportXlsx(fileTitle: string, sheets: Array<{ title: string; result: QueryResult }>): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s, i) => {
    const t = toTable(s.result);
    let name = safeName(s.title).slice(0, 28) || `Sheet ${i + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 25)} ${i + 1}`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t.header, ...t.rows]), name);
  });
  XLSX.writeFile(wb, `${safeName(fileTitle)}.xlsx`);
}
