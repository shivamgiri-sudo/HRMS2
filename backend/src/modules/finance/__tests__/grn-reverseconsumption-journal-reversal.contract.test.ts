import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * Journal Task 5 — reverseConsumption() undoes a Finance-Head-approved GRN's budget
 * consumption; it must undo the matching journal entry (Task 2) in the same transaction, or the
 * journal would keep asserting an expense that reverseConsumption() just said never should have
 * been booked. A behavioural (mocked-connection) test for this exists too in spirit — the
 * shape of reverseConsumption()'s existing test coverage in this codebase
 * (grn-consumption-reversal.contract.test.ts) is source-text assertions against the real file,
 * not a full mock harness, so this follows that same convention rather than introducing a
 * second style for one function.
 */
describe("GRN reverseConsumption() — journal reversal (Journal Task 5)", () => {
  const service = read("src/modules/finance/grn.service.ts");

  it("imports journalService", () => {
    expect(service).toContain('import { journalService } from "./journal.service.js"');
  });

  it("looks up the live (non-reversed) journal entry for this GRN before reversing", () => {
    expect(service).toMatch(
      /SELECT id FROM journal_entry\s+WHERE source_type = 'grn' AND source_id = \? AND reversed_by_entry_id IS NULL/,
    );
  });

  it("calls journalService.reverse with the actor and the reversal reason, only when a live entry was found", () => {
    expect(service).toContain("if (liveEntry) {");
    expect(service).toContain(
      "await journalService.reverse(connection, String((liveEntry as any).id), actorUserId, trimmedReason);",
    );
  });

  it("posts the journal reversal on the SAME connection as the budget reversal and the status UPDATE — inside reverseConsumption(), not after connection.commit()", () => {
    const fnStart = service.indexOf("async reverseConsumption(");
    const fnCommit = service.indexOf("await connection.commit();", fnStart);
    const journalLookup = service.indexOf("FROM journal_entry", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(journalLookup).toBeGreaterThan(fnStart);
    expect(journalLookup).toBeLessThan(fnCommit);
  });
});
