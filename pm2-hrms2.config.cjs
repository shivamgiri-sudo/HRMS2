module.exports = {
  apps: [{
    name: "hrms2-backend",
    cwd: "/var/www/HRMS2/backend",
    script: "dist/src/server.js",
    interpreter: "node",
    env_file: "/var/www/HRMS2/backend/.env",
    restart_delay: 5000,
    max_restarts: 10,
    out_file: "/var/www/HRMS2/logs/backend-out.log",
    error_file: "/var/www/HRMS2/logs/backend-err.log",
    merge_logs: true
  }]
};