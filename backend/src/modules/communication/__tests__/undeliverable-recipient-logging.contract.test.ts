/**
 * A recipient with no address must leave a trace.
 *
 * dispatchService skipped that case with a bare `continue`: no dispatch_log row,
 * no log line, nothing. So after the fact "we sent it" and "we had nowhere to
 * send it" were the same observation — the silent-failure shape this codebase
 * keeps producing. 173 of the 1,125 active employees have no usable email
 * (measured against live mas_hrms, 2026-08-09), and the charter requires every
 * state-changing action to be auditable.
 *
 * The distinction that matters, and the reason this is not simply "log more":
 *
 *   per RECIPIENT  — "this person cannot be reached" is a fact about a person
 *                    and belongs in the ledger, once per attempt.
 *   per PROCESS    — "this channel has no credentials" is one fact about the
 *                    system; the unconfigured-channel skip warns once per boot.
 *                    Writing that per message is exactly the 1,804 rows of noise
 *                    removed in 29af99cc.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, "../dispatch.service.ts"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("undeliverable recipients are recorded", () => {
  it("the no-contact branch records instead of silently continuing", () => {
    const at = code.indexOf("if (!contact)");
    expect(at, "no-contact branch missing").toBeGreaterThan(-1);
    const branch = code.slice(at, at + 400);
    expect(branch).toContain("recordUndeliverable");
  });

  it("writes a real dispatch_log row, marked failed with a reason", () => {
    const fn = code.slice(code.indexOf("private async recordUndeliverable"));
    const body = fn.slice(0, fn.indexOf("\n  private plainText"));
    expect(body).toContain("INSERT INTO dispatch_log");
    expect(body).toContain("'failed'");
    expect(body).toContain("error_message");
  });

  it("uses a marker that can never be mistaken for a destination", () => {
    // recipient_contact is varchar(100) NOT NULL, so it cannot be null and must
    // not carry anything a retry could dial or mail.
    const fn = code.slice(code.indexOf("private async recordUndeliverable"));
    expect(fn.slice(0, 1600)).toContain("'(no address)'");
  });

  it("is best-effort — the audit write must not abort the whole send loop", () => {
    // This runs for a send that already failed. If recording also fails, one
    // unreachable recipient must not cost everyone after them in the loop.
    const fn = code.slice(code.indexOf("private async recordUndeliverable"));
    const body = fn.slice(0, fn.indexOf("\n  private plainText"));
    expect(body).toContain("catch");
    expect(body).not.toMatch(/catch[\s\S]{0,120}throw/);
  });

  it("truncates the subject to the column width", () => {
    // subject is varchar(200) under STRICT_TRANS_TABLES; an over-long title
    // would throw on the very path meant to make a failure visible.
    const fn = code.slice(code.indexOf("private async recordUndeliverable"));
    expect(fn.slice(0, 1600)).toContain("slice(0, 200)");
  });

  it("does NOT record a row for the unconfigured-channel skip", () => {
    // That is a per-process fact and is warned once; a row per message would
    // rebuild the noise that fix removed.
    const at = code.indexOf("channelUnconfigured(channel)");
    const branch = code.slice(at, at + 220);
    expect(branch).toContain("failed.push");
    expect(branch, "channel-level skip must not write per-message rows").not.toContain("recordUndeliverable");
  });

  it("only the enum's own values are used for status and retention", () => {
    // dispatch_log.status is enum(queued,sent,delivered,opened,clicked,bounced,failed)
    // and retention_category is enum(critical,standard,routine).
    const fn = code.slice(code.indexOf("private async recordUndeliverable"));
    const body = fn.slice(0, fn.indexOf("\n  private plainText"));
    expect(body).toMatch(/'critical' : 'standard'/);
    expect(body).not.toMatch(/'skipped'|'undeliverable'/);
  });
});
