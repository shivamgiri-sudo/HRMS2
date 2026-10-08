import type { ApprovalField } from "./types.js";

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** Drop empty fields so the popup shows only real components. */
export function fields(...list: Array<ApprovalField | null | undefined | false>): ApprovalField[] {
  return list.filter((f): f is ApprovalField => !!f && str(f.value) !== "");
}

export const f = (label: string, value: unknown, type: ApprovalField["type"] = "text"): ApprovalField => ({
  label,
  value: str(value),
  type,
});

export const money = (label: string, value: unknown): ApprovalField => {
  const n = Number(value);
  return {
    label,
    type: "money",
    value: value === null || value === undefined || value === "" || !Number.isFinite(n)
      ? ""
      : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
  };
};

/** ISO / Date / mysql string → "DD MMM YYYY"; unparsable input is returned untouched. */
export function dateText(v: unknown): string {
  const s = str(v);
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export const date = (label: string, v: unknown): ApprovalField => ({ label, value: dateText(v), type: "date" });
export const long = (label: string, v: unknown): ApprovalField => ({ label, value: str(v), type: "long" });
export const badge = (label: string, v: unknown): ApprovalField => ({ label, value: str(v), type: "badge" });

export const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
