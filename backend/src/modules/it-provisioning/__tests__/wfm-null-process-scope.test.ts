import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A fresh joiner has employees.process_id NULL until WFM alignment assigns it. The WFM queue
 * is process-scoped, so a strict `process_id IN (...)` hid exactly the rows the queue exists
 * to work (Noida: 3 pending, 0 listed). WFM must also see NULL-process joiners in its branch;
 * other roles keep the strict process filter.
 */
const mockExecute = vi.fn(async (sql: string) => {
  if (/COUNT\(/.test(sql)) return [[{ total: 0 }], []];
  return [[], []];
});

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...(args as [string, unknown[]])) },
}));

import { listProvisioningRequests, getProvisioningStats } from "../it-provisioning.service.js";

describe("WFM queue — NULL process_id joiners", () => {
  beforeEach(() => mockExecute.mockClear());

  it("list: wfm role also matches e.process_id IS NULL", async () => {
    await listProvisioningRequests({ assignedRole: "wfm", branchIds: ["b1"], processIds: ["p1"] });
    const [sql] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("(e.process_id IN (?) OR e.process_id IS NULL)");
  });

  it("list: other roles keep the strict process filter", async () => {
    await listProvisioningRequests({ assignedRole: "it", processIds: ["p1"] });
    const [sql] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("(e.process_id IN (?))");
    expect(sql).not.toContain("IS NULL)");
  });

  it("stats: wfm agrees with the list", async () => {
    await getProvisioningStats({ assignedRole: "wfm", processIds: ["p1"] });
    const [sql] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("OR e.process_id IS NULL");
  });
});
