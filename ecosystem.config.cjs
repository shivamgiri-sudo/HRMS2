/**
 * PM2 Production Configuration for MAS Callnet HRMS / PeopleOS
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --only hrms-api
 *   pm2 start ecosystem.config.cjs --only hrms-workers
 *
 * IMPORTANT:
 * - API and Workers run as SEPARATE processes
 * - API does NOT start any schedulers/workers inline (WORKERS_PROCESS=external)
 * - Workers handle ALL background jobs via all-workers.js
 * - Frontend is served via nginx from /var/www/hrms/dist, NOT vite preview
 */

module.exports = {
  apps: [
    {
      name: "hrms-api",
      script: "dist/src/server.js",
      cwd: "./backend",
      instances: 1, // Scale with caution - some endpoints may not be cluster-safe
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        // CRITICAL: Workers must run externally to prevent duplicate job execution
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
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "hrms-workers",
      script: "dist/src/workers/all-workers.js",
      cwd: "./backend",
      instances: 1, // Workers should NOT be clustered - they use distributed locks
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        ENABLE_SCHEDULERS: "true",
      },
      // Graceful shutdown - workers need time to finish current jobs
      kill_timeout: 60000,
      // Restart policy
      max_restarts: 10,
      restart_delay: 10000, // Longer delay for workers to avoid rapid job collisions
      // Logging
      error_file: "./logs/workers-error.log",
      out_file: "./logs/workers-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
