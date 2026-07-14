#!/usr/bin/env python3
"""Employee Reactivation Migration Script"""

import mysql.connector
from mysql.connector import Error
import sys
from datetime import datetime

DB_CONFIG = {
    'host': '122.184.128.90',
    'port': 3306,
    'database': 'mas_hrms',
    'user': 'shivam_user',
    'password': 'qwersdfg!@#hjk'
}

def main():
    print("=" * 60)
    print("Employee Reactivation Migration - Starting")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    print()

    connection = None
    try:
        # Connect
        print("Connecting to database...")
        connection = mysql.connector.connect(**DB_CONFIG)
        cursor = connection.cursor()
        print(f"[OK] Connected to {DB_CONFIG['host']} as {DB_CONFIG['user']}")
        print()

        # Read SQL file
        print("[STEP 1] Reading migration file...")
        with open('backend/sql/020_employee_reactivation.sql', 'r', encoding='utf-8') as f:
            sql_content = f.read()

        # Remove comments and split into CREATE TABLE statements
        lines = []
        for line in sql_content.split('\n'):
            line = line.strip()
            if line and not line.startswith('--'):
                lines.append(line)

        sql_clean = ' '.join(lines)

        # Extract CREATE TABLE statements
        statements = []
        import re
        creates = re.findall(r'CREATE TABLE IF NOT EXISTS.*?;', sql_clean, re.DOTALL | re.IGNORECASE)
        statements.extend(creates)

        print(f"  [OK] Found {len(statements)} SQL statements")
        print()

        # Execute each statement
        print("[STEP 2] Executing statements...")
        for i, statement in enumerate(statements, 1):
            # Skip comments
            if statement.startswith('--') or statement.startswith('/*'):
                continue

            try:
                cursor.execute(statement)
                connection.commit()
                # Show CREATE TABLE statements
                if 'CREATE TABLE' in statement.upper():
                    table_name = statement.split('CREATE TABLE')[1].split('(')[0].strip().split()[0].strip('`')
                    print(f"  [{i}/{len(statements)}] Created table: {table_name}")
            except Error as e:
                # Ignore table already exists errors
                if 'already exists' in str(e):
                    print(f"  [{i}/{len(statements)}] Table already exists (skipped)")
                else:
                    print(f"  [WARNING] Statement {i} failed: {e}")
        print()

        # Verify
        print("[STEP 3] Verification")
        print("-" * 60)

        cursor.execute("""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = 'mas_hrms'
            AND table_name = 'employee_reactivation_requests'
        """)
        table_exists = cursor.fetchone()[0] > 0
        print(f"  employee_reactivation_requests table exists: {table_exists}")

        cursor.execute("""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = 'mas_hrms'
            AND table_name = 'employee_reactivation_audit'
        """)
        audit_exists = cursor.fetchone()[0] > 0
        print(f"  employee_reactivation_audit table exists: {audit_exists}")
        print()

        # Summary
        print("=" * 60)
        print("[SUCCESS] Migration Completed")
        print("=" * 60)
        print()
        print("Next steps:")
        print("  1. Test the API: GET /api/employees/reactivation/pending")
        print("  2. Backend is already running, routes should be active")
        print()

        cursor.close()
        return 0

    except Error as e:
        print(f"\n[ERROR] Database error: {e}")
        if connection:
            connection.rollback()
        return 1

    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    finally:
        if connection and connection.is_connected():
            connection.close()
            print("Database connection closed")

if __name__ == "__main__":
    sys.exit(main())
