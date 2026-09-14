/**
 * The db_bill statutory sync must corroborate identity before writing.
 *
 * It matched on EmpCode alone. Employee codes have been REUSED, so an EmpCode in
 * mas_hrms and the same EmpCode in db_bill are not always the same human.
 *
 * Measured across the 756 active employees this sync would consider: 691 match an
 * EmpCode in masjclrentry, of which 669 names agree exactly and 12 partially — but
 * **10 name a completely different person**, and not only test fixtures:
 *
 *   MAS62921  mas_hrms "SHEELU GARG"    db_bill "KRISHNA"
 *   MAS63086  mas_hrms "SOFIYA SULTAN"  db_bill "NAYANDEEP KAUR"
 *
 * The sync writes uan_number, epf_number, pan_number, esic_number AND
 * bank_account_number. A wrong PAN misfiles a tax return; a wrong account number pays
 * salary to the wrong person. Neither announces itself, because every value written is
 * individually well-formed — which is why this needs a test rather than review.
 *
 * The check is deliberately generous. The two systems spell people differently, so
 * demanding an exact match would refuse the 12 legitimate partial matches. One shared
 * word of 3+ characters is enough to tell "SOFIYA SULTAN vs NAYANDEEP KAUR" from
 * "NAGORI MOHAMMED SAMIR MOHAMMED vs NAGORI MOHAMMED SAMIR".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { namesCorroborate } from "../syncStatutoryDataFromDbBill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../syncStatutoryDataFromDbBill.ts"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("db_bill statutory sync — identity corroboration", () => {
  it("rejects the real code collisions found in production", () => {
    expect(namesCorroborate("SHEELU GARG", "KRISHNA")).toBe(false);
    expect(namesCorroborate("SOFIYA SULTAN", "NAYANDEEP KAUR")).toBe(false);
    expect(namesCorroborate("Harsh Thakur", "KASHISH TYAGI")).toBe(false);
    expect(namesCorroborate("Codex E2E Candidate CODEX_E2E_1", "SACHIN KUMAR")).toBe(false);
    expect(namesCorroborate("dsd dsd", "DEEPANSHU PUNDHEER")).toBe(false);
  });

  it("accepts the same person spelled differently", () => {
    // All observed in the 691 matched pairs.
    expect(namesCorroborate("NAGORI MOHAMMED SAMIR MOHAMMED", "NAGORI MOHAMMED SAMIR")).toBe(true);
    expect(namesCorroborate("CHAVDA RANJANBEN", "chavda ranjanben")).toBe(true);
    expect(namesCorroborate("MONIKA SANJAY SHARMA  ", " MONIKA SANJAY SHARMA")).toBe(true);
    expect(namesCorroborate("LATTABEN TEJASBHAI AHUJA", "AHUJA LATTABEN")).toBe(true);
  });

  it("fails closed when either name is missing", () => {
    // Unverifiable is not the same as verified — a blank name must not authorise a write.
    for (const [a, b] of [[null, "KRISHNA"], ["SOFIYA SULTAN", null], ["", ""], [undefined, undefined]] as const) {
      expect(namesCorroborate(a, b)).toBe(false);
    }
  });

  it("is not fooled by punctuation or initials alone", () => {
    // Single letters are excluded from the token set, so "A. KUMAR" vs "A. SHARMA" must
    // not corroborate on the shared initial.
    expect(namesCorroborate("A. KUMAR", "A. SHARMA")).toBe(false);
    expect(namesCorroborate("R.K. GUPTA", "R.K. VERMA")).toBe(false);
  });

  it("the sync consults the check before writing anything", () => {
    expect(code).toContain("namesCorroborate(employee.full_name, legacy.EmpName)");
    // Both names must actually be selected, or the check silently compares undefined.
    expect(code).toMatch(/SELECT EmpCode, EmpName,/);
    expect(code).toMatch(/SELECT id, employee_code, full_name,/);
    // The guard must precede the field-by-field writes.
    expect(code.indexOf("namesCorroborate")).toBeLessThan(code.indexOf("fieldsToUpdate.push('uan_number')"));
  });
});
