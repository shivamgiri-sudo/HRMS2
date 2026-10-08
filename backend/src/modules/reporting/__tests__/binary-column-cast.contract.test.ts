/**
 * A binary source column must be CAST to CHAR before it can reach JSON.
 *
 * mysql2 returns BINARY/VARBINARY/BLOB as a Node Buffer, and JSON.stringify renders a Buffer as
 * {"type":"Buffer","data":[49,50,...]}. The only binary column in either source schema is
 * employee_bank_detail.account_number (varbinary(500)) — confirmed live 2026-08-08, it is the
 * single binary column across mas_hrms and db_audit — and the BPO master reports surface it as
 * BANK_ACCOUNT_NUMBER, so an export emitted a byte array where an account number belongs.
 *
 * Two reasons it stayed hidden:
 *   - bpo-master-report.routes.ts masks sensitive columns for non-exporters with String(value),
 *     and String(buffer) decodes to text, so the masked view rendered a correct "****1234".
 *     Only a caller entitled to the real value ever saw the Buffer.
 *   - Until ebcbae12 the whole family answered 500 (information_schema column casing), so this
 *     code was never reached in production at all.
 *
 * The sibling bankAccountNumberCast contract test pins hand-written CASTs at the SQL sites that
 * spell the column out. This one pins the generated path instead: directField()/sourceExpression()
 * decide by data type, so a future binary column is covered without anyone remembering to.
 */
import { describe, expect, it } from "vitest";
import { directField } from "../bpo-master-adapter-utils.js";
import { isBinarySourceType, sourceColumnReference, type SourceColumn } from "../bpo-master-source-registry.js";

const column = (name: string, dataType: string): SourceColumn => ({
  schema: "mas_hrms", table: "employee_bank_detail", column: name, dataType,
});

const columnsFor = (...cols: SourceColumn[]) =>
  new Map(cols.map((c) => [c.column.toLowerCase(), c]));

describe("binary source columns are cast before reaching JSON", () => {
  it("classifies every MySQL binary type", () => {
    for (const t of ["binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob"]) {
      expect(isBinarySourceType(t)).toBe(true);
      expect(isBinarySourceType(t.toUpperCase())).toBe(true);
    }
    for (const t of ["varchar", "char", "int", "decimal", "date", "datetime", "text"]) {
      expect(isBinarySourceType(t)).toBe(false);
    }
    // A registry that failed to resolve dataType must not be treated as binary.
    expect(isBinarySourceType(undefined)).toBe(false);
    expect(isBinarySourceType(null)).toBe(false);
  });

  it("wraps a varbinary column in CAST(... AS CHAR)", () => {
    expect(sourceColumnReference("bank", column("account_number", "varbinary")))
      .toBe("CAST(bank.`account_number` AS CHAR)");
  });

  it("leaves a non-binary column exactly as it was", () => {
    expect(sourceColumnReference("bank", column("ifsc_code", "varchar")))
      .toBe("bank.`ifsc_code`");
  });

  it("directField casts the live varbinary account_number", () => {
    const field = directField(
      "bank", "employee_bank_detail",
      columnsFor(column("account_number", "varbinary")),
      ["account_number"],
    );

    expect(field).not.toBeNull();
    expect(field!.expression).toBe("CAST(bank.`account_number` AS CHAR)");
    // Lineage must still name the real column, not the CAST expression.
    expect(field!.lineage.sourceColumn).toBe("account_number");
    expect(field!.lineage.confidence).toBe("EXACT");
  });

  it("directField does not cast the columns beside it", () => {
    const field = directField(
      "bank", "employee_bank_detail",
      columnsFor(column("ifsc_code", "varchar")),
      ["ifsc_code"],
    );

    expect(field!.expression).toBe("bank.`ifsc_code`");
  });
});
