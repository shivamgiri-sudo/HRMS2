/**
 * Proves why "Wait for backend health" in local-deployment-smoke.yml could never pass, and
 * that the replacement does.
 *
 * The stub below returns EXACTLY the payloads backend/src/routes/health.routes.ts returns —
 * GET /api/health is hardened to expose only {success, service, status, timestamp}, and it
 * returns 200 if and only if the DB ping succeeded and schema verification found nothing
 * pending. The old poll waited for `json.db === 'ok'` and `json.migrations.status === 'ok'`,
 * two fields that endpoint deliberately withholds, so it timed out against a backend that
 * was perfectly healthy.
 *
 * Run:  node scripts/verify-smoke-health-poll.cjs
 */
const http = require("node:http");

const HEALTHY = {
  success: true,
  service: "MCN HRMS Backend API",
  status: "healthy",
  timestamp: new Date().toISOString(),
};
const DEGRADED = { ...HEALTHY, success: false, status: "degraded" };

function startStub(healthy) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/health/live") {
        res.writeHead(200).end(JSON.stringify({ success: true, status: "alive" }));
        return;
      }
      if (req.url === "/api/health") {
        res.writeHead(healthy ? 200 : 503).end(JSON.stringify(healthy ? HEALTHY : DEGRADED));
        return;
      }
      res.writeHead(404).end("{}");
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

// The poll as it stood on main. Budget shortened from 120 s so the proof is quick; the
// failure mode is identical at any budget because the fields never appear.
async function oldPoll(base, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + "/api/health");
      if (res.ok) {
        const json = JSON.parse(await res.text());
        if (
          json?.db === "ok" &&
          json?.migrations?.status === "ok" &&
          Array.isArray(json?.migrations?.failed) &&
          json.migrations.failed.length === 0
        ) {
          return { ok: true };
        }
      }
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, reason: "timed out" };
}

// The replacement: a 200 already means db ok AND schema valid.
async function newPoll(base, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let sawLive = false;
  while (Date.now() < deadline) {
    try {
      if (!sawLive) {
        const live = await fetch(base + "/api/health/live");
        if (live.status === 200) sawLive = true;
      }
      const res = await fetch(base + "/api/health");
      if (res.status === 200) return { ok: true, sawLive };
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, sawLive, reason: sawLive ? "alive but degraded" : "never alive" };
}

async function main() {
  const results = [];

  // Case 1 — a genuinely healthy backend. This is the regression: old fails, new passes.
  {
    const { server, port } = await startStub(true);
    const base = `http://127.0.0.1:${port}`;
    const oldResult = await oldPoll(base, 1500);
    const newResult = await newPoll(base, 1500);
    server.close();
    results.push(["healthy backend", "old poll", oldResult.ok, false]);
    results.push(["healthy backend", "new poll", newResult.ok, true]);
  }

  // Case 2 — degraded backend (503). The new poll must still fail, or it is not a gate.
  {
    const { server, port } = await startStub(false);
    const base = `http://127.0.0.1:${port}`;
    const newResult = await newPoll(base, 1000);
    server.close();
    results.push(["degraded backend (503)", "new poll", newResult.ok, false]);
    results.push([
      "degraded backend (503)",
      "new poll distinguishes alive-but-degraded",
      newResult.reason === "alive but degraded",
      true,
    ]);
  }

  // Case 3 — nothing listening. The message must name the boot failure, not the schema.
  {
    const newResult = await newPoll("http://127.0.0.1:1", 600);
    results.push(["no listener", "new poll", newResult.ok, false]);
    results.push(["no listener", "new poll reports never-alive", newResult.reason === "never alive", true]);
  }

  let failed = 0;
  for (const [scenario, what, actual, expected] of results) {
    const pass = actual === expected;
    if (!pass) failed++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${scenario} :: ${what} -> ${actual} (expected ${expected})`);
  }
  console.log(failed === 0 ? "\nAll assertions held." : `\n${failed} assertion(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
