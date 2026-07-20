import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ATS notification recipient schema", () => {
  const helperSource = readFileSync(
    resolve(process.cwd(), "src/services/ats-notification.helper.ts"),
    "utf8",
  );

  it("uses the current role assignment table for HR recipients", () => {
    expect(helperSource.match(/JOIN user_roles ur/g)).toHaveLength(2);
    expect(helperSource).toContain("ur.role_key IN ('hr', 'admin', 'super_admin')");
    expect(helperSource).not.toContain("JOIN user_role ur");
    expect(helperSource).not.toContain("JOIN role r");
  });
});
