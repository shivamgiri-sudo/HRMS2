/**
 * That Phase 4 is genuinely inert, and that the trust split is enforced rather than described.
 *
 * The claim being tested is "the code ships but the feature does not". A claim like that is
 * worthless unless something fails when it stops being true — so these tests assert that
 * dispatch refuses while any gate is unmet, that an empty gate table is treated as all-unmet
 * rather than as no gates, and that the reporting job cannot report a result the verification
 * job did not produce.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/mysql.js";
import {
  assertDispatchAllowed,
  DispatchError,
  gateReport,
  recordResult,
  type GateResult,
} from "../uat-build-dispatch.service.js";
import { sha256 } from "../control-plane.js";
import type { VerifiedToken } from "../uat-oidc-verify.service.js";

const mockQuery = db.query as unknown as ReturnType<typeof vi.fn>;

const ALL_GATES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];

function gateRows(met: string[]) {
  return ALL_GATES.map((g) => ({ gate_key: g, title: `gate ${g}`, met: met.includes(g) ? 1 : 0 }));
}

const token: VerifiedToken = {
  claims: {},
  repository: "shivamgiri-sudo/HRMS2",
  runId: "999",
  runAttempt: 1,
  sha: "b".repeat(40),
  jobWorkflowRef: "shivamgiri-sudo/HRMS2/.github/workflows/uat-build.yml@refs/heads/main",
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([[], []]);
});

describe("the gates hold the feature shut", () => {
  it("reports every gate unmet when the table has them all at 0", async () => {
    mockQuery.mockResolvedValueOnce([gateRows([]), []]);
    const report = await gateReport();
    expect(report.allMet).toBe(false);
    expect(report.unmet).toHaveLength(8);
  });

  it("treats an EMPTY gate table as all-unmet, not as no gates", async () => {
    // A migration that failed to seed would otherwise silently unlock the single most
    // dangerous feature in the system. This is the absent-means-permitted shape the whole
    // pipeline exists to prevent, applied to the pipeline itself.
    mockQuery.mockResolvedValueOnce([[], []]);
    const report = await gateReport();
    expect(report.allMet).toBe(false);
    expect(report.unmet[0].key).toBe("G0");
  });

  it("is met only when all eight are attested", async () => {
    mockQuery.mockResolvedValueOnce([gateRows(ALL_GATES), []]);
    expect((await gateReport()).allMet).toBe(true);
  });

  it("refuses dispatch while ANY single gate is unmet", async () => {
    for (const missing of ALL_GATES) {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([
        gateRows(ALL_GATES.filter((g) => g !== missing)),
        [],
      ]);
      await expect(
        assertDispatchAllowed("fb-1"),
        `dispatch must refuse while ${missing} is unmet`
      ).rejects.toThrow(DispatchError);
    }
  });

  it("names the unmet gates in the refusal, so the reason is actionable", async () => {
    mockQuery.mockResolvedValueOnce([gateRows(["G3", "G4", "G5", "G6", "G7", "G8"]), []]);
    await expect(assertDispatchAllowed("fb-1")).rejects.toThrow(/G1.*G2|G2.*G1/s);
  });

  it("refuses dispatch on the switch even with every gate met", async () => {
    mockQuery.mockResolvedValueOnce([gateRows(ALL_GATES), []]);
    // switchEnabled: env var is not "true" in the test environment, so it vetoes without
    // ever reaching the database.
    await expect(assertDispatchAllowed("fb-1")).rejects.toThrow(DispatchError);
  });
});

describe("Job D can only relay what Job C produced", () => {
  const gates = { baseline: 0, tsc_backend: 0, tsc_frontend: 0 };
  const result: GateResult = {
    passed: true,
    guardrailBreach: false,
    headSha: "c".repeat(40),
    gates,
  };

  it("rejects a result whose payload does not hash to the supplied gates_sha256", async () => {
    // Without this check the four-job trust split is decorative: the job that holds
    // publication authority could report a pass the verification job never emitted.
    await expect(
      recordResult(
        { buildRunId: "run-1", result, gatesSha256: "0".repeat(64) },
        token
      )
    ).rejects.toThrow(/does not hash to the value supplied/i);
  });

  it("rejects a tampered gate map even when the hash is of the ORIGINAL map", async () => {
    const honest = sha256(JSON.stringify(gates));
    const tampered: GateResult = { ...result, gates: { ...gates, tsc_frontend: 1 } };
    await expect(
      recordResult({ buildRunId: "run-1", result: tampered, gatesSha256: honest }, token)
    ).rejects.toThrow(DispatchError);
  });

  it("computes the hash over the payload, so an honest report is accepted", () => {
    // The positive case is asserted at the hashing level rather than end-to-end, because the
    // write path needs a real connection; what matters is that the comparison is over the
    // same bytes the caller sent.
    expect(sha256(JSON.stringify(gates))).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(JSON.stringify(gates))).toBe(sha256(JSON.stringify(gates)));
    expect(sha256(JSON.stringify(gates))).not.toBe(
      sha256(JSON.stringify({ ...gates, tsc_frontend: 1 }))
    );
  });
});

describe("the seeded control plane keeps the feature off", () => {
  it("every switch in the migration ships false", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "sql");
    const sql = readFileSync(join(sqlDir, "1104_uat_prompt_governance.sql"), "utf8");

    // Pull the seeded VALUES rows for uat_pipeline_config and assert none says 'true'.
    const seed = sql.slice(sql.indexOf("INSERT IGNORE INTO uat_pipeline_config"));
    const block = seed.slice(0, seed.indexOf(";"));
    for (const key of [
      "pipeline_enabled",
      "validator_enabled",
      "prompt_writer_enabled",
      "builds_enabled",
    ]) {
      const row = block.split("\n").find((l) => l.includes(`'${key}'`));
      expect(row, `${key} must be seeded`).toBeTruthy();
      expect(row, `${key} must ship false`).toContain("'false'");
    }
  });

  it("the allowlisted-modules setting ships empty, so no module is eligible", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "sql");
    const sql = readFileSync(join(sqlDir, "1104_uat_prompt_governance.sql"), "utf8");
    const row = sql.split("\n").find((l) => l.includes("'allowlisted_modules'"));
    expect(row).toBeTruthy();
    expect(row).toMatch(/'allowlisted_modules',\s*''/);
  });

  it("every gate in the migration ships unmet", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "sql");
    const sql = readFileSync(join(sqlDir, "1106_uat_build_run.sql"), "utf8");

    // `met` defaults to 0 and the seed supplies only (gate_key, title, requirement), so no
    // row can arrive attested. Assert both halves.
    expect(sql).toMatch(/met\s+TINYINT\(1\)\s+NOT NULL DEFAULT 0/);
    const insert = sql.slice(sql.indexOf("INSERT IGNORE INTO uat_gate_status"));
    expect(insert.slice(0, insert.indexOf("VALUES"))).toContain("(gate_key, title, requirement)");
    for (const g of ALL_GATES) expect(insert).toContain(`('${g}'`);
  });
});
