@echo off
REM =============================================================================
REM Branch Alias Deployment Script
REM =============================================================================
REM Run this on the production server (192.168.11.225) as masadmin
REM =============================================================================

echo.
echo ========================================================================
echo Branch Alias Setup for Interview Registration
echo ========================================================================
echo.
echo This will:
echo   1. Pull latest code from GitHub
echo   2. Run the branch alias SQL migration
echo   3. Deactivate all branches except Noida 2, Noida, AHM
echo   4. Set up display aliases: Okaya, Trapezoid, Jaldarshan
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo [1/2] Pulling latest code from GitHub...
cd "C:\Users\shivamg\Upgraded HRMS"
git pull origin main

echo.
echo [2/2] Running SQL migration...
mysql -h 192.168.10.6 -u shivam_user -p"qwersdfg!@#hjk" mas_hrms < backend\sql\999_branch_alias_setup.sql

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================================
    echo SUCCESS! Branch aliases configured.
    echo ========================================================================
    echo.
    echo Test the interview registration page:
    echo https://mcnhrms.teammas.in/interview-registration
    echo.
    echo Branch dropdown should now show:
    echo   - Okaya (submits as Noida 2)
    echo   - Trapezoid (submits as Noida)
    echo   - Jaldarshan (submits as AHM)
    echo.
    echo Recruiter dropdown will filter by actual branch name.
    echo ========================================================================
) else (
    echo.
    echo ========================================================================
    echo ERROR: SQL migration failed!
    echo ========================================================================
    echo.
    echo Check the error message above and verify:
    echo   - Database is accessible
    echo   - Credentials are correct
    echo   - SQL file exists at: backend\sql\999_branch_alias_setup.sql
    echo ========================================================================
)

echo.
pause
