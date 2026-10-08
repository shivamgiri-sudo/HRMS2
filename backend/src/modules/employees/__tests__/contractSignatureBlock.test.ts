/**
 * The employment contract has exactly one employer signature block.
 *
 * This exists because I shipped a second one. I audited the contract, concluded
 * it had no employer block at all, and added one — when
 * "For and on behalf of Mas Callnet India (P) Ltd (First Party): ______" had
 * been there all along. The rendered PDF then carried two IN WITNESS WHEREOF
 * clauses and two employer signature lines, which on a document both parties
 * execute is worse than the anonymity it was meant to fix.
 *
 * The real defect was never a missing block. It was that the block did not say
 * who signs. That is what the name and designation lines address.
 *
 * Counting is the whole point here: a signature block reads perfectly well in a
 * diff and only looks wrong in the assembled document.
 */
import { describe, it, expect } from "vitest";
import { TEMPLATE_DEFINITIONS } from "../joiningDocumentTemplates.js";

function contractText(): string {
  const blocks = TEMPLATE_DEFINITIONS.find((e) => e.code === "EMPLOYMENT_CONTRACT")?.blocks;
  expect(blocks, "EMPLOYMENT_CONTRACT template not found").toBeTruthy();
  return JSON.stringify(blocks);
}

const occurrences = (haystack: string, needle: RegExp) => (haystack.match(needle) ?? []).length;

describe("employment contract signature blocks", () => {
  it("has exactly one IN WITNESS WHEREOF clause", () => {
    expect(occurrences(contractText(), /IN WITNESS WHEREOF/gi)).toBe(1);
  });

  it("has exactly one employer signature line", () => {
    expect(occurrences(contractText(), /Mas Callnet India \(P\) Ltd \(First Party\)/g)).toBe(1);
  });

  it("names who signs for the company", () => {
    // The point of the change: the line existed but was anonymous.
    const text = contractText();
    expect(text).toContain("{{payroll_hr_name}}");
    expect(text).toContain("{{payroll_hr_designation}}");
  });

  it("keeps the rule for the wet signature", () => {
    // Naming the signatory does not remove where they physically sign.
    expect(contractText()).toMatch(/First Party\): _{6,}/);
  });

  it("still has the Second Party signature block, and only one of it", () => {
    // Anchored on the opening quote so it matches only the signature line.
    // Without that it also catches the notices clause, "To Second Party:
    // {{employee_name}}, {{employee_address}}", and reports a duplicate that
    // is not one — which is exactly what the looser version did.
    expect(occurrences(contractText(), /"Second Party: \{\{employee_name\}\}"/g)).toBe(1);
  });

  it("keeps the notices clause distinct from the signature block", () => {
    expect(occurrences(contractText(), /To Second Party: \{\{employee_name\}\}/g)).toBe(1);
  });
});
