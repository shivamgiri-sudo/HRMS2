import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bank readiness never turned green on the salary-review queue, however the
 * penny drop went.
 *
 * classifyBankReadiness reaches READY only when db_bill shows a confirmed prior
 * salary credit. That is right for the standing payroll bank-exceptions queue,
 * but structurally unsatisfiable for the people in THIS queue -- a new hire has
 * no payroll history -- so every row fell to BLOCKED /
 * no_payment_history_to_verify_against. Live, 16 of the 23 employees in the
 * queue had a penny-drop-confirmed account and all 16 read as not verified.
 *
 * The fix is an overlay read alongside that classification, never merged into
 * it. These assertions guard the two things that make the overlay safe rather
 * than the display detail, which is visible on the page.
 */
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll-head-review/payroll-head-review.service.ts"),
  "utf8",
);
const QUEUE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "payroll", "PayrollHeadSalaryReviewQueue.tsx"),
  "utf8",
);
const HELPER = SERVICE.slice(
  SERVICE.indexOf("async function fetchPennyDropByEmployee"),
  SERVICE.indexOf("async function getReviewRow"),
);

describe("Penny-drop overlay — must not become a payment authorisation", () => {
  it("never assigns payable or readiness_class", () => {
    // payroll.routes.ts builds the payment file from
    // readiness_class === "READY". If the overlay ever wrote either field, a
    // penny drop alone would enter a new hire into a payroll run.
    expect(HELPER).not.toMatch(/payable\s*[:=]/);
    expect(HELPER).not.toMatch(/readiness_class\s*[:=]/);
  });

  it("is attached as a separate penny_drop key, leaving the classifier's result intact", () => {
    expect(SERVICE).toMatch(/\.\.\.\(b as object\), penny_drop:/);
  });

  it("the queue tile shows Payable only from the classifier, never from a penny drop", () => {
    const bankCase = QUEUE.slice(QUEUE.indexOf("case 'bank': {"), QUEUE.indexOf("case 'bank': {") + 1200);
    // Payable ✓ must be gated on s.bank.payable, and the penny-drop branch must
    // sit after it with its own distinct label.
    expect(bankCase).toMatch(/if \(s\.bank\.payable\) return \{ text: 'Payable ✓'/);
    expect(bankCase).toMatch(/penny_drop\?\.verified.*Penny-drop verified/s);
    expect(bankCase.indexOf("s.bank.payable")).toBeLessThan(bankCase.indexOf("penny_drop"));
  });
});

describe("Penny-drop overlay — resolves the right record", () => {
  it("counts only a real penny drop, not the mock provider", () => {
    // 4 rows carry verification_status='verified' against verification_method
    // 'mock' -- the local stub. A green chip for an account nobody checked is
    // worse than no chip.
    expect(HELPER).toMatch(/verification_status === "verified" && r\.verification_method === "penny_drop"/);
  });

  it("joins on employee_code, because employees.candidate_id is empty", () => {
    // candidate_id is populated on 2 of 58,929 employee rows and NULL for every
    // employee in this queue, so joining on it resolves nothing.
    expect(HELPER).toContain("ac.employee_code = e.employee_code");
    expect(HELPER).not.toMatch(/e\.candidate_id\s*=/);
  });

  it("picks one verification per candidate, preferring a verified one", () => {
    // candidate_bank_verification holds multiple attempts per candidate; without
    // a bound the join would fan the employee out into duplicate queue rows.
    expect(HELPER).toContain("LIMIT 1");
    expect(HELPER).toMatch(/ORDER BY \(c2\.verification_status = 'verified'\) DESC/);
  });

  it("degrades to an empty overlay rather than taking the queue down", () => {
    expect(HELPER).toMatch(/catch\s*\{[\s\S]{0,240}return out;/);
  });
});
