/**
 * The older DigiLocker surface must not write to the dead table.
 *
 * Two implementations exist. The live one (Luckpay, /api/ats/bgv/digilocker/*)
 * writes `candidate_digilocker_session` — singular, 32 rows in production. This
 * one wrote `candidate_digilocker_sessions` — plural, zero rows, read by
 * nothing. Anything recorded through it was invisible to the BGV report, the
 * onboarding bridge and the candidate's own form.
 *
 * Settings advertised its callback as the URL to give the provider, so a
 * completed DigiLocker delivered there would have vanished silently.
 *
 * The route stays mounted — it is public and nothing here can prove no external
 * caller exists — but it now reconciles through the real sync instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Strip comments. The file's own header explains at length why the plural
 * table and DigiLockerService must not be used, so asserting against the raw
 * text would fail on the explanation rather than on the code.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const ROUTES = code(
  readFileSync(resolve(process.cwd(), "src/modules/onboarding/digilocker.routes.ts"), "utf8"),
);
const APP = readFileSync(resolve(process.cwd(), "src/app.ts"), "utf8");
const SETTINGS_PAGE = resolve(process.cwd(), "../src/pages/Settings.tsx");

describe("the retired DigiLocker surface", () => {
  it("never touches the empty plural table", () => {
    // \b so it does not match the singular table name.
    expect(
      ROUTES,
      "candidate_digilocker_sessions holds 0 rows and nothing reads it",
    ).not.toMatch(/candidate_digilocker_sessions\b/);
  });

  it("reads the table the live flow actually writes", () => {
    expect(ROUTES).toMatch(/candidate_digilocker_session\b/);
  });

  it("no longer uses DigiLockerService, which is bound to the dead table", () => {
    expect(ROUTES).not.toMatch(/DigiLockerService/);
  });

  it("reconciles the callback through the real sync", () => {
    expect(ROUTES).toContain("syncDigilockerStatus");
  });

  it("refuses to mint a session that nothing would ever read", () => {
    const at = ROUTES.indexOf('router.post("/initiate"');
    expect(at, "the initiate route has moved or been removed").toBeGreaterThan(-1);
    const handler = ROUTES.slice(at, ROUTES.indexOf("}));", at));
    expect(handler).toMatch(/410/);
    // The endpoint is named via a constant, so the redirect target is stated
    // once and every response that turns a caller away uses the same string.
    expect(handler, "the caller must be told where to go instead")
      .toContain("LIVE_START_ENDPOINT");
  });

  it("names the live endpoint it redirects callers to", () => {
    expect(ROUTES).toMatch(
      /LIVE_START_ENDPOINT\s*=\s*["']\/api\/ats\/bgv\/digilocker\/start["']/,
    );
  });

  it("stays mounted, so an external caller does not start getting 404s", () => {
    expect(APP).toMatch(/app\.use\(\s*["']\/api\/onboarding\/digilocker["']/);
  });
});

describe("Settings does not advertise the dead callback", () => {
  const settings = readFileSync(SETTINGS_PAGE, "utf8");

  it("points the provider at the callback the system consumes", () => {
    // Comments in that file legitimately name the old path while explaining
    // why it is not used, so assert on the config values rather than the text.
    const configLines = settings
      .split("\n")
      .filter((line) => /^\s*(callback:|path:)/.test(line));
    expect(configLines.length).toBeGreaterThan(0);
    for (const line of configLines) {
      expect(line, "a config value still points at the retired DigiLocker route")
        .not.toMatch(/\/api\/onboarding\/digilocker/);
    }
  });
});
