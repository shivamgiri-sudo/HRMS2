-- Migrate employee photo URLs from /uploads/ static path to /api/files/ API path.
-- This makes photos accessible on all devices via the nginx-proxied API endpoint.
-- Safe to run multiple times: LIKE guard prevents double-migration.

UPDATE employees
   SET avatar_url = REPLACE(avatar_url, '/uploads/employee-photos/', '/api/files/employee-photos/'),
       photo_url  = REPLACE(photo_url,  '/uploads/employee-photos/', '/api/files/employee-photos/')
 WHERE avatar_url LIKE '/uploads/employee-photos/%'
    OR photo_url  LIKE '/uploads/employee-photos/%';
