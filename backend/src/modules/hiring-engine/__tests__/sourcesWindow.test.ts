import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { clearRequisitionSourcesCache, getRequisitionSources } from "../he-requisition-sources.service.js";

describe("getRequisitionSources SQL (pinned)", () => {
  beforeEach(() => { vi.clearAllMocks(); clearRequisitionSourcesCache(); });

  it("issues the same statements and parameters as before the window read model", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM job_requisition WHERE id")) return [[{ requisition_code: "REQ-1", branch_name: "Pune", designation_name: "Agent" }]];
      if (q.includes("FROM meta_campaign")) return [[{ id: "c9", campaign_name: "Ad" }]];
      return [[]];
    });
    await getRequisitionSources("r1", { all: true } as never);
    expect(execute.mock.calls.map((c) => [String(c[0]), c[1]])).toMatchSnapshot();
  });
});
