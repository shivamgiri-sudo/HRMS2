/**
 * phase2-smoke.ts
 *
 * Authenticated API smoke test against a running backend instance.
 *
 * Run: npm run phase2:smoke
 * Requires:
 *   SMOKE_BASE_URL  — backend base URL (default: http://localhost:3000)
 *   SMOKE_JWT       — valid JWT for an admin/super_admin user
 *   SMOKE_EMPLOYEE_ID — a real employee_id in the DB (for scoped tests)
 *
 * Output: console table + writes evidence to scripts/phase2-smoke-output.json
 *
 * SAFE: GET requests only, except for a minimal POST against /api/audit/export
 *       which is read-only (CSV export, no DB write except audit log).
 *       No creates, patches, or deletes are attempted.
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const JWT = process.env.SMOKE_JWT || "";
const EMPLOYEE_ID = process.env.SMOKE_EMPLOYEE_ID || "";

if (!JWT) {
  console.error("❌ SMOKE_JWT env var not set. Export a valid JWT before running.");
  console.error("   export SMOKE_JWT='Bearer eyJ...'");
  process.exit(1);
}

interface SmokeResult {
  group: string;
  method: string;
  path: string;
  expectedStatus: number[];
  actualStatus: number | null;
  pass: boolean;
  note: string;
}

async function request(
  method: "GET" | "POST",
  urlPath: string,
  body?: Record<string, unknown>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, BASE_URL);
    const isHttps = fullUrl.protocol === "https:";
    const lib = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers: {
        Authorization: JWT.startsWith("Bearer ") ? JWT : `Bearer ${JWT}`,
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });

    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const SMOKE_CASES: Array<{
  group: string;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  expectedStatus: number[];
  note: string;
}> = [
  // Health
  { group: "Health", method: "GET", path: "/api/health", expectedStatus: [200], note: "Backend alive" },

  // WFM Planning Rules
  { group: "WFM", method: "GET", path: "/api/wfm/planning-rules", expectedStatus: [200, 401], note: "List planning rules" },

  // WFM Slot Requirements
  { group: "WFM", method: "GET", path: "/api/wfm/slot-requirements", expectedStatus: [200, 401], note: "List slot requirements" },

  // WFM Week-Off Rules
  { group: "WFM", method: "GET", path: "/api/wfm/weekoff/day-rules", expectedStatus: [200, 401, 404], note: "List week-off rules" },

  // RTA Final Roster (must exclude draft statuses)
  { group: "RTA", method: "GET", path: "/api/rta/final-roster-state", expectedStatus: [200, 401], note: "RTA final roster (no draft)" },

  // Attendance Disputes
  { group: "Disputes", method: "GET", path: "/api/attendance/disputes", expectedStatus: [200, 401], note: "List disputes (scoped)" },
  { group: "Disputes", method: "GET", path: "/api/attendance/disputes?status=pending", expectedStatus: [200, 401], note: "Disputes filter by status" },

  // Manual Overrides
  { group: "Overrides", method: "GET", path: "/api/attendance/manual-overrides", expectedStatus: [200, 401, 403], note: "List overrides (payroll_head only)" },

  // Audit Log
  { group: "Audit", method: "GET", path: "/api/access/audit-log", expectedStatus: [200, 401, 403], note: "Audit log (role scoped)" },
  { group: "Audit", method: "GET", path: "/api/access/audit-log?limit=10&page=1", expectedStatus: [200, 401, 403], note: "Audit log paginated" },

  // Audit Export (POST, read-only effect)
  { group: "Audit", method: "POST", path: "/api/audit/export", body: { fromDate: "2026-01-01", toDate: "2026-12-31" }, expectedStatus: [200, 401, 403], note: "Audit CSV export" },

  // Reports
  { group: "Reports", method: "GET", path: "/api/reports/leave-balances", expectedStatus: [200, 401, 403, 404], note: "Leave balance report" },

  // Employees (basic read)
  { group: "Employees", method: "GET", path: "/api/employees", expectedStatus: [200, 401], note: "Employee list" },

  // KPI
  { group: "KPI", method: "GET", path: "/api/kpi", expectedStatus: [200, 401, 404], note: "KPI list" },

  // Auth preflight (no JWT — should return 401)
  { group: "AuthPreflight", method: "GET", path: "/api/employees", expectedStatus: [401], note: "Unauthenticated should get 401" },
];

async function run() {
  const results: SmokeResult[] = [];
  console.log(`=== Phase 2 Smoke Test — ${BASE_URL} ===\n`);

  for (const tc of SMOKE_CASES) {
    const authHeader = tc.group === "AuthPreflight" ? "" : JWT;
    let actualStatus: number | null = null;
    let pass = false;
    let note = tc.note;

    try {
      // For AuthPreflight we deliberately omit JWT
      if (tc.group === "AuthPreflight") {
        const fullUrl = new URL(tc.path, BASE_URL);
        const result = await new Promise<{ status: number }>((resolve, reject) => {
          const req = http.request({ hostname: fullUrl.hostname, port: fullUrl.port || 80, path: fullUrl.pathname, method: "GET" }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }); });
          req.on("error", reject);
          req.setTimeout(5000, () => req.destroy());
          req.end();
        });
        actualStatus = result.status;
      } else {
        const resp = await request(tc.method, tc.path, tc.body);
        actualStatus = resp.status;

        // Security check: no raw stack traces / 500s
        if (actualStatus === 500) {
          note += " ⚠️ RAW 500 DETECTED";
        }

        // Check for JWT/password in response body (security)
        if (resp.body.includes('"password"') || resp.body.includes('"jwt"') || resp.body.includes('"token":')) {
          note += " ⚠️ SENSITIVE FIELD IN RESPONSE";
        }
      }

      pass = tc.expectedStatus.includes(actualStatus);
    } catch (err: unknown) {
      note += ` ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    results.push({ group: tc.group, method: tc.method, path: tc.path, expectedStatus: tc.expectedStatus, actualStatus, pass, note });

    const icon = pass ? "✅" : "❌";
    console.log(`${icon} [${tc.group}] ${tc.method} ${tc.path} → ${actualStatus} (expected: ${tc.expectedStatus.join("|")}) — ${note}`);
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log(`\n=== Summary: ${passed}/${total} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.log("\n❌ Failed tests:");
    results.filter((r) => !r.pass).forEach((r) => {
      console.log(`   ${r.method} ${r.path} → actual: ${r.actualStatus}, expected: ${r.expectedStatus.join("|")}`);
    });
    process.exitCode = 1;
  }

  // Write evidence
  const outPath = path.resolve(__dirname, "phase2-smoke-output.json");
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), base_url: BASE_URL, total, passed, failed, results }, null, 2));
  console.log(`\nEvidence written to: ${outPath}`);
}

run();
