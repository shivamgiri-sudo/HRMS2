import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../../sql/040_communication.sql"), "utf8");

describe("communication migration", () => {
  it("keeps employee foreign key columns compatible with employees.id", () => {
    expect(migration).toMatch(/REFERENCES\s+employees\s*\(\s*id\s*\)/i);

    for (const column of ["created_by", "employee_id", "recipient_employee_id"]) {
      expect(migration, column).toMatch(new RegExp(`${column}\\s+CHAR\\(36\\)`, "i"));
    }

    expect(migration).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
    expect(migration).not.toMatch(/\bCOLLATE\b/i);
  });
});
