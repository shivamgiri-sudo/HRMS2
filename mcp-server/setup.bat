@echo off
echo ============================================================
echo  MAS Callnet HRMS MCP Server — Setup
echo ============================================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo         Download from: https://nodejs.org  (LTS version)
  pause
  exit /b 1
)
echo [OK] Node.js found:
node --version

:: Install dependencies
echo.
echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.

:: Check .env exists
echo.
echo [2/3] Checking .env file...
if not exist ".env" (
  echo [WARN] .env not found — copying .env.example
  copy .env.example .env
  echo.
  echo  *** IMPORTANT: Edit .env and fill in your DB credentials ***
  echo  Open .env in Notepad and update:
  echo    DB_USER=your_username
  echo    DB_PASSWORD=your_password
  echo    HRMS_ROLE=viewer  (or hr / recruitment / management / finance / full)
  echo.
) else (
  echo [OK] .env file found.
)

:: Test connection
echo [3/3] Testing database connection...
echo.
node -e "
import('./index.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('Dependency missing — run npm install');
  } else {
    console.error('Startup error:', e.message);
  }
  process.exit(1);
});
setTimeout(() => { process.exit(0); }, 3000);
" 2>&1
echo.
echo ============================================================
echo  Setup complete.
echo.
echo  To use: Add this to your project .mcp.json:
echo.
echo  {
echo    "mcpServers": {
echo      "hrms-db": {
echo        "command": "node",
echo        "args": ["PATH\\TO\\mcp-server\\index.mjs"]
echo      }
echo    }
echo  }
echo.
echo  Then restart Claude Code — the hrms-db tools will appear.
echo ============================================================
pause
