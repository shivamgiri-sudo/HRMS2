/**
 * No tracked file may carry a database password as a source literal.
 *
 * WHY THIS EXISTS
 *   On 2026-08-08 a scan found the live credentials in 79 tracked files — 44 documents, 34
 *   scripts, and one production worker that compiles into dist/ and runs under pm2. The
 *   repository is public, so those were readable by anyone, and the same value authenticates
 *   mas_hrms, dialer_db, db_bill and mcn_lms because all four share one password.
 *
 *   They were removed. This guard exists because of HOW they will come back. Rotating the
 *   password breaks every script that hardcodes it, and the fastest fix in the moment is to
 *   paste the new one in — which silently restores the whole exposure, one file at a time,
 *   with nobody noticing until the next audit.
 *
 *   src/db/__tests__/lms-mysql-no-hardcoded-fallback.test.ts already does this for a single
 *   file. This is the same idea across the repository.
 *
 * WHY IT SCANS SOURCE TEXT RATHER THAN CONNECTING
 *   Matching the repo's existing contract-test style: the goal is to catch a literal coming
 *   back, not to prove a connection works. It also has to run in CI, which has no .env and
 *   therefore cannot know the real values.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(process.cwd(), "..");

function trackedFiles(): string[] {
  return execFileSync("git", ["-C", REPO, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
}

function readIfSmall(rel: string): string | null {
  const abs = resolve(REPO, rel);
  try {
    if (statSync(abs).size > 2 * 1024 * 1024) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/**
 * The password that was leaked. Naming a fragment of it here is deliberate and is what the
 * existing lms-mysql guard already does: the value is public — it sat in 79 files of a
 * public repo and in five committed .env files — so this discloses nothing new, and it is
 * the only way to catch the exact string being pasted back after a rotation.
 *
 * When the credential is finally rotated, replace this fragment with one from the retired
 * value so the guard keeps protecting against the old one reappearing.
 */
const LEAKED_FRAGMENT = "qwersdfg";

const SOURCE_LIKE = /\.(ts|tsx|js|jsx|cjs|mjs|py|sh|bat|ps1|yml|yaml|sql|md|txt|example|json)$/i;

describe("the leaked password is not back in any tracked file", () => {
  it("appears in no tracked file", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (!SOURCE_LIKE.test(file)) continue;
      // This guard names the fragment, so it would otherwise flag itself.
      if (file.endsWith("no-hardcoded-credentials.contract.test.ts")) continue;
      if (file.endsWith("lms-mysql-no-hardcoded-fallback.test.ts")) continue;
      const content = readIfSmall(file);
      if (content && content.includes(LEAKED_FRAGMENT)) offenders.push(file);
    }

    expect(
      offenders,
      offenders.length
        ? `The leaked database password is back in ${offenders.length} tracked file(s):\n` +
          offenders.map((f) => `  ${f}`).join("\n") +
          `\n\nThis repository is public. Read the credential from the environment instead:\n` +
          `  JS   process.env.DB_PASSWORD      run with: node --env-file=backend/.env <script>\n` +
          `  py   os.environ["DB_PASSWORD"]\n` +
          `  sh   "\${DB_PASSWORD:?set it first}"\n` +
          `\nIf you are here because rotating the password broke a script, that is exactly the\n` +
          `trap this guard exists to stop — fix the script, do not paste the new value in.`
        : ""
    ).toEqual([]);
  });
});

describe("credential env reads do not fall back to a literal", () => {
  /**
   * `process.env.X_PASSWORD || 'something'` is how the leak survived in the vicidial worker:
   * the env read looked correct, and the literal behind it was easy to miss in review.
   *
   * SCOPED TO DATABASE PASSWORDS ON PURPOSE. The first draft also covered SECRET/TOKEN/
   * API_KEY and immediately flagged assessment.service.ts — which is CORRECT code: its
   * assessmentSecret() throws when NODE_ENV is production and falls back only in dev, and
   * env.ts separately FATALs on the known-insecure JWT_SECRET / PORTAL_JWT_SECRET /
   * OTP_HMAC_SECRET defaults. Flagging that would have made this guard noise, and a guard
   * that cries wolf is one people switch off — which is how 79 files happened.
   *
   * An empty-string fallback is fine — it fails closed, which is the point.
   */
  const FALLBACK = /(?:process\.env\.)?([A-Z0-9_]*(?:PASSWORD|PWD))\s*(?:\|\||\?\?)\s*(['"])([^'"]{4,})\2/g;

  /** Placeholders and obvious test values are not credentials. */
  const HARMLESS =
    /^(?:change[-_]?me|your[-_]|xxx+|example|dummy|placeholder|redacted|test[-_].*|.*[-_]test|secret|password|<.*>|\$\{.*\}|.*_here)$/i;

  it("no source file supplies a literal fallback for a database password", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (!/\.(ts|js|cjs|mjs)$/i.test(file)) continue;
      if (file.includes("__tests__") || /\.test\.[tj]s$/.test(file)) continue;
      if (file.endsWith("no-hardcoded-credentials.contract.test.ts")) continue;
      const content = readIfSmall(file);
      if (!content) continue;

      FALLBACK.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FALLBACK.exec(content)) !== null) {
        const [, key, , value] = m;
        if (HARMLESS.test(value)) continue;
        offenders.push(`${file}: ${key} falls back to a literal`);
      }
    }

    expect(
      offenders,
      offenders.length
        ? `A credential falls back to a hardcoded value:\n` +
          offenders.map((o) => `  ${o}`).join("\n") +
          `\n\nDrop the literal and fail loudly instead — see getDialerDb() in\n` +
          `backend/src/workers/apr-vicidial-sync.worker.ts for the shape:\n` +
          `  const pw = process.env.X_PASSWORD;\n` +
          `  if (!pw) throw new Error("X_PASSWORD is not set, so <thing> cannot run.");\n` +
          `\nAn empty-string fallback is fine. A real value is not: it ships to a public repo.`
        : ""
    ).toEqual([]);
  });
});
