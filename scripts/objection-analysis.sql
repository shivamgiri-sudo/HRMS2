-- ============================================================================
-- OBJECTION PATTERNS ANALYSIS
-- ============================================================================
-- Query: Call Analysis - Objection Handling Intelligence
-- Purpose: Extract top objection types, resolution rates, sales conversion, handlers
-- Date: 2026-06-21
-- ============================================================================

USE mas_hrms;

-- ============================================================================
-- 1. TOP OBJECTION TYPES WITH RESOLUTION RATES AND SALES CONVERSION
-- ============================================================================
-- Shows: objection type, frequency, how often it was handled, resolution %,
--        sales closed after objection was handled, and top handler (agent)

SELECT
    OBJECTION,
    COUNT(*) as CALL_COUNT,
    SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
    ROUND(
        (SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
    ) as RESOLUTION_RATE_PCT,
    SUM(CASE
        WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
        AND (SaleDone = 'Yes' OR SaleDone = '1')
        THEN 1 ELSE 0
    END) as SALES_AFTER_OBJECTION,
    ROUND(
        (SUM(CASE
            WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
            AND (SaleDone = 'Yes' OR SaleDone = '1')
            THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
    ) as SALES_CLOSE_RATE_AFTER_OBJECTION_PCT
FROM db_external.CallDetails
WHERE OBJECTION IS NOT NULL
    AND OBJECTION != ''
    AND OBJECTION != 'null'
    AND CustomerObjectionCategory IS NOT NULL
GROUP BY OBJECTION
ORDER BY CALL_COUNT DESC
LIMIT 50;

-- ============================================================================
-- 2. TOP OBJECTION HANDLERS - AGENTS WITH BEST RESOLUTION RATES
-- ============================================================================
-- Shows: agent (User), objection types handled, success rate, sales conversion rate

SELECT
    cd.User as HANDLER_CODE,
    COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, COALESCE(e.last_name,'')), cd.User) AS HANDLER_NAME,
    COUNT(*) as OBJECTIONS_HANDLED,
    COUNT(DISTINCT cd.OBJECTION) as UNIQUE_OBJECTION_TYPES,
    ROUND(
        (SUM(CASE
            WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
            AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
            THEN 1 ELSE 0
        END) * 100.0) / COUNT(*), 2
    ) as SALES_CLOSE_RATE_AFTER_OBJ_PCT,
    SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
    END) as SALES_CLOSED_COUNT
FROM db_external.CallDetails cd
LEFT JOIN mas_hrms.employees e ON e.employee_code = cd.User
WHERE cd.OBJECTION IS NOT NULL
    AND cd.OBJECTION != ''
    AND cd.OBJECTION != 'null'
    AND cd.ObjectionHandling IS NOT NULL
    AND cd.ObjectionHandling NOT IN ('', 'null')
    AND cd.User IS NOT NULL
GROUP BY cd.User, e.full_name, e.first_name, e.last_name
HAVING COUNT(*) >= 5
ORDER BY SALES_CLOSE_RATE_AFTER_OBJ_PCT DESC
LIMIT 50;

-- ============================================================================
-- 3. SALES CLOSED AFTER OBJECTION HANDLING - SUCCESS TRACKING
-- ============================================================================
-- Shows: objection type, how many times objection was handled, sales closed after handling

SELECT
    cd.OBJECTION,
    COUNT(*) as OBJECTION_RAISED_COUNT,
    SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
    SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
    END) as SALES_CLOSED_AFTER_HANDLING,
    ROUND(
        (SUM(CASE
            WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
            AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
            THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
    ) as CONVERSION_RATE_AFTER_HANDLING_PCT
FROM db_external.CallDetails cd
WHERE cd.OBJECTION IS NOT NULL
    AND cd.OBJECTION != ''
    AND cd.OBJECTION != 'null'
GROUP BY cd.OBJECTION
ORDER BY SALES_CLOSED_AFTER_HANDLING DESC
LIMIT 50;

-- ============================================================================
-- 4. OBJECTION TYPES BY PROCESS - PROCESS-LEVEL ANALYSIS
-- ============================================================================
-- Shows: process code, objection type, frequency, resolution rate, sales conversion

SELECT
    COALESCE(cd.campaign_id, 'UNASSIGNED') as PROCESS_CODE,
    COALESCE(pm.process_name, cd.campaign_id, 'UNASSIGNED') as PROCESS_NAME,
    cd.OBJECTION,
    COUNT(*) as OBJECTION_COUNT,
    SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
    ROUND(
        (SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
    ) as RESOLUTION_RATE_PCT,
    SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
    END) as SALES_AFTER_OBJECTION
FROM db_external.CallDetails cd
LEFT JOIN mas_hrms.process_master pm ON pm.process_code = cd.campaign_id
WHERE cd.OBJECTION IS NOT NULL
    AND cd.OBJECTION != ''
    AND cd.OBJECTION != 'null'
GROUP BY cd.campaign_id, pm.process_name, cd.OBJECTION
ORDER BY PROCESS_CODE, OBJECTION_COUNT DESC
LIMIT 100;

-- ============================================================================
-- 5. CONSOLIDATED OBJECTION & REBUTTAL MATRIX (from tbl_obj reference table)
-- ============================================================================
-- Shows: objection, recommended rebuttal, frequency in system

SELECT
    obj.Objection as OBJECTION,
    obj.Rebutal as RECOMMENDED_REBUTTAL,
    COUNT(*) as FREQUENCY
FROM db_external.tbl_obj obj
WHERE obj.Objection IS NOT NULL
    AND obj.Objection != ''
    AND obj.Objection != 'null'
GROUP BY obj.Objection, obj.Rebutal
ORDER BY FREQUENCY DESC
LIMIT 100;

-- ============================================================================
-- 6. SUMMARY DASHBOARD - OBJECTION HEALTH METRICS
-- ============================================================================

SELECT
    COUNT(*) as TOTAL_OBJECTIONS_RAISED,
    COUNT(DISTINCT OBJECTION) as UNIQUE_OBJECTION_TYPES,
    SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as TOTAL_OBJECTIONS_HANDLED,
    ROUND(
        (SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
    ) as OVERALL_RESOLUTION_RATE_PCT,
    SUM(CASE
        WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
        AND (SaleDone = 'Yes' OR SaleDone = '1')
        THEN 1 ELSE 0
    END) as SALES_CLOSED_AFTER_OBJECTION_HANDLING,
    ROUND(
        (SUM(CASE
            WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
            AND (SaleDone = 'Yes' OR SaleDone = '1')
            THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
    ) as SALES_CONVERSION_AFTER_OBJECTION_PCT,
    COUNT(DISTINCT User) as UNIQUE_HANDLERS,
    COUNT(DISTINCT client_id) as UNIQUE_CLIENTS,
    COUNT(DISTINCT campaign_id) as UNIQUE_PROCESSES
FROM db_external.CallDetails
WHERE OBJECTION IS NOT NULL
    AND OBJECTION != ''
    AND OBJECTION != 'null';
