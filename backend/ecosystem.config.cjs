/**
 * PM2 Production Configuration for MCN HRMS
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --only hrms-api
 *   pm2 start ecosystem.config.cjs --only hrms-workers
 *
 * IMPORTANT:
 * - API and Workers run as SEPARATE processes
 * - API does NOT start any schedulers/workers inline
 * - Workers handle ALL background jobs
 * - Frontend is served via nginx, NOT vite preview
 */

module.exports = {
  apps: [
    {
      name: "hrms-api",
      script: "dist/src/server.js",
      cwd: __dirname,
      instances: 1, // Scale with caution - some endpoints may not be cluster-safe
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        // This is an IST business: attendance dates, payroll month boundaries and shift
        // roll-over are all reasoned about in IST. Nothing pinned the timezone before, so
        // the process inherited the host's — which meant dev (IST) and CI (UTC) disagreed,
        // and any date built with a local Date and read back as UTC (or vice versa) shifted
        // by a day depending on where it ran. Pinned so every environment agrees.
        TZ: "Asia/Kolkata",
        // CRITICAL: Workers must run externally
        WORKERS_PROCESS: "external",
        ENABLE_SCHEDULERS: "false",
        // Port - nginx proxies to this
        PORT: 5055,
      },
      // Graceful shutdown
      kill_timeout: 35000, // Wait for graceful shutdown (30s internal + buffer)
      wait_ready: true,
      listen_timeout: 10000,
      // Restart policy
      max_restarts: 10,
      restart_delay: 5000,
      // Logging
      error_file: "/var/log/hrms/api-error.log",
      out_file: "/var/log/hrms/api-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "hrms-workers",
      script: "dist/src/workers/all-workers.js",
      cwd: __dirname,
      instances: 1, // Workers should NOT be clustered - they use distributed locks
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        // Same reason as hrms-api above. Matters more here, if anything: the schedulers
        // decide which calendar day a cron run belongs to.
        TZ: "Asia/Kolkata",
      },
      // Graceful shutdown - workers need time to finish current jobs
      kill_timeout: 60000,
      // Restart policy
      max_restarts: 10,
      restart_delay: 10000, // Longer delay for workers to avoid rapid job collisions
      // Logging
      error_file: "/var/log/hrms/workers-error.log",
      out_file: "/var/log/hrms/workers-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
