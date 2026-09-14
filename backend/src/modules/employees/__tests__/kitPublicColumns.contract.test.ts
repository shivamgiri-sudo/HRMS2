/**
 * Column names the kit's public endpoints get wrong.
 *
 * Both of these shipped and broke the live signing link:
 *
 *   - employee_document_esign_transaction has initiated_at, NOT created_at.
 *     Ordering by the missing column made every REAL token answer 500.
 *   - employee_joining_document_audit_log has created_at, NOT acted_at
 *     (acted_at belongs to sensitive_action_log). That insert is wrapped in a
 *     .catch(), so it failed silently and lost the audit trail.
 *
 * Neither was caught by testing with an invalid token, which returns 404 before
 * reaching either statement — the reason these assertions exist at all. A source
 * grep cannot verify a schema, so this pins only the two mistakes already made;
 * the real guard is exercising a live token over HTTP.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "joiningKitPublic.service.ts"), "utf8");

describe("kit public endpoints use columns that exist", () => {
  it("orders esign transactions by initiated_at", () => {
    expect(SRC).toContain("ORDER BY initiated_at DESC");
  });

  it("never orders the transaction table by created_at", () => {
    const tx = SRC.slice(SRC.indexOf("employee_document_esign_transaction"));
    expect(tx.slice(0, 200)).not.toContain("ORDER BY created_at");
  });

  it("writes the joining-document audit log with created_at", () => {
    expect(SRC).toMatch(/employee_joining_document_audit_log[\s\S]{0,220}created_at\)/);
  });

  it("never uses acted_at (that column is on sensitive_action_log)", () => {
    expect(SRC).not.toContain("acted_at");
  });
});
