/**
 * The regularization POST body must use the key names the backend accepts.
 *
 * `regularizationSchema` (backend/src/modules/wfm/wfm.validation.ts:101) is a
 * plain `z.object`, so it silently STRIPS any key it does not recognise — there
 * is no error and no validation failure. `useSubmitRegularization` sent
 * `reason_code` and `requested_status` in snake_case, so every request raised
 * from the attendance calendar was stored with both columns NULL.
 *
 * That turned into a silent approval: reviewRegularization applies the correction
 * only `if (input.status === 'approved' && effectiveRequestedStatus)`
 * (wfm.service.ts:428). With requested_status NULL and no exception dispute_type,
 * the guard is false — the request flips to 'approved', the employee sees a
 * success, and their attendance and LWP are never touched.
 *
 * It also explains why `source_system='apr_regularization'` has never appeared in
 * production: the tag is set from reason_code, which never arrived.
 *
 * A type-level check cannot catch this — the payload is an untyped object literal
 * posted as JSON. So the contract is asserted against the source of both sides.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const HOOK = fs.readFileSync(path.join(ROOT, "src/hooks/useAttendance.ts"), "utf8");
const SCHEMA = fs.readFileSync(
  path.join(ROOT, "backend/src/modules/wfm/wfm.validation.ts"), "utf8");

/** The POST body literal inside useSubmitRegularization. */
function submitBody(): string {
  const at = HOOK.indexOf("'/api/wfm/regularizations'");
  expect(at, "useSubmitRegularization no longer posts to /api/wfm/regularizations").toBeGreaterThan(-1);
  return HOOK.slice(at, at + 1400);
}

describe("regularization payload matches what the backend accepts", () => {
  it("sends camelCase keys, not snake_case", () => {
    const body = submitBody();
    expect(body).toMatch(/\breasonCode:/);
    expect(body).toMatch(/\brequestedStatus:/);
    // The exact shape of the original bug.
    expect(body, "snake_case keys are stripped by z.object and reach the DB as NULL")
      .not.toMatch(/\breason_code:/);
    expect(body).not.toMatch(/\brequested_status:/);
  });

  it("every key it sends is one the schema declares", () => {
    const body = submitBody();
    const sent = [...body.matchAll(/^\s{6,}([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map(m => m[1]);
    expect(sent.length, "no keys parsed out of the request body").toBeGreaterThan(3);
    for (const key of sent) {
      expect(SCHEMA, `"${key}" is not in regularizationSchema, so it will be silently dropped`)
        .toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });

  it("the schema still strips unknown keys, which is why the above matters", () => {
    // If this ever becomes .passthrough() or .strict() the failure mode changes:
    // strict would surface the mistake as a 400 instead of swallowing it.
    expect(SCHEMA).toMatch(/regularizationSchema\s*=\s*z\.object\(/);
    expect(SCHEMA.slice(SCHEMA.indexOf("regularizationSchema"), SCHEMA.indexOf("regularizationSchema") + 1500))
      .not.toMatch(/\.passthrough\(\)/);
  });
});
