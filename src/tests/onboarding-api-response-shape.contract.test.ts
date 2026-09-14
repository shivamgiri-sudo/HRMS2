import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * hrmsApi is not axios. `request()` returns the parsed JSON body directly, and
 * `buildApiError` throws an HrmsApiError carrying `.status` / `.payload` — it
 * never sets `.response`.
 *
 * Onboarding code was written against the axios shape anyway, and the mistakes
 * were invisible because both forms are `any`-ish at runtime:
 *
 *   res.data?.data?.checks   // always undefined -> penny-drop status never rendered
 *   err.response?.status     // always undefined -> every status branch dead code
 *
 * A response envelope is `{ success, data }`, so one `.data` reaches the payload
 * and a second one falls off the end. These assertions pin the correct shape for
 * the onboarding surface so the mistake cannot come back.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const TARGET_DIRS = [
  "src/components/onboarding-full",
  "src/components/onboarding-v2",
];
const TARGET_FILES = [
  "src/pages/CandidateOnboardingFullPage.tsx",
  "src/pages/CandidateOnboardingV2.tsx",
];

function collect(): string[] {
  const out: string[] = [];
  for (const dir of TARGET_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      if (/\.(ts|tsx)$/.test(entry)) out.push(path.join(dir, entry));
    }
  }
  for (const f of TARGET_FILES) {
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  return out;
}

/** Strips comments so prose describing the bug does not trip the assertions. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("onboarding hrmsApi response-shape contract", () => {
  const files = collect();

  it("has onboarding sources to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never reads a second .data off an hrmsApi response", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const src = code(rel);
      src.split("\n").forEach((line, i) => {
        // res.data.data / res.data?.data — the envelope only nests once.
        if (/\b\w+\.data\s*\??\.\s*data\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, "hrmsApi returns the body itself — one .data reaches the payload").toEqual([]);
  });

  it("never reads axios-style error.response off an hrmsApi rejection", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const src = code(rel);
      src.split("\n").forEach((line, i) => {
        if (/\b(err|error|e)\s*\??\.\s*response\s*\??\./.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, "HrmsApiError exposes .status and .payload, never .response").toEqual([]);
  });
});
