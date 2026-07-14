#!/usr/bin/env python3
"""ATS Fix Database Migration Script"""

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
    print("ATS Fix Migration - Starting")
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

        # Check current state
        print("[STEP 1] Pre-Migration Status Check")
        print("-" * 60)

        cursor.execute("""
            SELECT COUNT(*) FROM ats_candidate
            WHERE status IS NULL AND active_status = 1
        """)
        null_before = cursor.fetchone()[0]
        print(f"  Candidates with NULL status: {null_before}")
        print()

        # Backfill from final_decision
        print("[STEP 2] Backfilling from final_decision...")
        cursor.execute("""
            UPDATE ats_candidate
            SET status = final_decision
            WHERE status IS NULL
              AND final_decision IS NOT NULL
              AND final_decision != ''
        """)
        rows1 = cursor.rowcount
        connection.commit()
        print(f"  [OK] Updated {rows1} rows")
        print()

        # Backfill from current_stage
        print("[STEP 3] Backfilling from current_stage...")
        cursor.execute("""
            UPDATE ats_candidate
            SET status = CASE
              WHEN current_stage IN ('New', 'Applied', 'Registered', 'Screening') THEN 'Waiting'
              WHEN current_stage IN ('Interview', 'Interview Scheduled', 'In Interview') THEN 'In Interview'
              WHEN current_stage = 'Selected' THEN 'Selected'
              WHEN current_stage = 'Rejected' THEN 'Rejected'
              WHEN current_stage LIKE '%BGV%' THEN 'BGV Pending'
              WHEN current_stage LIKE '%Offer%' THEN 'Offer Pending'
              WHEN current_stage = 'Joined' THEN 'Joined'
              ELSE 'Waiting'
            END
            WHERE status IS NULL
        """)
        rows2 = cursor.rowcount
        connection.commit()
        print(f"  [OK] Updated {rows2} rows")
        print()

        # Create index
        print("[STEP 4] Creating index...")
        cursor.execute("""
            SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = 'mas_hrms'
              AND TABLE_NAME = 'ats_candidate'
              AND INDEX_NAME = 'idx_ats_status'
        """)
        exists = cursor.fetchone()[0] > 0

        if not exists:
            cursor.execute("ALTER TABLE ats_candidate ADD INDEX idx_ats_status (status)")
            connection.commit()
            print("  [OK] Index created")
        else:
            print("  [INFO] Index already exists")
        print()

        # Verify
        print("[STEP 5] Verification")
        print("-" * 60)

        cursor.execute("""
            SELECT COUNT(*) FROM ats_candidate
            WHERE status IS NULL AND active_status = 1
        """)
        null_after = cursor.fetchone()[0]
        print(f"  NULL status after migration: {null_after} (should be 0)")

        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM ats_candidate
            WHERE active_status = 1
            GROUP BY status
            ORDER BY count DESC
            LIMIT 10
        """)
        print("  Status distribution:")
        for row in cursor.fetchall():
            print(f"    - {row[0]}: {row[1]} candidates")
        print()

        cursor.execute("""
            SELECT COALESCE(recruiter_assigned_name, 'Unassigned') as recruiter, COUNT(*) as cnt
            FROM ats_candidate
            WHERE active_status = 1 AND status = 'Waiting'
            GROUP BY recruiter_assigned_name
            ORDER BY cnt DESC
            LIMIT 5
        """)
        print("  Waiting candidates by recruiter (top 5):")
        for row in cursor.fetchall():
            print(f"    - {row[0]}: {row[1]} candidates")
        print()

        # Summary
        print("=" * 60)
        print("[SUCCESS] Migration Completed")
        print("=" * 60)
        print()
        print("Summary:")
        print(f"  - {rows1} rows updated from final_decision")
        print(f"  - {rows2} rows updated from current_stage")
        print(f"  - NULL status: {null_before} -> {null_after}")
        print()
        print("Next steps:")
        print("  1. Restart backend: pm2 restart mcn-hrms-backend")
        print("  2. Test with MAS62536 (Khushi@123)")
        print("  3. Test with MAS61042 (Mehar@2005)")
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
        return 1

    finally:
        if connection and connection.is_connected():
            connection.close()
            print("Database connection closed")

if __name__ == "__main__":
    sys.exit(main())
