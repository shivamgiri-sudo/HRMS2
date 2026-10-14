/*
 * Idempotent Uptime Kuma setup for HRMS. Runs inside the uptime-kuma container (it already ships
 * socket.io-client), so the server needs nothing extra:
 *
 *   docker compose exec -T -e KUMA_USER=admin -e KUMA_PASSWORD=... -e HRMS_URL=https://... \
 *       uptime-kuma node - < kuma_provision.cjs
 *
 * Optional env:
 *   HRMS_API_INTERNAL  e.g. http://host.docker.internal:5055  (checks the API without nginx)
 *   MYSQL_HOST/PORT    e.g. host.docker.internal / 3306       (TCP check that MySQL is listening)
 *   KUMA_WEBHOOK_URL   a webhook that receives every alert (Teams/Slack/Google Chat/n8n-style)
 *
 * Prints "PUSH workers <url>": put it in HRMS backend env as UPTIME_KUMA_WORKERS_PUSH_URL so the
 * workers process reports in every minute; if it stops, Uptime Kuma alerts.
 */
const { io } = require("/app/node_modules/socket.io-client");

const USER = process.env.KUMA_USER || "admin";
const PASS = process.env.KUMA_PASSWORD;
const HRMS = (process.env.HRMS_URL || "https://mcnhrms.teammas.in").replace(/\/$/, "");
const API_INTERNAL = (process.env.HRMS_API_INTERNAL || "").replace(/\/$/, "");
const MYSQL_HOST = process.env.MYSQL_HOST || "";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const WEBHOOK = process.env.KUMA_WEBHOOK_URL || "";
if (!PASS) { console.error("KUMA_PASSWORD is required"); process.exit(2); }

let socket;
const call = (event, ...args) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${event} timed out`)), event === "needSetup" ? 5000 : 20000);
  socket.emit(event, ...args, (res) => { clearTimeout(t); resolve(res); });
});
const once = (event) => new Promise((resolve) => socket.once(event, resolve));

const base = {
  interval: 60, retryInterval: 60, maxretries: 2, resendInterval: 0, timeout: 30,
  upsideDown: false, ignoreTls: false, maxredirects: 10, method: "GET",
  accepted_statuscodes: ["200-299"], notificationIDList: {}, conditions: [],
  kafkaProducerBrokers: [], kafkaProducerSaslOptions: { mechanism: "None" }, rabbitmqNodes: [],
  expiryNotification: false, active: true,
};

function monitors() {
  const list = [
    { name: "HRMS website", type: "keyword", url: `${HRMS}/auth`, keyword: "Mas Callnet", expiryNotification: true,
      description: "Login page loads and contains the brand text. Also alerts 14/7 days before the TLS certificate expires." },
    { name: "HRMS API health (DB + schema)", type: "keyword", url: `${HRMS}/api/health`, keyword: "\"healthy\"",
      description: "Public /api/health. Goes down if MySQL is unreachable or the schema check fails." },
    { name: "HRMS API ready (DB)", type: "http", url: `${HRMS}/api/health/ready`,
      description: "Returns 503 when the API cannot reach MySQL." },
    { name: "HRMS schema: no pending migrations", type: "json-query", url: `${HRMS}/api/health/version`,
      jsonPath: "schema.pending", jsonPathOperator: "==", expectedValue: "0", interval: 300,
      description: "Code and database are from the same release. Non-zero = a deploy left migrations unapplied." },
  ];
  if (API_INTERNAL) {
    list.push({ name: "HRMS API (direct, bypassing nginx)", type: "http", url: `${API_INTERNAL}/api/health/live`,
      description: "If this is up but the public checks are down, the problem is nginx/network, not the API." });
  }
  if (MYSQL_HOST) {
    list.push({ name: "HRMS MySQL port", type: "port", hostname: MYSQL_HOST, port: MYSQL_PORT, url: "https://",
      description: "MySQL is accepting TCP connections." });
  }
  list.push({ name: "HRMS workers heartbeat", type: "push", interval: 120, retryInterval: 60, maxretries: 1, url: "https://",
    pushToken: require("crypto").randomBytes(16).toString("hex").slice(0, 32),
    description: "hrms2-workers calls the push URL every 60s. Missing for 2 minutes = background jobs (payroll sync, crons) stopped." });
  list.push({ name: "GlitchTip (error tracking)", type: "http", url: "http://gt-web:8000/_health/", interval: 120,
    description: "The error-tracking server itself." });
  return list;
}

// Uptime Kuma 2 starts with a one-time "choose a database" page; answer it with SQLite.
async function setupDatabase() {
  const info = await fetch("http://127.0.0.1:3001/setup-database-info").then((r) => r.json()).catch(() => null);
  if (!info || !info.needSetup) return;
  const r = await fetch("http://127.0.0.1:3001/setup-database", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dbConfig: { type: "sqlite" } }),
  });
  if (!r.ok) throw new Error(`database setup failed: HTTP ${r.status}`);
  console.log("CREATED kuma database (sqlite)");
  // The main server restarts after setup; wait until it answers the socket endpoint.
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const again = await fetch("http://127.0.0.1:3001/setup-database-info").then((x) => x.json()).catch(() => null);
    if (!again) continue;               // restarting
    if (again.needSetup === false) return;
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = io("http://127.0.0.1:3001", { transports: ["websocket"], reconnection: false });
    s.once("connect", () => resolve(s));
    s.once("connect_error", (e) => reject(new Error(`cannot connect to Uptime Kuma: ${e.message}`)));
  });
}

(async () => {
  await setupDatabase();
  // Right after the database step the server restarts; a socket opened during that window never
  // answers. Reconnect until "needSetup" gets a reply.
  let lastErr, needSetup;
  for (let i = 0; i < 20; i++) {
    try {
      socket = await connect();
      needSetup = await call("needSetup");
      break;
    } catch (e) {
      lastErr = e;
      if (socket) socket.close();
      socket = undefined;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!socket) throw lastErr;
  if (needSetup) {
    const r = await call("setup", USER, PASS);
    if (!r.ok) throw new Error(`setup failed: ${r.msg}`);
    console.log("CREATED kuma admin", USER);
  }
  const monitorListP = once("monitorList");
  const notifListP = once("notificationList");
  const login = await call("login", { username: USER, password: PASS, token: "" });
  if (!login.ok) throw new Error(`login failed: ${login.msg}`);
  const existing = Object.values(await monitorListP);
  const notifs = await notifListP;

  let notifId = null;
  if (WEBHOOK) {
    const found = notifs.find((n) => n.name === "HRMS alerts webhook");
    const cfg = { name: "HRMS alerts webhook", type: "webhook", webhookURL: WEBHOOK, webhookContentType: "json",
      isDefault: true, applyExisting: true, active: true };
    const r = await call("addNotification", cfg, found ? found.id : null);
    if (!r.ok) throw new Error(`notification failed: ${r.msg}`);
    notifId = r.id;
    console.log(found ? "UPDATED" : "CREATED", "notification webhook");
  }

  for (const m of monitors()) {
    const prev = existing.find((e) => e.name === m.name);
    if (prev) {
      console.log("EXISTS monitor", m.name);
      if (m.type === "push") console.log("PUSH workers", `${process.env.KUMA_PUBLIC_URL || "http://127.0.0.1:3001"}/api/push/${prev.pushToken}?status=up&msg=OK&ping=`);
      continue;
    }
    const body = { ...base, ...m };
    if (notifId) body.notificationIDList = { [notifId]: true };
    const r = await call("add", body);
    if (!r.ok) throw new Error(`add ${m.name} failed: ${r.msg}`);
    console.log("CREATED monitor", m.name);
    if (m.type === "push") console.log("PUSH workers", `${process.env.KUMA_PUBLIC_URL || "http://127.0.0.1:3001"}/api/push/${m.pushToken}?status=up&msg=OK&ping=`);
  }
  socket.close();
  process.exit(0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
