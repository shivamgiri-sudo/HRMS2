@echo off
echo ============================================
echo  HRMS Windows Auto-Start Setup
echo  Run this ONCE as Administrator
echo ============================================

REM Install pm2-windows-startup to register PM2 as a Windows Service
call npm install -g pm2-windows-startup
call pm2-startup install

REM Save current PM2 process list so it restores on reboot
call pm2 save

echo.
echo ============================================
echo  Auto-start configured!
echo  PM2 will now start HRMS automatically
echo  every time Windows boots.
echo ============================================
pause
