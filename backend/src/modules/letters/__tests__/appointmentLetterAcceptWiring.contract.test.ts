/**
 * The accept flow is only real if every piece is joined up. Each of these is a
 * seam that was broken before (the emailed link 404'd because nothing served it),
 * pinned against source text because none is visible to the type checker.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptUrl, mintAcceptToken, looksLikeToken, sha256Hex } from "../appointmentLetterAcceptToken.js";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("accept token", () => {
  it("is 192 bits of hex and only its SHA-256 is stored", () => {
    const { token, tokenHash } = mintAcceptToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(tokenHash).toBe(sha256Hex(token));
    expect(looksLikeToken(token)).toBe(true);
  });

  it("builds the exact path the SPA routes", () => {
    expect(acceptUrl("https://mcnhrms.teammas.in/", "abc")).toBe("https://mcnhrms.teammas.in/employee/appointment-letter/abc");
    const route = read("../src/config/routes/public.routes.tsx");
    expect(route).toContain('path="/employee/appointment-letter/:token"');
  });
});

describe("issuance", () => {
  const issue = strip(read("src/modules/letters/appointmentLetterIssue.service.ts"));

  it("stores an accept hash separate from the verification hash, and emails the ACCEPT token", () => {
    expect(issue).toContain("accept_token_hash");
    expect(issue).toContain("mintAcceptToken()");
    expect(issue).toContain("acceptUrl: acceptUrl(frontendBaseUrl(), acceptToken)");
    // The verification token is for the QR and the public verifier only.
    expect(issue).not.toMatch(/employee\/appointment-letter\/\$\{token\}/);
  });

  it("the email template omits the verification paragraph when no verification link is supplied", async () => {
    const { buildAppointmentLetterEmailHtml } = await import("../appointmentLetterIssue.service.js");
    const base = {
      employeeName: "A", letterNumber: "MCN-AL-1", designation: "X", dateOfJoining: "1 Jan 2026",
      acceptUrl: "https://h/employee/appointment-letter/t",
    };
    expect(buildAppointmentLetterEmailHtml({ ...base, verifyUrl: null })).not.toContain("Anyone can confirm");
    const withVerify = buildAppointmentLetterEmailHtml({ ...base, verifyUrl: "https://h/verify/appointment/v" });
    expect(withVerify).toContain("https://h/verify/appointment/v");
    expect(withVerify).toContain('href="https://h/employee/appointment-letter/t"');
  });
});

describe("mounting", () => {
  it("the public router has no auth middleware of its own and is mounted in app.ts (order covered by publicRouteMountOrder)", () => {
    const routes = strip(read("src/modules/letters/appointmentLetterPublic.routes.ts"));
    expect(routes).not.toMatch(/requireAuth|requireRole/);
    expect(read("src/app.ts")).toContain('app.use("/api/public/appointment-letter", publicAppointmentLetterRouter);');
  });

  it("exposes exactly session, file and start — and rate-limits the billed one", () => {
    const routes = strip(read("src/modules/letters/appointmentLetterPublic.routes.ts"));
    const verbs = [...routes.matchAll(/publicAppointmentLetterRouter\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(verbs.sort()).toEqual(["get /:token/file", "get /:token/session", "post /:token/start"]);
    expect(routes).toMatch(/post\("\/:token\/start", startLimiter/);
  });

  it("marks every response as private (the URL carries a bearer token)", () => {
    const routes = strip(read("src/modules/letters/appointmentLetterPublic.routes.ts"));
    expect(routes).toContain('"Cache-Control", "no-store"');
    expect((routes.match(/privateResponse\(res\)/g) ?? []).length).toBe(3);
  });
});

describe("HR routes", () => {
  const routes = read("src/modules/letters/appointmentLetter.routes.ts");
  const handler = (lit: string) => {
    const start = routes.indexOf(lit);
    expect(start, `${lit} missing`).toBeGreaterThan(-1);
    const next = routes.indexOf("\nrouter.", start);
    return routes.slice(start, next === -1 ? undefined : next);
  };

  it.each(['"/appointment-letters/:issueId/resend-link"', '"/appointment-letters/:issueId/esign/check"'])(
    "%s is issuer-only and branch-scoped",
    (lit) => {
      const h = handler(lit);
      expect(h).toContain("requireRole(...ISSUE_ROLES)");
      expect(h).toContain("issuedLetterInScope(req");
      expect(h).toContain("OUT_OF_SCOPE");
    },
  );

  it("the issued-letter list carries the acceptance timestamp for the queue drawer", () => {
    expect(routes).toContain("i.employee_esign_at");
  });
});

describe("status sync is hooked into the existing provider paths, additively", () => {
  it("luckpay syncEsignStatus falls back to the appointment-letter table only when the joining-document lookup misses", () => {
    const src = strip(read("src/modules/integrations/luckpay/luckpay-status.service.ts"));
    const miss = src.indexOf("if (!row) {");
    const fallback = src.indexOf("syncAppointmentEsignByClientTransaction(");
    const kitBranch = src.search(/String\(row\.scope \?\? "document"\) === "kit"/);
    expect(miss).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(miss);
    expect(fallback).toBeLessThan(kitBranch);
  });

  it("the joining-document webhook falls back the same way, on a miss only", () => {
    const src = strip(read("src/modules/employees/employeeJoiningDocuments.service.ts"));
    const at = src.indexOf("syncAppointmentEsignByClientTransaction(");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at - 400, at + 100)).toContain("if (!tx)");
  });

  it("the reconciliation worker also pulls appointment sessions, after its own batch, without changing its budget constants", () => {
    const src = strip(read("src/workers/esign-reconciliation.worker.ts"));
    expect(src.lastIndexOf("reconcileAppointmentEsigns")).toBeGreaterThan(src.indexOf("void runEsignReconciliationOnce()"));
    expect(src).toContain("const BATCH_SIZE = 25;");
    expect(src).toContain("const TICK_MS = 5 * 60 * 1000;");
    expect(src).toContain("const BACKOFF_MINUTES = [2, 10, 30, 60, 60, 60];");
  });

  it("appointment sessions are NOT stored in the joining-document transaction table", () => {
    const svc = strip(read("src/modules/letters/appointmentLetterEsign.service.ts"));
    expect(svc).not.toContain("employee_document_esign_transaction");
    expect(svc).toContain("appointment_letter_esign_transaction");
  });
});

describe("migration 1858", () => {
  const sql = read("sql/1858_appointment_letter_accept_flow.sql");

  it("is additive and replay-safe", () => {
    expect(sql).toMatch(/INFORMATION_SCHEMA\.COLUMNS/);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS appointment_letter_esign_transaction");
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|RENAME/i);
  });

  it("gives the accept token a UNIQUE column that is NULL for pre-existing letters", () => {
    expect(sql).toContain("ADD COLUMN accept_token_hash CHAR(64) NULL");
    expect(sql).toContain("ADD UNIQUE KEY uq_ali_accept (accept_token_hash)");
  });

  it("allows one live session per letter", () => {
    expect(sql).toContain("UNIQUE KEY uq_alet_issue_open (issue_id, open_marker)");
    expect(sql).toContain("UNIQUE KEY uq_alet_client_txn (provider, client_transaction_id)");
  });
});
