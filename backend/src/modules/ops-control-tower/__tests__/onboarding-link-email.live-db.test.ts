// Opt-in integration test (E2E_DB=1): real MySQL schema (migration replay), real SMTP over a local sink socket,
// the real ops router, the real emailer and the real public token validator. No mocks except auth.
//
//   docker run -d --name mailtest-mysql -e MYSQL_ROOT_PASSWORD=pw -p 127.0.0.1:33997:3306 mysql:8.0
//   DB_HOST=127.0.0.1 DB_PORT=33997 DB_USER=root DB_PASSWORD=pw DB_NAME=mas_hrms TEST_DB_NAME=mas_hrms_ci_replay_test \
//     npm run migrate:fresh:test -- --allow-destructive-test-db     # (stops at 272; the ATS tables exist by then)
//   E2E_DB=1 DB_HOST=127.0.0.1 DB_PORT=33997 DB_USER=root DB_PASSWORD=pw DB_NAME=mas_hrms_ci_replay_test \
//     npx vitest run src/modules/ops-control-tower/__tests__/onboarding-link-email.live-db.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

const RUN = process.env.E2E_DB === "1";

// tests/setup.ts stubs the database globally; this file needs the real driver.
vi.mock("../../../db/mysql.js", async () => await vi.importActual("../../../db/mysql.js"));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _r: unknown, next: () => void) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: unknown, _r: unknown, next: () => void) => next() }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  DashboardScopeConfigurationError: class extends Error {},
  resolveDashboardScopeForRequest: vi.fn(async () => ({ level: "ORG_ALL", branchIds: [] })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(async () => true) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));

const mails: Array<{ to: string; data: string }> = [];
let sink: net.Server | null = null;
const sockets = new Set<net.Socket>();
const SMTP_PORT = 25251;

function startSink(): Promise<void> {
  return new Promise((resolve) => {
    sink = net.createServer((sock) => {
      sockets.add(sock); sock.on("close", () => sockets.delete(sock));
      let rcpt = ""; let data = ""; let inData = false; let buf = "";
      sock.write("220 sink ESMTP\r\n");
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (inData) {
            if (line === ".") { inData = false; mails.push({ to: rcpt, data }); data = ""; sock.write("250 OK queued\r\n"); } else data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
            continue;
          }
          const u = line.toUpperCase();
          if (u.startsWith("EHLO")) sock.write("250-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
          else if (u.startsWith("AUTH PLAIN")) sock.write("235 ok\r\n");
          else if (u.startsWith("AUTH LOGIN")) sock.write("334 VXNlcm5hbWU6\r\n");
          else if (u.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
          else if (u.startsWith("RCPT TO")) { rcpt = /<([^>]+)>/.exec(line)?.[1] ?? ""; sock.write("250 ok\r\n"); }
          else if (u === "DATA") { inData = true; sock.write("354 go\r\n"); }
          else if (u === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
          else if (/^[A-Za-z0-9+/=]+$/.test(line)) sock.write(line.length < 20 ? "334 UGFzc3dvcmQ6\r\n" : "235 ok\r\n");
          else sock.write("250 ok\r\n");
        }
      });
    });
    sink.listen(SMTP_PORT, "127.0.0.1", () => resolve());
  });
}
// net.Server has no closeAllConnections: pooled mailers keep sockets open, so destroy them or close() never returns.
const stopSink = () => new Promise<void>((r) => {
  if (!sink) return r();
  const s = sink; sink = null;
  s.close(() => r());
  for (const sock of sockets) sock.destroy();
});

function decodeMail(data: string): string {
  // quoted-printable / base64 bodies: decode enough to find the link
  const qp = data.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  return qp;
}

describe.skipIf(!RUN)("Ops Email link — real DB + real SMTP + real router", () => {
  let app: express.Express;
  let db: any; let validateOnboardingToken: (t: string) => Promise<any>;
  const ids = { branch: randomUUID(), emp: randomUUID(), cand: randomUUID(), emp2: randomUUID(), cand2: randomUUID(), emp3: randomUUID() };
  const tok = { a: `live-${randomUUID()}`, b: `live-${randomUUID()}` };
  const code = () => `E2E${Math.floor(Math.random() * 1e9)}`;

  beforeAll(async () => {
    process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(SMTP_PORT);
    process.env.SMTP_USER = "tester"; process.env.SMTP_PASS = "secret"; process.env.SMTP_FROM = "hr@test.local";
    process.env.FRONTEND_URL = "https://hrms.test";
    await startSink();
    ({ db } = await import("../../../db/mysql.js"));
    ({ validateOnboardingToken } = await import("../../ats/onboarding-full.service.js"));
    const { opsControlTowerRouter } = await import("../ops-control-tower.routes.js");
    app = express(); app.use(express.json()); app.use("/api/ops-control-tower", opsControlTowerRouter);

    await db.execute("INSERT INTO branch_master (id, branch_code, branch_name) VALUES (?, ?, ?)", [ids.branch, code(), "E2E Branch"]);
    const mk = async (empId: string, candId: string, opts: { email: string | null; token: string | null; expires: Date | null }) => {
      await db.execute("INSERT INTO employees (id, employee_code, first_name, last_name, date_of_joining, branch_id, mobile) VALUES (?,?,?,?,CURDATE(),?,?)",
        [empId, code(), "Asha", "Rao", ids.branch, "9999999999"]);
      await db.execute("INSERT INTO ats_candidate (id, candidate_code, full_name, mobile, email, applied_for_branch) VALUES (?,?,?,?,?,?)",
        [candId, code(), "Asha Rao", "9999999999", opts.email, ids.branch]);
      await db.execute("INSERT INTO ats_onboarding_bridge (id, candidate_id, employee_id, bridge_date, status, onboarding_token, onboarding_token_expires_at) VALUES (UUID(),?,?,CURDATE(),'pending',?,?)",
        [candId, empId, opts.token, opts.expires]);
    };
    await mk(ids.emp, ids.cand, { email: "asha@example.com", token: tok.a, expires: new Date(Date.now() + 5 * 86_400_000) });
    await mk(ids.emp2, ids.cand2, { email: null, token: tok.b, expires: new Date(Date.now() + 5 * 86_400_000) });
    await db.execute("INSERT INTO employees (id, employee_code, first_name, last_name, date_of_joining, branch_id) VALUES (?,?,?,?,CURDATE(),?)", [ids.emp3, code(), "Ravi", "K", ids.branch]);
  });

  afterAll(async () => {
    await stopSink();
    await db?.execute("DELETE FROM ats_email_log WHERE candidate_id IN (?,?)", [ids.cand, ids.cand2]).catch(() => undefined);
    await db?.execute("DELETE FROM ats_onboarding_bridge WHERE candidate_id IN (?,?)", [ids.cand, ids.cand2]).catch(() => undefined);
    await db?.execute("DELETE FROM employees WHERE id IN (?,?,?)", [ids.emp, ids.emp2, ids.emp3]).catch(() => undefined);
    await db?.execute("DELETE FROM ats_candidate WHERE id IN (?,?)", [ids.cand, ids.cand2]).catch(() => undefined);
    await db?.execute("DELETE FROM branch_master WHERE id = ?", [ids.branch]).catch(() => undefined);
    await db?.end?.().catch?.(() => undefined);
  });

  const post = (employeeId: string) => request(app).post("/api/ops-control-tower/onboarding-link/email").send({ employeeId, issue: "docs-pending" });

  it("sends a real SMTP message whose link carries a token the public validator accepts", async () => {
    const res = await post(ids.emp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: "sent", sentTo: "asha@example.com" });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("asha@example.com");
    const body = decodeMail(mails[0].data);
    const m = /https:\/\/hrms\.test\/onboard-full\?token=([0-9a-zA-Z-]+)/.exec(body);
    expect(m, body.slice(0, 600)).toBeTruthy();
    expect(m![1]).toBe(tok.a);
    const profile = await validateOnboardingToken(m![1]);
    expect(profile.candidate_id).toBe(ids.cand);
    const [log] = await db.execute("SELECT status, sent_to FROM ats_email_log WHERE candidate_id = ?", [ids.cand]);
    expect((log as any[])[0]).toMatchObject({ status: "sent", sent_to: "asha@example.com" });
  });

  it("expired token is re-issued in the real table and the NEW emailed link validates", async () => {
    await db.execute("UPDATE ats_onboarding_bridge SET onboarding_token_expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE candidate_id = ?", [ids.cand]);
    mails.length = 0;
    const res = await post(ids.emp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const token = /token=([0-9a-zA-Z-]+)/.exec(decodeMail(mails[0].data))![1];
    expect(token).not.toBe(tok.a);
    expect((await validateOnboardingToken(token)).candidate_id).toBe(ids.cand);
    await expect(validateOnboardingToken(tok.a)).rejects.toThrow("Invalid onboarding token");
    expect(decodeMail(mails[0].data)).toContain("valid for 3 days");
  });

  it("candidate with no email: 409 and nothing sent", async () => {
    mails.length = 0;
    const res = await post(ids.emp2);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email/i);
    expect(mails).toHaveLength(0);
  });

  it("employee with no onboarding record: 409, nothing sent", async () => {
    mails.length = 0;
    const res = await post(ids.emp3);
    expect([409]).toContain(res.status);
    expect(mails).toHaveLength(0);
  });

  it("HR 'Resend link' (Onboarding Requests page): real mail goes out and the response says so", async () => {
    const { sendOnboardingToken } = await import("../../ats/ats.onboarding.service.js");
    mails.length = 0;
    const out = await sendOnboardingToken(ids.cand, "u1");
    expect(out.emailSent).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("asha@example.com");
    const token = /token=([0-9a-zA-Z-]+)/.exec(decodeMail(mails[0].data))![1];
    expect((await validateOnboardingToken(token)).candidate_id).toBe(ids.cand);
  });

  it("HR 'Resend link' with the mail server unreachable: reports emailSent=false instead of claiming success", async () => {
    await stopSink();
    const { sendOnboardingToken } = await import("../../ats/ats.onboarding.service.js");
    const out = await sendOnboardingToken(ids.cand, "u1");
    expect(out.emailSent).toBe(false);
    expect(out.emailError).toBeTruthy();
  }, 60_000);

  it("SMTP server down: honest 502 with the error, not a false success", async () => {
    await stopSink();
    const res = await post(ids.emp);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/could not be delivered/i);
  }, 40_000);
});
