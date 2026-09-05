/**
 * There is exactly ONE localStorage key for the auth token, and everything must use it.
 *
 * hrmsApi.ts writes "hrms_access_token" on login, reads it on every request and clears it on
 * logout. Two files instead read "hrms_token" — a key that has never existed — so every request
 * they made sent `Authorization: Bearer null`:
 *
 *   PayrollReadinessDashboard.tsx  eleven calls through its own apiFetch() helper: the branch
 *                                  detail drawer, process checklist and sign-off, request-freeze,
 *                                  and the HO OVERRIDE — the control that unblocks a branch whose
 *                                  readiness cannot otherwise pass, and the documented way to get
 *                                  a branch's payroll moving. A button that silently could not
 *                                  work, on the page whose job is to gate payroll.
 *   NativeEngagement.tsx           the CSV export, which failed with "Export failed" — a message
 *                                  describing the symptom and hiding the cause.
 *
 * The readiness page still LOOKED alive because its branch list goes through hrmsApi with the
 * correct key. Only the parts using the local helper were dead, which is why this survived: the
 * page rendered, the numbers were right, and the actions quietly did nothing.
 *
 * A wrong key cannot fail loudly — it produces a well-formed request with a bad credential, and
 * the server correctly refuses it. So the spelling has to be enforced here.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The one true key, taken from the client that owns the token's lifecycle. */
const CANONICAL = "hrms_access_token";

/**
 * Genuinely different credentials, not misspellings of the access token.
 *
 * hrms_refresh_token is its own thing with its own lifecycle — AuthContext and hrmsApi both use
 * it deliberately, to mint a new access token. Sweeping it up here would force a real key to be
 * renamed to satisfy a test, which is the wrong way round.
 */
const OTHER_REAL_KEYS = new Set(["hrms_refresh_token"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

describe("the auth token key is spelled one way", () => {
  it("is the key hrmsApi actually writes", () => {
    // If the client ever renames it, this test should fail first rather than every caller
    // silently starting to send null.
    const api = fs.readFileSync(path.join(SRC, "lib/hrmsApi.ts"), "utf8");
    expect(api).toContain(`localStorage.setItem("${CANONICAL}"`);
    expect(api).toContain(`localStorage.getItem("${CANONICAL}")`);
  });

  it("no file reads a different hrms_* token key", () => {
    /*
     * Deliberately matches any hrms_*token* spelling rather than just the one that bit us —
     * "hrms_token", "hrms_jwt", "hrms_auth_token" would all fail exactly the same way, and the
     * failure is invisible: a well-formed request with a bad credential.
     */
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      const matches = src.match(/localStorage\.(getItem|setItem|removeItem)\(\s*["'](hrms_[A-Za-z0-9_]*token[A-Za-z0-9_]*)["']/g) ?? [];
      for (const m of matches) {
        const key = /["'](hrms_[A-Za-z0-9_]*token[A-Za-z0-9_]*)["']/.exec(m)?.[1];
        if (key && key !== CANONICAL && !OTHER_REAL_KEYS.has(key)) offenders.push(`${rel(f)} -> ${key}`);
      }
    }
    expect(
      offenders,
      `These read an auth-token key that is not "${CANONICAL}". A wrong key does not throw — it ` +
        `sends "Bearer null" and the server correctly refuses, so the feature just quietly stops ` +
        `working:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the readiness page's own fetch helper uses it", () => {
    // This helper carries eleven calls including the HO override, so it is worth naming directly
    // rather than trusting the sweep above to keep covering it.
    const page = fs.readFileSync(path.join(SRC, "pages/payroll/PayrollReadinessDashboard.tsx"), "utf8");
    const idx = page.indexOf("async function apiFetch(");
    expect(idx, "apiFetch not found").toBeGreaterThan(-1);
    expect(page.slice(idx, idx + 400)).toContain(`localStorage.getItem("${CANONICAL}")`);
  });
});
