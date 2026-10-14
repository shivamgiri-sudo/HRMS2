import { describe, expect, it } from "vitest";
import { anchoredChain } from "../bank-ledger-anchor.js";
import { toIsoDate, toNumber } from "../bank-statement-import.service.js";

let seed = 987654321;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

describe("anchoredChain — 500 random ledgers", () => {
  it("anchor row = opening; every step = its own movement; final = opening + movements after the as-of date", () => {
    for (let t = 0; t < 500; t++) {
      const n = ri(0, 60);
      const base = Date.UTC(2026, 0, 1);
      const rows = Array.from({ length: n }, () => ({ entry_date: iso(new Date(base + ri(0, 364) * 86_400_000)), credit: rnd() < 0.5 ? ri(1, 9_000_000) : 0, debit: 0 }))
        .map((r) => (r.credit ? r : { ...r, debit: ri(1, 9_000_000) }))
        .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      const opening = ri(-50_000_000, 900_000_000);
      const asOf = rnd() < 0.15 ? null : iso(new Date(base + ri(-10, 380) * 86_400_000));
      const chain = anchoredChain(rows, opening, asOf);
      expect(chain).toHaveLength(n);
      for (let i = 1; i < n; i++) expect(chain[i] - chain[i - 1]).toBe(rows[i].credit - rows[i].debit);
      const k = asOf ? rows.map((r) => r.entry_date <= asOf).lastIndexOf(true) : -1;
      if (k >= 0) expect(chain[k]).toBe(opening);
      const after = rows.filter((r, i) => i > k).reduce((s, r) => s + r.credit - r.debit, 0);
      if (n) expect(chain[n - 1]).toBe(opening + after);
    }
  });
});

describe("statement parsing — 500 random cells per kind", () => {
  it("every day-first date format round-trips", () => {
    for (let t = 0; t < 500; t++) {
      const d = new Date(Date.UTC(ri(2015, 2030), ri(0, 11), ri(1, 28)));
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), p = (x: number) => String(x).padStart(2, "0");
      const forms = [`${p(day)}/${p(m)}/${y}`, `${day}/${m}/${y}`, `${p(day)}-${p(m)}-${String(y).slice(2)}`, `${p(day)}.${p(m)}.${y}`,
        `${p(day)}-${MON[m - 1]}-${y}`, `${day} ${MON[m - 1]} ${String(y).slice(2)}`, `${y}-${p(m)}-${p(day)}`, `${p(day)}/${p(m)}/${y} 10:15:00`,
        new Date(y, m - 1, day), new Date(y, m - 1, day).getTime() - 1 > 0 ? new Date(new Date(y, m - 1, day).getTime() - 1) : new Date(y, m - 1, day)];
      for (const f of forms) expect(toIsoDate(f), String(f)).toBe(iso(d));
    }
  });
  it("every amount notation reads to the paisa", () => {
    for (let t = 0; t < 500; t++) {
      const paise = ri(1, 9_999_999_999);
      const v = paise / 100;
      const inr = v.toLocaleString("en-IN", { minimumFractionDigits: 2 });
      expect(toNumber(inr)).toBe(v);
      expect(toNumber(`₹ ${inr}`)).toBe(v);
      expect(toNumber(`${inr} Cr`)).toBe(v);
      expect(toNumber(`${inr} Dr`)).toBe(-v);
      expect(toNumber(`(${inr})`)).toBe(-v);
      expect(toNumber(`Rs. ${inr}`)).toBe(v);
      expect(toNumber(v)).toBe(v);
    }
  });
});
