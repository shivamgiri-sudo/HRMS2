/**
 * PM2 ecosystem config — production cluster mode.
 *
 * Two workers share port 5055. PM2 load-balances incoming connections.
 * `pm2 reload hrms2-backend` sends SIGINT to one worker at a time, waits
 * for `process.send('ready')` from the new worker before killing the old one
 * (wait_ready + listen_timeout). Zero-downtime restarts even under load.
 *
 * Start:  pm2 start ecosystem.config.cjs --only hrms2-backend
 * Reload: pm2 reload hrms2-backend
 * Logs:   pm2 logs hrms2-backend
 */
module.exports = {
  apps: [
    {
      name: "hrms2-backend",
      script: "dist/src/server.js",
      cwd: "/var/www/HRMS2/backend",

      // Cluster mode: two workers, one per CPU-bound task set.
      // Each worker connects to MySQL independently using the pool (DB_POOL_MAX / 2 each).
      exec_mode: "cluster",
      instances: 2,

      // Memory limit: 2GB per worker. The default 1.4GB is insufficient for large
      // XLSX exports (employee-master with 60,000+ rows and 74 columns).
      node_args: "--max-old-space-size=2048",

      // Readiness handshake — server.ts calls process.send('ready') once
      // httpServer is listening. PM2 waits up to 30s for this signal before
      // considering a worker started; without it a reload can route traffic to
      // a worker still running migrations.
      wait_ready: true,
      listen_timeout: 30000,

      // Grace period: give the outgoing worker 15s to drain in-flight requests
      // (payroll calculations, bulk exports) before force-killing it.
      kill_timeout: 15000,

      // Log files
      out_file: "logs/backend-out.log",
      error_file: "logs/backend-err.log",
      merge_logs: true,

      // Restart policy: if a worker crashes, wait 3s then restart.
      // Do NOT restart more than 10 times in 30s (indicates a hard crash loop).
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "30s",

      // Never auto-restart on SIGINT (graceful shutdown signal)
      stop_exit_codes: [0],

      // Environment — dotenv loads from cwd/.env; these are overrides only
      env: {
        NODE_ENV: "production",
        PORT: 5055,
      },
    },

    {
      name: "hrms2-workers",
      script: "dist/src/workers/all-workers.js",
      cwd: "/var/www/HRMS2/backend",
      exec_mode: "fork",
      instances: 1,
      out_file: "logs/workers-out.log",
      error_file: "logs/workers-err.log",
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "30s",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
