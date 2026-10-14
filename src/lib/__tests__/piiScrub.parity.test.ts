import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as fe from "../piiScrub";
import * as be from "../../../backend/src/lib/piiScrub";

// The browser and the server scrub with two copies of the same module (they build separately).
// If they ever drift, a report could be clean on one path and leak on the other.
const FIXTURES: unknown[] = [
  "PAN ABCDE1234F, aadhaar 1234 5678 9012, ifsc HDFC0001234, mobile 9876543210, mail a.b@teammas.in",
  "/api/employees?search=Priya&branch=Noida",
  { pan: "ABCDE1234F", nested: { bankAccount: "0011223344", note: "+91 9876543210" }, ok: "fine" },
  [{ password: "x" }, "Bearer abcdefghijklmn", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk"],
];

describe("frontend and backend scrubbers are identical", () => {
  it("source bodies match (only the header comment differs)", () => {
    const body = (p: string) => readFileSync(resolve(__dirname, p), "utf8").split("\n").slice(22).join("\n");
    expect(body("../piiScrub.ts")).toBe(body("../../../backend/src/lib/piiScrub.ts"));
  });

  it.each(FIXTURES.map((f, i) => [i, f]))("fixture %i scrubs the same", (_i, f) => {
    expect(fe.scrubValue(f)).toEqual(be.scrubValue(f));
  });

  it("events scrub the same", () => {
    const event = {
      message: "failed for ABCDE1234F",
      request: { url: "/x?q=1", data: "secret", headers: { Cookie: "s=1", "User-Agent": "UA" } },
      user: { id: 7, email: "a@b.co" },
      breadcrumbs: [{ data: { url: "/y?pan=ABCDE1234F", body: "b" } }],
    };
    expect(fe.scrubEvent(event)).toEqual(be.scrubEvent(event));
  });
});
