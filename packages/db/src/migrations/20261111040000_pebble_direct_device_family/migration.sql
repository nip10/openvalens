-- Issue #427: Pebble watches are a direct-device family.
-- The family allowlist widens by one value, so no row can violate the new
-- check; the NOT VALID / VALIDATE split follows docs/migration-safety.md
-- (metadata-only drop+add, then a validation scan that does not block
-- reads or writes on the PHI-adjacent provider_connection table).
ALTER TABLE provider_connection
  DROP CONSTRAINT provider_connection_direct_device_identity_family_check;

ALTER TABLE provider_connection
  ADD CONSTRAINT provider_connection_direct_device_identity_family_check
  CHECK (
    direct_device_family IS NULL
    OR direct_device_family IN ('zepp_os', 'xiaomi', 'huawei', 'garmin', 'ble_gatt', 'ble_scale', 'colmi_ring', 'bangle_js', 'gloryfit', 'huami_legacy', 'moyoung', 'fitpro', 'casio', 'pebble')
  ) NOT VALID;

ALTER TABLE provider_connection
  VALIDATE CONSTRAINT provider_connection_direct_device_identity_family_check;
