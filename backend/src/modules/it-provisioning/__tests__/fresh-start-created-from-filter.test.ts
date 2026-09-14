import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * "Fresh start from today" (2026-08-24): /provisioning/it, /provisioning/admin and
 * /provisioning/wfm-alignment now send `created_from` so their queue only shows
 * it_provisioning_request rows created on or after the cutover date, without deleting or
 * modifying any pre-cutover row. /provisioning/appointment-letter does not send it and must
 * keep seeing full history.
 *
 * This asserts the filter actually reaches the SQL WHERE clause with the right value when
 * present, and that omitting it (the appointment-letter case) does not add any date
 * restriction at all.
 */

const mockExecute = vi.fn(async (sql: string) => {
  if (/COUNT\(\*\)/.test(sql)) return [[{ total: 0 }], []];
  return [[], []];
});

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...(args as [string, unknown[]])) },
}));

import { listProvisioningRequests } from "../it-provisioning.service.js";

describe("listProvisioningRequests — created_from fresh-start filter", () => {
  beforeEach(() => {
    mockExecute.mockClear();
  });

  it("adds ipr.created_at >= ? to the WHERE clause and passes the date through as a param", async () => {
    await listProvisioningRequests({ createdFrom: "2026-08-24" });

    const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ipr.created_at >= ?");
    expect(params).toContain("2026-08-24");
  });

  it("does not restrict by date at all when createdFrom is omitted (appointment-letter case)", async () => {
    await listProvisioningRequests({});

    const [sql] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("ipr.created_at >= ?");
  });

  it("applies the same filter to both the row query and the count query", async () => {
    await listProvisioningRequests({ createdFrom: "2026-08-24" });

    const rowSql = mockExecute.mock.calls[0][0] as string;
    const countSql = mockExecute.mock.calls[1][0] as string;
    expect(rowSql).toContain("ipr.created_at >= ?");
    expect(countSql).toContain("ipr.created_at >= ?");
  });
});
