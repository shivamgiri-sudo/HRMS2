#!/usr/bin/env python3
"""Fix numeric status values in ats_candidate table"""

import mysql.connector
from mysql.connector import Error
import sys

DB_CONFIG = {
    'host': '122.184.128.90',
    'port': 3306,
    'database': 'mas_hrms',
    'user': 'shivam_user',
    'password': 'qwersdfg!@#hjk'
}

def main():
    print("=" * 60)
    print("Fixing Numeric Status Values")
    print("=" * 60)
    print()

    connection = None
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        cursor = connection.cursor()
        print("[OK] Connected to database")
        print()

        # Check current issue
        print("[CHECK] Current numeric status distribution:")
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM ats_candidate
            WHERE active_status = 1 AND status IN ('0', '1')
            GROUP BY status
        """)
        for row in cursor.fetchall():
            print(f"  Status '{row[0]}': {row[1]} candidates")
        print()

        # Fix numeric 0 and 1 to proper status
        print("[FIX] Converting numeric status to text...")

        # Status '0' likely means inactive/rejected
        cursor.execute("""
            UPDATE ats_candidate
            SET status = 'Inactive'
            WHERE status = '0' AND active_status = 1
        """)
        rows_0 = cursor.rowcount

        # Status '1' likely means active/waiting
        cursor.execute("""
            UPDATE ats_candidate
            SET status = CASE
              WHEN current_stage IN ('Selected', 'selected') THEN 'Selected'
              WHEN current_stage IN ('Rejected', 'rejected') THEN 'Rejected'
              WHEN current_stage IN ('Interview', 'Interview Scheduled', 'In Interview') THEN 'In Interview'
              WHEN current_stage LIKE '%BGV%' THEN 'BGV Pending'
              WHEN current_stage LIKE '%Offer%' THEN 'Offer Pending'
              WHEN current_stage = 'Joined' THEN 'Joined'
              ELSE 'Waiting'
            END
            WHERE status = '1' AND active_status = 1
        """)
        rows_1 = cursor.rowcount

        connection.commit()
        print(f"  [OK] Fixed {rows_0} records with status '0'")
        print(f"  [OK] Fixed {rows_1} records with status '1'")
        print()

        # Verify
        print("[VERIFY] Status distribution after fix:")
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM ats_candidate
            WHERE active_status = 1
            GROUP BY status
            ORDER BY count DESC
            LIMIT 15
        """)
        for row in cursor.fetchall():
            print(f"  {row[0]}: {row[1]} candidates")
        print()

        print("[SUCCESS] Numeric status values fixed!")
        print()

        cursor.close()
        return 0

    except Error as e:
        print(f"\n[ERROR] {e}")
        if connection:
            connection.rollback()
        return 1

    finally:
        if connection and connection.is_connected():
            connection.close()

if __name__ == "__main__":
    sys.exit(main())
