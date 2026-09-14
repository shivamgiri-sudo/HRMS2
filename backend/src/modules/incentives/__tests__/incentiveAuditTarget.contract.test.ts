import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * No incentive approval has ever been audited.
 *
 * The module's writeAuditLog tried two statements and swallowed both failures:
 *
 *   INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, meta,
 *   created_at) - the table has actor_user_id, action_type and metadata_json,
 *   plus module_key which is NOT NULL with no default and was never supplied.
 *   audit_log holds 0 rows and this file was its only writer.
 *
 *   the same shape into work_item_audit_log, which has none of those columns and
 *   requires work_item_id.
 *
 * It now delegates to shared/auditLog writeAuditLog, which targets
 * audit_action_log - the store actually in use, 84 rows against audit_log's 0 -
 * and is non-throwing by contract.
 */
const ROUTES = path.resolve(__dirname, "../incentives.routes.ts");

const liveCode = () =>
  fs
    .readFileSync(ROUTES, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

describe("incentive approval auditing", () => {
  it("no longer writes to the dead audit_log table", () => {
    expect(liveCode()).not.toMatch(/INSERT INTO audit_log/);
  });

  it("does not push incentive events into work_item_audit_log", () => {
    // that table is keyed by work_item_id and tracks work-item transitions
    expect(liveCode()).not.toMatch(/INSERT INTO work_item_audit_log[\s\S]{0,120}entity_type/);
  });

  it("routes through the shared enterprise audit writer", () => {
    const code = liveCode();
    expect(code).toContain("writeEnterpriseAuditLog");
    expect(code).toContain("shared/auditLog.js");
  });

  it("supplies module_key, which is NOT NULL on the target table", () => {
    expect(liveCode()).toMatch(/module_key:\s*'incentives'/);
  });

  it("keeps the genuine work-item transition insert intact", () => {
    // this one names the real columns and is about a work item, not an incentive batch
    expect(liveCode()).toMatch(/work_item_id, action, from_status, to_status/);
  });
});
