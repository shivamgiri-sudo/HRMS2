module.exports = {
  apps: [
    {
      name: "hrms-backend",
      cwd: "C:\\Users\\shivamg\\HRMS1\\backend",
      script: "node",
      args: "dist/server.js",
      env: {
        NODE_ENV: "production",
        ENABLE_SCHEDULERS: "true",
      },
      // Restart on crash, after 5s delay
      restart_delay: 5000,
      max_restarts: 20,
      // Log files
      out_file: "C:\\Users\\shivamg\\HRMS1\\logs\\backend-out.log",
      error_file: "C:\\Users\\shivamg\\HRMS1\\logs\\backend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      // Rotate logs daily, keep 14 days
      merge_logs: true,
    },
    {
      name: "hrms-frontend",
      cwd: "C:\\Users\\shivamg\\HRMS1",
      script: "node",
      args: "node_modules/.bin/vite preview --host 0.0.0.0 --port 8080",
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 5000,
      max_restarts: 20,
      out_file: "C:\\Users\\shivamg\\HRMS1\\logs\\frontend-out.log",
      error_file: "C:\\Users\\shivamg\\HRMS1\\logs\\frontend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
