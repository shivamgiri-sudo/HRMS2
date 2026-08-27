/**
 * One place that turns a KPI value into the string shown to the reader.
 *
 * It lives outside the component files because both the table cell and the
 * drill-down list render the same numbers, and a cell that formats a figure
 * differently from the list behind it reads as two different numbers.
 */
export type Unit = "percent" | "count" | "seconds" | "currency" | null;

export function formatValue(s: { value: number | null; unit: Unit }): string {
  if (s.value === null) return "—";
  switch (s.unit) {
    case "percent": return `${s.value}%`;
    case "seconds": return `${s.value}s`;
    case "currency": return `₹${Math.round(s.value).toLocaleString("en-IN")}`;
    default: return String(s.value);
  }
}
