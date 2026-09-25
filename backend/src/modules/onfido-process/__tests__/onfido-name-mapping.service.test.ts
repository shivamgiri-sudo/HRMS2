import { describe, expect, it } from "vitest";

import { matchNameToEmployees } from "../onfido-name-mapping.service.js";
import type { EmployeeCandidate } from "../onfido-name-mapping.types.js";

describe("matchNameToEmployees", () => {
  it("returns a high-confidence exact match when exactly one employee has that full name", () => {
    const candidates: EmployeeCandidate[] = [
      { id: "emp-1", fullName: "Priya Sharma", employeeCode: "MAS001" },
      { id: "emp-2", fullName: "Rahul Verma", employeeCode: "MAS002" },
    ];

    const result = matchNameToEmployees("Priya Sharma", candidates);

    expect(result.employeeId).toBe("emp-1");
    expect(result.confidence).toBe(1.0);
    expect(result.method).toBe("exact_name");
  });

  it("flags ambiguous when multiple employees share the exact same full name", () => {
    const candidates: EmployeeCandidate[] = [
      { id: "emp-1", fullName: "Amit Kumar", employeeCode: "MAS010" },
      { id: "emp-2", fullName: "Amit Kumar", employeeCode: "MAS045" },
      { id: "emp-3", fullName: "Rahul Verma", employeeCode: "MAS002" },
    ];

    const result = matchNameToEmployees("Amit Kumar", candidates);

    expect(result.employeeId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.method).toBe("ambiguous");
  });

  it("returns unmatched with blank/whitespace-only names instead of throwing", () => {
    const candidates: EmployeeCandidate[] = [
      { id: "emp-1", fullName: "Priya Sharma", employeeCode: "MAS001" },
    ];

    const result = matchNameToEmployees("   ", candidates);

    expect(result.employeeId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.method).toBe("unmatched");
  });
});
