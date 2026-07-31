-- 1020_branch_master_address_backfill.sql
--
-- Backfills branch_master.address for the branches that carry the bulk of active
-- headcount, so the digital ID card's back face can print a real postal address
-- instead of falling back to the branch name.
--
-- Before this ran, 1 of 45 branches had an address (NOIDA), so only 406 of 1152
-- active employees (35%) got one. Filling the three branches below takes that to
-- 1052 of 1152 (91%).
--
-- Every statement is guarded by `address IS NULL OR TRIM(address) = ''`, so it is
-- idempotent AND it will never overwrite an address that HR later edits through
-- Organisation Masters -> Branches -> Full Address. Re-running is a no-op.
--
-- Addresses supplied by the user (shivam.giri@teammas.in) on 2026-07-31.
-- Deliberately NOT backfilled: DELHI (Delhi Office, 51 staff) and HQ (Head Office
-- Mumbai, 12 staff) -- addresses not yet supplied. Both branches are also
-- active_status = 0 while holding active employees, which is a separate data issue.
-- Those two keep the branch-name fallback until their addresses are provided.

SET NAMES utf8mb4;

-- NOIDA-2 -- 362 active employees
UPDATE branch_master
   SET address = 'Okaya Tower-1, 3rd Floor,\nSector 62, Noida,\nUttar Pradesh – 201301'
 WHERE branch_code = 'NOIDA-2'
   AND (address IS NULL OR TRIM(address) = '');

-- AHMEDABAD-JALDARSHAN -- 271 active employees
UPDATE branch_master
   SET address = 'Gate No. 01, F-15, Jal Darshan Commercial Building,\nAshram Road, Near Bank of Baroda,\nOpp. Old Natraj Theatre,\nAhmedabad, Gujarat – 380006'
 WHERE branch_code = 'AHMH-JD'
   AND (address IS NULL OR TRIM(address) = '');

-- HEAD OFFICE (CORP) -- 13 active employees.
-- Shares the NOIDA premises, so the address is copied from that row rather than
-- retyped, and stays correct if NOIDA's address is later corrected in one place.
-- The derived table is required: MySQL cannot read the target table directly in a
-- subquery of its own UPDATE.
UPDATE branch_master b
  JOIN (SELECT address FROM branch_master WHERE branch_code = 'NOIDA') src
    ON 1 = 1
   SET b.address = src.address
 WHERE b.branch_code = 'CORP'
   AND (b.address IS NULL OR TRIM(b.address) = '')
   AND src.address IS NOT NULL
   AND TRIM(src.address) <> '';
