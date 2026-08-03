import { describe, it, expect } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

/**
 * A CASE expression closes with END, exactly like a BEGIN block, and its END is followed by
 * whatever comes next in the surrounding statement — WHERE, AS, a comma, a closing paren.
 *
 * The splitter tracked BEGIN...END depth and treated `END IF` / `END LOOP` / `END WHILE` /
 * `END CASE` / `END REPEAT` as control-flow terminators that do not close a BEGIN. A bare
 * CASE expression's END matched none of those, so it decremented beginDepth, the next
 * semicolon split the file mid-procedure, and MySQL received half a CREATE PROCEDURE.
 *
 * The reported error is a syntax error "near ''" at the truncation point — which names
 * neither the CASE nor the procedure, and lands several lines away from the real cause.
 * Migration 273 died exactly this way after nineteen other fresh-build defects had been
 * cleared, and it would have taken any migration combining a stored procedure with a CASE
 * expression down the same way.
 */
describe("splitSql keeps CASE expressions inside their procedure", () => {
  const PROCEDURE = `
DROP PROCEDURE IF EXISTS _m273;
DELIMITER ;;
CREATE PROCEDURE _m273()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'candidate_status') THEN
    ALTER TABLE ats_candidate ADD COLUMN candidate_status VARCHAR(50) NULL;
  END IF;

  UPDATE ats_candidate SET candidate_status = CASE
    WHEN LOWER(final_decision) = 'selected' THEN 'selected'
    WHEN LOWER(final_decision) = 'rejected' THEN 'rejected'
    ELSE 'registered'
  END
  WHERE candidate_status IS NULL;
END;;
DELIMITER ;
CALL _m273();
`;

  it("emits the procedure as one statement, not two halves", () => {
    const statements = splitSql(PROCEDURE);
    const procedure = statements.find((s) => s.includes("CREATE PROCEDURE"));

    expect(procedure, "no CREATE PROCEDURE statement was produced at all").toBeDefined();

    // The tell-tale of the bug: the procedure is cut at the CASE's END, so the trailing
    // `END` that closes BEGIN never makes it into the same statement.
    expect(
      procedure,
      "the procedure was split at the CASE expression's END — it does not contain its own " +
        "closing END, so MySQL receives an unterminated CREATE PROCEDURE",
    ).toContain("WHERE candidate_status IS NULL");

    expect(procedure!.trimEnd().endsWith("END")).toBe(true);
  });

  it("still splits ordinary statements on semicolons", () => {
    const statements = splitSql("SELECT 1; SELECT 2; SELECT 3;");
    expect(statements).toHaveLength(3);
  });

  it("does not treat END CASE as an unmatched CASE", () => {
    // The statement form, `CASE ... END CASE`, increments on the way in and must decrement
    // on the way out — otherwise the counter leaks and the procedure's real END is swallowed.
    const withCaseStatement = `
DELIMITER ;;
CREATE PROCEDURE _p()
BEGIN
  CASE @x
    WHEN 1 THEN SELECT 'one';
    ELSE SELECT 'other';
  END CASE;
END;;
DELIMITER ;
SELECT 'after';
`;
    const statements = splitSql(withCaseStatement);
    const procedure = statements.find((s) => s.includes("CREATE PROCEDURE"));
    expect(procedure).toBeDefined();
    expect(procedure).toContain("END CASE");
    expect(statements.some((s) => s.includes("SELECT 'after'"))).toBe(true);
  });

  it("handles a CASE expression nested inside another", () => {
    const nested = `
DELIMITER ;;
CREATE PROCEDURE _p()
BEGIN
  UPDATE t SET c = CASE WHEN a = 1 THEN CASE WHEN b = 2 THEN 'x' ELSE 'y' END ELSE 'z' END WHERE d IS NULL;
END;;
DELIMITER ;
`;
    const procedure = splitSql(nested).find((s) => s.includes("CREATE PROCEDURE"));
    expect(procedure).toBeDefined();
    expect(procedure).toContain("WHERE d IS NULL");
    expect(procedure!.trimEnd().endsWith("END")).toBe(true);
  });
});
