/*
 * Print the latest status of every Uptime Kuma monitor. Read-only.
 *   docker compose exec -T -e KUMA_USER=admin -e KUMA_PASSWORD=... uptime-kuma \
 *       sh -c 'cat > /tmp/ks.cjs; node /tmp/ks.cjs' < kuma_status.cjs
 * Exit code 0 = every active monitor is UP, 1 = at least one is DOWN/PENDING/unknown.
 */
const { io } = require("/app/node_modules/socket.io-client");
const s = io("http://127.0.0.1:3001", { transports: ["websocket"], reconnection: false });
const STATUS = { 0: "DOWN", 1: "UP", 2: "PENDING", 3: "MAINTENANCE" };
let monitors = {};
const latest = {};
s.on("monitorList", (m) => { monitors = m; });
s.on("heartbeatList", (id, list) => { if (list.length) latest[id] = list[list.length - 1]; });
s.on("heartbeat", (hb) => { latest[hb.monitorID] = hb; });
s.on("connect_error", (e) => { console.error("cannot connect:", e.message); process.exit(2); });
s.on("connect", () => {
  s.emit("login", { username: process.env.KUMA_USER || "admin", password: process.env.KUMA_PASSWORD, token: "" }, (r) => {
    if (!r.ok) { console.error("login failed:", r.msg); process.exit(2); }
    setTimeout(() => {
      let bad = 0;
      for (const m of Object.values(monitors).sort((a, b) => a.id - b.id)) {
        if (!m.active) continue;
        const hb = latest[m.id];
        const st = hb ? STATUS[hb.status] : "NO DATA YET";
        if (st !== "UP") bad++;
        console.log(`${st.padEnd(12)} ${m.name.padEnd(40)} ${hb ? (hb.ping ? hb.ping + "ms " : "") + (hb.msg || "").slice(0, 70) : ""}`);
      }
      s.close();
      process.exit(bad ? 1 : 0);
    }, 4000);
  });
});
