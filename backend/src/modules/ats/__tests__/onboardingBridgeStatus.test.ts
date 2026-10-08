/**
 * Bridge status mapping.
 *
 * The enum values below are the live column definitions, read from production:
 *
 *   ats_onboarding_bridge.digilocker_status
 *     enum('not_started','initiated','documents_received','expired')
 *   ats_onboarding_bridge.penny_drop_status
 *     enum('not_started','initiated','verified','failed','name_mismatch')
 *
 * MySQL runs in STRICT mode, so producing anything outside these lists throws
 * rather than coercing — and it would throw inside the DigiLocker sync, which
 * only started working today. Hence the exhaustive check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bridgeDigilockerStatus,
  bridgePennyDropStatus,
  BRIDGE_DIGILOCKER_VALUES,
  BRIDGE_PENNY_DROP_VALUES,
} from "../onboarding-bridge-status.js";

/** Exactly what the live ENUMs accept. */
const LIVE_DIGILOCKER_ENUM = ["not_started", "initiated", "documents_received", "expired"];
const LIVE_PENNY_DROP_ENUM = ["not_started", "initiated", "verified", "failed", "name_mismatch"];

describe("the declared values match the live columns", () => {
  it("digilocker_status", () => {
    expect([...BRIDGE_DIGILOCKER_VALUES].sort()).toEqual([...LIVE_DIGILOCKER_ENUM].sort());
  });
  it("penny_drop_status", () => {
    expect([...BRIDGE_PENNY_DROP_VALUES].sort()).toEqual([...LIVE_PENNY_DROP_ENUM].sort());
  });
});

/**
 * The UPDATE must only name columns ats_onboarding_bridge actually has.
 *
 * The first version set `updated_at`. That table has no such column — it uses
 * created_at plus a purpose-built timestamp per milestone. Because the whole
 * call is deliberately swallowed so a mirror failure can never lose a
 * verification, the error was logged and the bridge silently never moved: the
 * fix looked deployed and did nothing. Migration 1070 made the identical
 * mistake and failed loudly, which is how it was found.
 *
 * Column list read from production, 2026-08-03.
 */
describe("the bridge UPDATE names only real columns", () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/modules/ats/onboarding-bridge-status.ts"),
    "utf8",
  );

  const REAL_COLUMNS = [
    "id", "candidate_id", "employee_id", "bridge_date", "offer_letter_url",
    "joining_date", "status", "notes", "created_by", "created_at",
    "onboarding_token", "onboarding_token_expires_at", "hr_approved_by",
    "hr_approved_at", "penny_drop_status", "penny_drop_verified_at",
    "digilocker_status", "digilocker_session_id", "digilocker_completed_at",
    "joining_document_status", "joining_document_completion_pct",
    "joining_document_completed_at", "employee_code", "converted_at",
  ];

  it("does not set updated_at, which does not exist on this table", () => {
    expect(REAL_COLUMNS).not.toContain("updated_at");
    expect(
      SOURCE,
      "ats_onboarding_bridge has no updated_at; this throws and the bridge never moves",
    ).not.toMatch(/updated_at\s*=\s*NOW\(\)/);
  });

  it("stamps the milestone columns that do exist", () => {
    for (const column of ["digilocker_completed_at", "penny_drop_verified_at"]) {
      expect(REAL_COLUMNS).toContain(column);
      expect(SOURCE).toContain(column);
    }
  });

  it("only ever stamps a timestamp on reaching the terminal status", () => {
    // A timestamp written while still 'initiated' would claim a completion
    // that has not happened.
    expect(SOURCE).toMatch(/next === stamp\.whenStatusIs/);
  });
});

describe("DigiLocker state -> bridge", () => {
  it("a completed session opens the gate", () => {
    // onboarding-full.service.ts gates on exactly this string.
    expect(bridgeDigilockerStatus("completed")).toBe("documents_received");
  });

  it("does not use the report's vocabulary", () => {
    // 'passed' is candidate_bgv_report's value and is not in this ENUM;
    // writing it would throw under STRICT mode.
    expect(bridgeDigilockerStatus("completed")).not.toBe("passed");
    expect(bridgeDigilockerStatus("passed")).toBe("not_started");
  });

  for (const [input, expected] of [
    ["created", "initiated"],
    ["initiated", "initiated"],
    ["pending", "initiated"],
    ["in_progress", "initiated"],
    ["expired", "expired"],
    ["COMPLETED", "documents_received"],
    ["  completed  ", "documents_received"],
  ] as const) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(bridgeDigilockerStatus(input)).toBe(expected);
    });
  }

  it("never produces a value outside the ENUM", () => {
    for (const junk of [null, undefined, "", "nonsense", 42, {}, [], "not_run"]) {
      expect(LIVE_DIGILOCKER_ENUM).toContain(bridgeDigilockerStatus(junk));
    }
  });
});

describe("bank outcome -> bridge penny drop", () => {
  it("a verified penny drop reads as verified", () => {
    expect(bridgePennyDropStatus("verified")).toBe("verified");
  });

  it("a name divergence review reads as a name mismatch", () => {
    // This is the case that caught a real account registered to someone else.
    expect(
      bridgePennyDropStatus("manual_review", ["BANK_HOLDER_NAME_DIVERGENCE"]),
    ).toBe("name_mismatch");
  });

  it("a provider outage does NOT read as a name mismatch", () => {
    // Nothing is known about the name yet; claiming a mismatch invents a
    // finding no one made.
    expect(bridgePennyDropStatus("manual_review", ["PROVIDER_UNAVAILABLE"])).toBe("initiated");
    expect(bridgePennyDropStatus("manual_review", [])).toBe("initiated");
    expect(bridgePennyDropStatus("manual_review", null)).toBe("initiated");
  });

  for (const [status, expected] of [
    ["mismatch", "name_mismatch"],
    ["failed", "failed"],
    ["pending", "initiated"],
    ["initiated", "initiated"],
  ] as const) {
    it(`${status} -> ${expected}`, () => {
      expect(bridgePennyDropStatus(status)).toBe(expected);
    });
  }

  it("never produces a value outside the ENUM", () => {
    for (const junk of [null, undefined, "", "nonsense", 42, {}, "passed"]) {
      expect(LIVE_PENNY_DROP_ENUM).toContain(bridgePennyDropStatus(junk));
    }
  });
});
