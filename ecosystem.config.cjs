module.exports = {
  apps: [
    {
      name: "hrms2-backend",
      cwd: "./backend",
      script: "node",
      args: "dist/src/server.js",
      env: {
        NODE_ENV: "production",
        ENABLE_SCHEDULERS: "true",
      },
      restart_delay: 5000,
      max_restarts: 20,
      out_file: "./logs/backend-out.log",
      error_file: "./logs/backend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
    {
      name: "hrms2-frontend",
      cwd: ".",
      script: "npx",
      args: "vite preview --host 0.0.0.0 --port 8085",
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 5000,
      max_restarts: 20,
      out_file: "./logs/frontend-out.log",
      error_file: "./logs/frontend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
