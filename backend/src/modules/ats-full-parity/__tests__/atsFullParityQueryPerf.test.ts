import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-trip contracts for the ATS Command Center data calls and the candidate journey.
 *
 *  - webData: the ats_command_config lookup does not depend on the candidate rows.
 *  - commandCenterData: the other-entity COUNT does not depend on the candidate rows either.
 *  - candidateJourney: only the FIRST match of a `LIKE '%q%'` search is used, so it no longer
 *    materialises and enriches up to 5,000 rows; its four history reads are issued together.
 *
 * The reads overlap (max in-flight statements) and the assembled payloads are unchanged.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { atsFullParityService: svc } =
  await import("../atsFullParity.service.js");

let inFlight = 0;
let maxInFlight = 0;
function track(handler: (sql: string, params: unknown[]) => unknown) {
  inFlight = 0;
  maxInFlight = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const out = handler(String(sql), params);
    if (out instanceof Error) throw out;
    return [out, []];
  });
}

beforeEach(() => {
  execute.mockReset();
});

describe("webData", () => {
  it("fetches the config map alongside the candidate rows", async () => {
    track((sql) => {
      if (sql.includes("FROM ats_command_config"))
        return [{ setting: "Org_Name", value_text: "MAS Callnet" }];
      return []; // no candidates
    });
    const out = await svc.webData({ period: "ALL", bypassScope: true });
    expect(maxInFlight).toBe(2);
    expect(out).toMatchObject({
      ok: true,
      orgName: "MAS Callnet",
      rowsLoaded: 0,
      truncated: false,
    });
  });

  it("does not leave an unhandled rejection if the candidate query fails first", async () => {
    track((sql) =>
      sql.includes("FROM ats_command_config")
        ? new Error("config down")
        : new Error("rows down"),
    );
    await expect(svc.webData({ bypassScope: true })).rejects.toThrow(
      "rows down",
    );
  });

  it("still fails if the config lookup fails", async () => {
    track((sql) =>
      sql.includes("FROM ats_command_config") ? new Error("config down") : [],
    );
    await expect(svc.webData({ bypassScope: true })).rejects.toThrow(
      "config down",
    );
  });
});

describe("commandCenterData", () => {
  it("counts held-out other-entity candidates alongside the candidate rows", async () => {
    track((sql) =>
      sql.includes("COUNT(*) AS cnt FROM ats_candidate c")
        ? [{ cnt: 2738 }]
        : [],
    );
    const out = await svc.commandCenterData({
      period: "ALL",
      bypassScope: true,
    });
    expect(maxInFlight).toBe(2);
    expect(out).toMatchObject({
      ok: true,
      excludedOtherEntity: 2738,
      rowsLoaded: 0,
      queueTotal: 0,
    });
  });

  it("still fails when the count query fails", async () => {
    track((sql) =>
      sql.includes("COUNT(*) AS cnt FROM ats_candidate c")
        ? new Error("count down")
        : [],
    );
    await expect(svc.commandCenterData({ bypassScope: true })).rejects.toThrow(
      "count down",
    );
  });
});

describe("candidateJourney", () => {
  it("returns null when nothing matches, after a single query", async () => {
    track(() => []);
    expect(await svc.candidateJourney("nobody")).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("asks for only the first match and reads the four histories together", async () => {
    track((sql) => {
      if (sql.includes("FROM ats_candidate c"))
        return [{ id: "c1", candidate_code: "CND-1", full_name: "Asha" }];
      if (sql.includes("ats_candidate_stage_log")) return [{ id: "s1" }];
      if (sql.includes("ats_candidate_confirmation")) return [{ id: "k1" }];
      if (sql.includes("ats_command_email_log")) return [{ id: "e1" }];
      if (sql.includes("ats_notification_log")) return [{ id: "n1" }];
      return [];
    });
    const out = await svc.candidateJourney("asha");
    expect(out).toMatchObject({
      stageLogs: [{ id: "s1" }],
      confirmations: [{ id: "k1" }],
      emails: [{ id: "e1" }],
      notifications: [{ id: "n1" }],
    });
    expect(out?.candidate).toMatchObject({ id: "c1" });
    expect(maxInFlight).toBe(4);
    expect(String(execute.mock.calls[0][0])).toMatch(/LIMIT 1\s*$/);
  });
});
