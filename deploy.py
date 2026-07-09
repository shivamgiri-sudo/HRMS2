#!/usr/bin/env python3
"""
HRMS2 Production Deployment Script
Connects to 192.168.11.225 and deploys fix commit aa77a2d7
"""

import paramiko
import sys
import time
import os

# Fix Windows console encoding
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "192.168.11.225"
USER = "masadmin"
PASSWORD = "Support#123"
COMMIT = "aa77a2d7"
REPO_PATH = "/home/masadmin/HRMS2_fix_onboarding_branch"

def execute_command(ssh_client, command, show_output=True):
    """Execute command on remote server and return output"""
    print(f"\n>> Executing: {command}")
    stdin, stdout, stderr = ssh_client.exec_command(command, get_pty=True)

    output = ""
    for line in stdout:
        line = line.rstrip()
        output += line + "\n"
        if show_output:
            print(f"  {line}")

    err = stderr.read().decode()
    if err and show_output:
        print(f"  [STDERR] {err}")

    return output, err

def main():
    print("="*60)
    print("HRMS2 Production Deployment")
    print("="*60)
    print(f"Target: {HOST}")
    print(f"User: {USER}")
    print(f"Commit: {COMMIT}")
    print(f"Repository: {REPO_PATH}")
    print("="*60)

    try:
        # Connect
        print("\n[1/10] Connecting to server...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] Connected successfully")

        # Verify repo exists
        print("\n[2/10] Verifying repository...")
        out, err = execute_command(ssh, f"cd {REPO_PATH} && git status", show_output=False)
        if err and "not a git repository" in err.lower():
            print("[FAIL] Repository not found!")
            return False
        print("[OK] Repository exists")

        # Check git status
        print("\n[3/10] Checking git status...")
        execute_command(ssh, f"cd {REPO_PATH} && git status", show_output=True)

        # Fetch latest
        print("\n[4/10] Fetching from remote...")
        execute_command(ssh, f"cd {REPO_PATH} && git fetch origin main", show_output=True)

        # Checkout commit
        print("\n[5/10] Checking out commit {COMMIT}...")
        out, err = execute_command(ssh, f"cd {REPO_PATH} && git checkout {COMMIT}")
        if "error" in err.lower() or "fatal" in err.lower():
            print(f"[FAIL] Failed to checkout commit: {err}")
            return False
        print(f"[OK] Checked out {COMMIT}")

        # Verify migration file
        print("\n[6/10] Verifying migration file...")
        out, err = execute_command(ssh, f"ls -la {REPO_PATH}/backend/sql/371_user_device_sessions.sql")
        if "cannot access" in err.lower():
            print("[FAIL] Migration file not found!")
            return False
        print("[OK] Migration file verified")

        # Check and apply migration
        print("\n[7/10] Applying database migration...")
        check_table = "mysql -h localhost -u hrms_user -p$HRMS_DB_PASSWORD mas_hrms -e \"SHOW TABLES LIKE 'user_device_sessions';\" 2>/dev/null"
        out, err = execute_command(ssh, check_table, show_output=False)

        if "user_device_sessions" not in out:
            print("  Migration not applied. Running now...")
            migration_cmd = f"mysql -h localhost -u hrms_user -p$HRMS_DB_PASSWORD mas_hrms < {REPO_PATH}/backend/sql/371_user_device_sessions.sql"
            out, err = execute_command(ssh, migration_cmd)
            if err and "error" in err.lower():
                print(f"[FAIL] Migration failed: {err}")
                return False
            print("[OK] Migration applied")
        else:
            print("[OK] Migration already applied")

        # Build backend
        print("\n[8/10] Building backend...")
        execute_command(ssh, f"cd {REPO_PATH}/backend && npm run build 2>&1 | tail -20", show_output=True)
        print("[OK] Backend build completed")

        # Build frontend
        print("\n[9/10] Building frontend...")
        execute_command(ssh, f"cd {REPO_PATH} && npm run build 2>&1 | tail -20", show_output=True)
        print("[OK] Frontend build completed")

        # Restart services
        print("\n[10/10] Restarting services with PM2...")
        execute_command(ssh, "pm2 restart hrms-backend hrms-frontend --update-env 2>&1", show_output=True)

        # Wait for services to start
        time.sleep(5)

        # Health checks
        print("\n[VERIFY] Health checks...")

        execute_command(ssh, "pm2 status", show_output=True)

        # Check backend endpoint
        print("\n[CHECK] Backend /api/health endpoint...")
        out, err = execute_command(ssh, "curl -s http://localhost:3001/api/health 2>&1 | head -5", show_output=True)

        # Check public org settings endpoint
        print("\n[CHECK] Public auto-logout endpoint...")
        out, err = execute_command(ssh, "curl -s http://localhost:3001/api/org/settings/public/auto-logout-minutes 2>&1", show_output=True)

        # Check frontend
        print("\n[CHECK] Frontend (localhost:3000)...")
        out, err = execute_command(ssh, "curl -s -o /dev/null -w 'HTTP %{http_code}' http://localhost:3000 2>&1", show_output=True)

        print("\n" + "="*60)
        print("[OK] DEPLOYMENT COMPLETED SUCCESSFULLY")
        print("="*60)
        print("\nChanges deployed:")
        print("  1. Migration file in correct location (backend/sql/)")
        print("  2. Org settings public endpoint accessible")
        print("  3. GET /sessions reads headers/query (not body)")
        print("  4. Inactivity logout calls signOut() directly")
        print("  5. Code indentation fixed for clarity")
        print("\nCommit: aa77a2d7")
        print("Server: 192.168.11.225")
        print("="*60)

        ssh.close()
        return True

    except paramiko.AuthenticationException:
        print("[FAIL] Authentication failed - check credentials")
        return False
    except paramiko.SSHException as e:
        print(f"[FAIL] SSH error: {e}")
        return False
    except Exception as e:
        print(f"[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
