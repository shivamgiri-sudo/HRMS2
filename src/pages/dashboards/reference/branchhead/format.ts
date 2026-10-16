const LAKH = 100000;
const CRORE = 10000000;

function short(v: number, unit: string): string {
  const s = v.toFixed(1);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s} ${unit}`;
}

/** Indian grouping; "₹60.2 L" from 1 lakh, "₹1.4 Cr" from 1 crore; "—" for missing. */
export function formatInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 && Math.round(abs) !== 0 ? "-" : "";
  if (abs >= CRORE) return `${sign}₹${short(abs / CRORE, "Cr")}`;
  if (abs >= LAKH) return `${sign}₹${short(abs / LAKH, "L")}`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function formatPct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
}

export function formatCount(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN");
}

export function scoreBand(score: number): { label: "Good" | "Fair" | "Poor"; icon: "check" | "alert" | "x" } {
  if (score >= 75) return { label: "Good", icon: "check" };
  if (score >= 50) return { label: "Fair", icon: "alert" };
  return { label: "Poor", icon: "x" };
}
