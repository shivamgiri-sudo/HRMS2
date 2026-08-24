@echo off
echo =====================================================
echo  MAS Callnet HRMS — CEO Analytics for Claude AI
echo =====================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo.
  echo  1. Go to https://nodejs.org
  echo  2. Download and install the LTS version
  echo  3. Run this setup again
  echo.
  pause
  exit /b 1
)
echo [OK] Node.js found: & node --version

echo.
echo Installing packages...
call npm install --silent
if errorlevel 1 ( echo [ERROR] Install failed. & pause & exit /b 1 )
echo [OK] Packages installed.

echo.
if not exist ".env" (
  copy .env.example .env >nul
  echo [ACTION NEEDED] .env file created.
  echo.
  echo  Open the file ".env" in this folder with Notepad and fill in:
  echo    DB_USER     = your database username
  echo    DB_PASSWORD = your database password
  echo.
  echo  Then run this setup again to test the connection.
  echo.
  start notepad .env
  pause
  exit /b 0
)
echo [OK] .env file found.

echo.
echo Testing connection...
node -e "
import('./index.mjs').catch(e=>{console.error('Error:',e.message);process.exit(1)});
setTimeout(()=>{console.log('[OK] Connection successful!');process.exit(0)},4000);
" 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Could not connect. Check your .env credentials and network.
  pause
  exit /b 1
)

echo.
echo =====================================================
echo  Setup complete!
echo.
echo  NEXT STEP — Add this to your Claude Code .mcp.json:
echo.
echo  {
echo    "mcpServers": {
echo      "hrms-db": {
echo        "command": "node",
echo        "args": ["%CD:\=/%/index.mjs"]
echo      }
echo    }
echo  }
echo.
echo  Then restart Claude Code and ask:
echo    "Show me the CEO analytics dashboard"
echo =====================================================
pause
