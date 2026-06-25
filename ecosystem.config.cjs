module.exports = {
  apps: [
    {
      name: "hrms-backend",
      cwd: "C:\\Users\\shivamg\\Upgraded HRMS\\backend",
      script: "node",
      args: "dist/server.js",
      env: {
        NODE_ENV: "production",
        ENABLE_SCHEDULERS: "true",
      },
      restart_delay: 5000,
      max_restarts: 20,
      out_file: "C:\\Users\\shivamg\\Upgraded HRMS\\logs\\backend-out.log",
      error_file: "C:\\Users\\shivamg\\Upgraded HRMS\\logs\\backend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
    {
      name: "hrms-frontend",
      cwd: "C:\\Users\\shivamg\\Upgraded HRMS",
      script: "node",
      args: "node_modules/.bin/vite preview --host 0.0.0.0 --port 8085",
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 5000,
      max_restarts: 20,
      out_file: "C:\\Users\\shivamg\\Upgraded HRMS\\logs\\frontend-out.log",
      error_file: "C:\\Users\\shivamg\\Upgraded HRMS\\logs\\frontend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
