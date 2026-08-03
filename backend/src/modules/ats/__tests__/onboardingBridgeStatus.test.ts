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
