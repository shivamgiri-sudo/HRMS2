import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({ db: {} }));
vi.mock("../../../../config/env.js", () => ({ env: {} }));

import { filterByExistingColumns, getCosecColumns } from "../cosec-registration.service.js";

describe("COSEC registration column safety", () => {
  it("drops ORGID when the target table has no such column", () => {
    const existing = new Set(["USERID", "NAME", "BRCID"]);
    const out = filterByExistingColumns(
      [{ col: "UserID" }, { col: "ORGID" }, { col: "BRCID" }],
      existing,
    );
    expect(out.map((c) => c.col)).toEqual(["UserID", "BRCID"]);
  });

  it("keeps ORGID when present (case-insensitive)", () => {
    const out = filterByExistingColumns([{ col: "ORGID" }], new Set(["ORGID"]));
    expect(out).toHaveLength(1);
  });

  it("reads columns from INFORMATION_SCHEMA, upper-cased", async () => {
    const request = {
      input: vi.fn(),
      query: vi.fn().mockResolvedValue({ recordset: [{ COLUMN_NAME: "UserID" }, { COLUMN_NAME: "OrgId" }] }),
    };
    const pool = { request: () => request } as never;
    const cols = await getCosecColumns(pool, "Mx_UserMst");
    expect(cols.has("ORGID")).toBe(true);
    expect(cols.has("USERID")).toBe(true);
  });
});
