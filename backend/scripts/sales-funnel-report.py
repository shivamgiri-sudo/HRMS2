#!/usr/bin/env python3
"""
Sales Funnel Analysis Report
Queries db_external.CallDetails for complete sales funnel metrics
"""

import mysql.connector
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
import json

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env.local'))

def get_db_connection():
    """Create MySQL connection using environment variables"""
    return mysql.connector.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', '3306')),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASSWORD', ''),
        database='db_external'
    )

def print_header(title):
    """Print a formatted header"""
    print("\n" + "=" * 120)
    print(f"  {title}")
    print("=" * 120)

def print_table_header(*cols):
    """Print table header with column names"""
    col_widths = [max(15, len(str(c))) for c in cols]
    header = " | ".join(str(c).ljust(w) for c, w in zip(cols, col_widths))
    print(header)
    print("-" * len(header))
    return col_widths

def print_table_row(row, col_widths):
    """Print a table row with proper formatting"""
    return " | ".join(str(v if v is not None else 'N/A').ljust(w) for v, w in zip(row, col_widths))

def query_overall_funnel(cursor):
    """Query 1: Overall Sales Funnel by Process"""
    print_header("1. OVERALL SALES FUNNEL BY PROCESS (Last 90 Days)")

    query = """
    SELECT
        COALESCE(ProcessName, 'Unknown') as process,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as conversion_rate_pct
    FROM db_external.CallDetails
    WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    GROUP BY ProcessName
    ORDER BY total_calls DESC
    """

    cursor.execute(query)
    results = cursor.fetchall()

    cols = print_table_header("PROCESS", "TOTAL_CALLS", "OFFERS", "SALES", "CONVERSION_RATE (%)")
    for row in results:
        print(print_table_row(row, cols))

    return results

def query_conversion_trend(cursor):
    """Query 2: Sales Conversion Trend Over 90 Days"""
    print_header("2. SALES CONVERSION TREND (Last 90 Days - Daily, Last 30 Days)")

    query = """
    SELECT
        DATE(CallDate) as date,
        COUNT(*) as daily_calls,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as daily_sales,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as daily_conversion_rate
    FROM db_external.CallDetails
    WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    GROUP BY DATE(CallDate)
    ORDER BY date DESC
    LIMIT 30
    """

    cursor.execute(query)
    results = cursor.fetchall()

    cols = print_table_header("DATE", "DAILY_CALLS", "DAILY_SALES", "CONVERSION_RATE (%)")
    for row in results:
        print(print_table_row(row, cols))

    return results

def query_offer_acceptance(cursor):
    """Query 3: Offer Acceptance Rate by Process"""
    print_header("3. OFFER ACCEPTANCE RATE BY PROCESS (Last 90 Days)")

    query = """
    SELECT
        COALESCE(ProcessName, 'Unknown') as process,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers_made,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as offers_accepted,
        ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as offer_rate,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END), 0), 2) as acceptance_rate
    FROM db_external.CallDetails
    WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    GROUP BY ProcessName
    ORDER BY offers_made DESC
    """

    cursor.execute(query)
    results = cursor.fetchall()

    cols = print_table_header("PROCESS", "TOTAL_CALLS", "OFFERS_MADE", "ACCEPTED", "OFFER_RATE (%)", "ACCEPTANCE_RATE (%)")
    for row in results:
        print(print_table_row(row, cols))

    return results

def query_call_to_sale_time(cursor):
    """Query 4: Time from First Call to Sale"""
    print_header("4. TIME FROM FIRST CALL TO SALE - TOP PERFORMERS (Last 90 Days)")

    query = """
    SELECT
        COALESCE(ProcessName, 'Unknown') as process,
        COALESCE(AgentName, 'Unknown') as agent,
        MIN(CallDate) as first_call_date,
        MAX(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN CallDate END) as sale_date,
        DATEDIFF(MAX(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN CallDate END), MIN(CallDate)) as days_to_sale,
        COUNT(*) as total_calls_before_sale,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales_count
    FROM db_external.CallDetails
    WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND (SaleDone = 'Yes' OR SaleDone = '1')
    GROUP BY ProcessName, AgentName
    HAVING sale_date IS NOT NULL
    ORDER BY days_to_sale ASC, sales_count DESC
    LIMIT 20
    """

    cursor.execute(query)
    results = cursor.fetchall()

    cols = print_table_header("PROCESS", "AGENT", "FIRST_CALL", "SALE_DATE", "DAYS_TO_SALE", "TOTAL_CALLS", "SALES")
    for row in results:
        print(print_table_row(row, cols))

    return results

def query_summary_stats(cursor):
    """Query 5: Summary Statistics"""
    print_header("5. SUMMARY STATISTICS (Last 90 Days)")

    query = """
    SELECT
        COUNT(*) as total_calls,
        COUNT(DISTINCT COALESCE(ProcessName, 'Unknown')) as unique_processes,
        COUNT(DISTINCT COALESCE(AgentName, 'Unknown')) as unique_agents,
        COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as total_offers,
        COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as total_sales,
        ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as overall_conversion_rate,
        ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as overall_offer_rate,
        MIN(CallDate) as data_start_date,
        MAX(CallDate) as data_end_date
    FROM db_external.CallDetails
    WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    """

    cursor.execute(query)
    result = cursor.fetchone()

    if result:
        print(f"Total Calls:              {result[0]}")
        print(f"Unique Processes:         {result[1]}")
        print(f"Unique Agents:            {result[2]}")
        print(f"Total Offers Made:        {result[3]}")
        print(f"Total Sales:              {result[4]}")
        print(f"Overall Conversion Rate:  {result[5]}%")
        print(f"Overall Offer Rate:       {result[6]}%")
        print(f"Data Period:              {result[7]} to {result[8]}")

    return result

def main():
    """Execute all queries and generate report"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        print("\n" + "=" * 120)
        print("  SALES FUNNEL ANALYSIS REPORT")
        print("  Data Source: db_external.CallDetails")
        print("  Generated: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        print("=" * 120)

        # Execute all queries
        funnel_data = query_overall_funnel(cursor)
        trend_data = query_conversion_trend(cursor)
        offer_data = query_offer_acceptance(cursor)
        duration_data = query_call_to_sale_time(cursor)
        summary = query_summary_stats(cursor)

        print("\n" + "=" * 120)
        print("  Report completed successfully!")
        print("=" * 120 + "\n")

        cursor.close()
        conn.close()

    except mysql.connector.Error as err:
        if err.errno == 2003:
            print(f"ERROR: Cannot connect to MySQL server. Check DB_HOST and connection.")
        elif err.errno == 1045:
            print(f"ERROR: Access denied. Check DB_USER and DB_PASSWORD.")
        else:
            print(f"MySQL Error [{err.errno}]: {err.msg}")
        exit(1)
    except Exception as err:
        print(f"ERROR: {str(err)}")
        exit(1)

if __name__ == '__main__':
    main()
