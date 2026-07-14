#!/usr/bin/env python3
"""
ATS Fix Database Migration Script
Connects directly to production MySQL and runs the migration
"""

import mysql.connector
from mysql.connector import Error
import sys
from datetime import datetime

# Database configuration
DB_CONFIG = {
    'host': '122.184.128.90',
    'port': 3306,
    'database': 'mas_hrms',
    'user': 'shivam_user',
    'password': 'qwersdfg!@#hjk'
}

def execute_query(cursor, query, description=""):
    """Execute a single query and return results"""
    try:
        cursor.execute(query)
        if cursor.with_rows:
            return cursor.fetchall()
        return None
    except Error as e:
        print(f"❌ Error in {description}: {e}")
        raise

def main():
    print("=" * 55)
    print("ATS Fix Migration - Starting")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 55)
    print()

    connection = None
    try:
        # Connect to database
        print("🔌 Connecting to database...")
        connection = mysql.connector.connect(**DB_CONFIG)
        cursor = connection.cursor()
        print(f"[OK] Connected to {DB_CONFIG['host']}:{DB_CONFIG['port']} as {DB_CONFIG['user']}")
        print()

        # Step 1: Check current state
        print("[STEP 1] Pre-Migration Status Check")
        print("-" * 55)

        cursor.execute("""
            SELECT COUNT(*) as null_count
            FROM ats_candidate
            WHERE status IS NULL AND active_status = 1
        """)
        null_count_before = cursor.fetchone()[0]
        print(f"  Candidates with NULL status: {null_count_before}")

        cursor.execute("""
            SELECT COALESCE(status, 'NULL') as status, COUNT(*) as count
            FROM ats_candidate
            WHERE active_status = 1
            GROUP BY status
            ORDER BY count DESC
            LIMIT 5
        """)
        print("  Top 5 status values:")
        for row in cursor.fetchall():
            print(f"    - {row[0]}: {row[1]} candidates")
        print()

        # Step 2: Backfill from final_decision
        print("🔄 STEP 2: Backfilling status from final_decision")
        print("-" * 55)

        cursor.execute("""
            UPDATE ats_candidate
            SET status = final_decision
            WHERE status IS NULL
              AND final_decision IS NOT NULL
              AND final_decision != ''
        """)
        rows_updated_1 = cursor.rowcount
        connection.commit()
        print(f"  ✓ Updated {rows_updated_1} rows from final_decision")
        print()

        # Step 3: Backfill from current_stage
        print("🔄 STEP 3: Backfilling status from current_stage")
        print("-" * 55)

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
        rows_updated_2 = cursor.rowcount
        connection.commit()
        print(f"  ✓ Updated {rows_updated_2} rows from current_stage mapping")
        print()

        # Step 4: Create index
        print("📇 STEP 4: Creating performance index")
        print("-" * 55)

        # Check if index exists
        cursor.execute("""
            SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = 'mas_hrms'
              AND TABLE_NAME = 'ats_candidate'
              AND INDEX_NAME = 'idx_ats_status'
        """)
        index_exists = cursor.fetchone()[0] > 0

        if not index_exists:
            cursor.execute("ALTER TABLE ats_candidate ADD INDEX idx_ats_status (status)")
            connection.commit()
            print("  ✓ Index idx_ats_status created")
        else:
            print("  ℹ Index idx_ats_status already exists")
        print()

        # Step 5: Verification
        print("✅ STEP 5: Post-Migration Verification")
        print("-" * 55)

        cursor.execute("""
            SELECT COUNT(*) as null_count
            FROM ats_candidate
            WHERE status IS NULL AND active_status = 1
        """)
        null_count_after = cursor.fetchone()[0]
        print(f"  Candidates with NULL status: {null_count_after} (should be 0)")

        cursor.execute("""
            SELECT status, COUNT(*) as count,
                   ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ats_candidate WHERE active_status = 1), 2) as percentage
            FROM ats_candidate
            WHERE active_status = 1
            GROUP BY status
            ORDER BY count DESC
            LIMIT 10
        """)
        print("  Status distribution after fix:")
        for row in cursor.fetchall():
            print(f"    - {row[0]}: {row[1]} candidates ({row[2]}%)")
        print()

        cursor.execute("""
            SELECT COALESCE(recruiter_assigned_name, 'Unassigned') as recruiter,
                   COUNT(*) as waiting_count
            FROM ats_candidate
            WHERE active_status = 1
              AND (status = 'Waiting' OR (status IS NULL AND current_stage IN ('New', 'Applied', 'Screening', 'Registered')))
            GROUP BY recruiter_assigned_name
            ORDER BY waiting_count DESC
            LIMIT 10
        """)
        print("  Waiting candidates by recruiter:")
        for row in cursor.fetchall():
            print(f"    - {row[0]}: {row[1]} candidates")
        print()

        # Summary
        print("═══════════════════════════════════════════════════════")
        print("✓ MIGRATION COMPLETED SUCCESSFULLY")
        print("═══════════════════════════════════════════════════════")
        print()
        print("Summary:")
        print(f"  - {rows_updated_1} rows updated from final_decision")
        print(f"  - {rows_updated_2} rows updated from current_stage")
        print(f"  - NULL status: {null_count_before} → {null_count_after}")
        print()
        print("Next steps:")
        print("  1. Restart backend: pm2 restart mcn-hrms-backend")
        print("  2. Test with MAS62536 (Khushi@123)")
        print("  3. Test with MAS61042 (Mehar@2005)")
        print("  4. Verify candidates at /ats/candidate-master")
        print()

        cursor.close()
        return 0

    except Error as e:
        print(f"\n❌ Database error: {e}")
        if connection:
            connection.rollback()
        return 1

    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        return 1

    finally:
        if connection and connection.is_connected():
            connection.close()
            print("🔌 Database connection closed")

if __name__ == "__main__":
    sys.exit(main())
