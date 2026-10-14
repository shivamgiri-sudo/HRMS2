import { xmlEscape } from "./grn-tally-voucher.js";

/**
 * Tally masters for a month's export: every ledger, cost category, cost centre and voucher type the
 * month's vouchers use, so an import into the company never fails on "ledger does not exist".
 *
 * Groups are Tally's own reserved groups. A ledger that already exists in the company is left as it is
 * by Tally's import (the existing master wins); the same file can therefore be imported every month.
 */

export type TallyGroup =
  | "Sundry Creditors"
  | "Sundry Debtors"
  | "Bank Accounts"
  | "Indirect Expenses"
  | "Duties & Taxes"
  | "Loans & Advances (Asset)"
  | "Current Liabilities"
  | "Indirect Incomes"
  | "Sales Accounts"
  | "Fixed Assets";

export class TallyMasters {
  private ledgers = new Map<string, { group: TallyGroup; costCentres: boolean }>();
  private categories = new Set<string>();
  private centres = new Map<string, string>(); // centre -> category
  private voucherTypes = new Map<string, string>(); // name -> parent

  ledger(name: string, group: TallyGroup, costCentres = group === "Indirect Expenses" || group === "Fixed Assets") {
    const key = name.trim();
    if (!key) return;
    const prev = this.ledgers.get(key);
    // First classification wins; a cost-centre-bearing use upgrades the flag.
    this.ledgers.set(key, { group: prev?.group ?? group, costCentres: (prev?.costCentres ?? false) || costCentres });
  }

  costCentre(category: string, centre: string) {
    if (!category.trim() || !centre.trim()) return;
    this.categories.add(category.trim());
    this.centres.set(centre.trim(), category.trim());
  }

  voucherType(name: string, parent: "Journal" | "Payment" | "Receipt" | "Contra" | "Sales" | "Credit Note") {
    if (!["Journal", "Payment", "Receipt", "Contra", "Purchase", "Sales", "Credit Note", "Debit Note"].includes(name)) this.voucherTypes.set(name, parent);
  }

  get counts() {
    return { ledgers: this.ledgers.size, costCategories: this.categories.size, costCentres: this.centres.size, voucherTypes: this.voucherTypes.size };
  }

  /** Bare TALLYMESSAGE payloads (no envelope): categories, centres, ledgers, voucher types. */
  messages(): string[] {
    const out: string[] = [];
    for (const c of [...this.categories].sort())
      out.push(`<COSTCATEGORY NAME="${xmlEscape(c)}" ACTION="Create"><NAME>${xmlEscape(c)}</NAME><ALLOCATEREVLINES>Yes</ALLOCATEREVLINES><ALLOCATENONREVLINES>Yes</ALLOCATENONREVLINES></COSTCATEGORY>`);
    for (const [n, c] of [...this.centres].sort())
      out.push(`<COSTCENTRE NAME="${xmlEscape(n)}" ACTION="Create"><NAME>${xmlEscape(n)}</NAME><CATEGORY>${xmlEscape(c)}</CATEGORY></COSTCENTRE>`);
    for (const [n, l] of [...this.ledgers].sort(([a], [b]) => a.localeCompare(b)))
      out.push(`<LEDGER NAME="${xmlEscape(n)}" ACTION="Create"><NAME>${xmlEscape(n)}</NAME><PARENT>${xmlEscape(l.group)}</PARENT><ISCOSTCENTRESON>${l.costCentres ? "Yes" : "No"}</ISCOSTCENTRESON></LEDGER>`);
    for (const [n, p] of [...this.voucherTypes].sort())
      out.push(`<VOUCHERTYPE NAME="${xmlEscape(n)}" ACTION="Create"><NAME>${xmlEscape(n)}</NAME><PARENT>${p}</PARENT><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD><ISACTIVE>Yes</ISACTIVE></VOUCHERTYPE>`);
    return out;
  }
}

/** Group for a ledger that appears on a GRN purchase journal. */
export function grnLedgerGroup(ledger: string, side: "Dr" | "Cr", isParty: boolean, imprest: boolean): TallyGroup {
  if (/^(Input (C|S|I)GST|TDS )/i.test(ledger)) return "Duties & Taxes";
  if (/^Short\/Excess Written off$/i.test(ledger)) return "Indirect Expenses";
  if (isParty) return imprest ? "Loans & Advances (Asset)" : "Sundry Creditors";
  if (/COST\b|Cost \d/.test(ledger)) return "Fixed Assets";
  return side === "Dr" ? "Indirect Expenses" : "Current Liabilities";
}
