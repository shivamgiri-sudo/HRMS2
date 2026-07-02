CREATE TABLE IF NOT EXISTS org_settings (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  setting_key   VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  label         VARCHAR(255),
  updated_by    CHAR(36),
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_setting_key (setting_key)
);

INSERT IGNORE INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'domain_whitelist', '[]', 'Allowed email domains'),
  (UUID(), 'office_location_lat', NULL, 'Office latitude'),
  (UUID(), 'office_location_lng', NULL, 'Office longitude'),
  (UUID(), 'office_radius_meters', '200', 'Geofence radius in meters');
