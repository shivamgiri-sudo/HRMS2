import { describe, expect, it } from "vitest";
import { parseResendRequest, maskEmailAddress, ResendInputError } from "../appointmentLetterResendRecipients.js";

const ok = "Employee lost access to inbox";
const parse = (recipients: unknown, reason: unknown = ok) => parseResendRequest({ recipients, reason });

describe("parseResendRequest", () => {
  it.each([undefined, null, {}, [], "text", { reason: ok }])("treats %j as the classic one-click resend", (body) => {
    expect(parseResendRequest(body)).toBeNull();
  });

  it("normalises: trims and lowercases", () => {
    expect(parse(["  New.Person@Gmail.COM "])).toEqual({ recipients: ["new.person@gmail.com"], reason: ok });
  });

  it("accepts up to 3 addresses", () => {
    expect(parse(["a@x.com", "b@x.com", "c@x.com"])?.recipients).toHaveLength(3);
  });

  it("rejects 0 and 4+ addresses", () => {
    expect(() => parse([])).toThrow(/at least one/i);
    expect(() => parse(["a@x.com", "b@x.com", "c@x.com", "d@x.com"])).toThrow(/at most 3/i);
  });

  it("rejects a non-array recipients value", () => {
    expect(() => parse("a@x.com")).toThrow(ResendInputError);
  });

  it.each([
    "plainaddress", "no-at.example.com", "@x.com", "a@", "a@x", "a@.com", "a@x..com", "a b@x.com",
    "a@x.com, b@x.com", "a@x.com;b@x.com", "<a@x.com>", '"a"@x.com', "a..b@x.com", ".a@x.com", "a@-x.com",
    "a@x.com>", "a@@x.com", "a\\@x.com",
  ])("rejects malformed address %j", (bad) => {
    expect(() => parse([bad])).toThrow(ResendInputError);
  });

  it.each([
    "a@x.com\r\nBcc: attacker@evil.com", "a@x.com\n", "a@x.com\r", "a@x.com\u0000", "a\t@x.com", "a@x.com ",
  ])("rejects header-injection / control characters %j (even when trim() would hide them)", (bad) => {
    expect(() => parse([bad])).toThrow(/invalid characters/);
  });

  it("rejects non-string entries", () => {
    expect(() => parse([42])).toThrow(/must be text/);
    expect(() => parse([null])).toThrow(/must be text/);
  });

  it("enforces the 254 character limit", () => {
    const long = `${"a".repeat(60)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.com`;
    expect(long.length).toBeGreaterThan(200);
    expect(() => parse([`${"a".repeat(245)}@x.com`])).toThrow(/254|valid/);
    expect(() => parse([`${"a".repeat(65)}@x.com`])).toThrow(/valid/); // local part > 64
  });

  it("rejects duplicates, including ones that differ only by case or whitespace", () => {
    expect(() => parse(["a@x.com", " A@X.com"])).toThrow(/more than once/);
  });

  it.each([undefined, "", "   ", "short", "1234567"])("requires a reason of at least 8 characters (got %j)", (reason) => {
    expect(() => parseResendRequest({ recipients: ["a@x.com"], reason })).toThrow(/at least 8/);
  });

  it("counts the trimmed reason and caps it at 500", () => {
    expect(parse(["a@x.com"], "  12345678  ")?.reason).toBe("12345678");
    expect(() => parse(["a@x.com"], "x".repeat(501))).toThrow(/500/);
  });

  it("a 400 carries a readable message", () => {
    try { parse(["nope"]); } catch (e) { expect((e as ResendInputError).statusCode).toBe(400); }
  });
});

describe("maskEmailAddress", () => {
  it.each([
    ["jane@gmail.com", "j***@g***.com"],
    ["harsh@mas.in", "h***@m***.in"],
    ["a@b.co.in", "a***@b***.in"],
    ["x@localhost", "x***@l***"],
  ])("%s -> %s", (input, out) => {
    expect(maskEmailAddress(input)).toBe(out);
  });
  it("never throws on junk", () => {
    expect(maskEmailAddress("junk")).toBe("***@***");
  });
});
