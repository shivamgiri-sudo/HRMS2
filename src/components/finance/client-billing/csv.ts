// src/components/finance/client-billing/csv.ts
/** Client-side CSV download for registers that have no server export route. */
export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const needsQuotes = s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r");
  return needsQuotes ? `"${s.split('"').join('""')}"` : s;
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function downloadCsv(filename: string, header: string[], rows: unknown[][]): void {
  const blob = new Blob([buildCsv(header, rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
