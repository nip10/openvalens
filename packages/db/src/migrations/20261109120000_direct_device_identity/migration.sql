ALTER TABLE provider_connection
  ADD COLUMN direct_device_family text,
  ADD COLUMN direct_device_model_id text;

ALTER TABLE provider_connection
  ADD CONSTRAINT provider_connection_direct_device_identity_pair_check
  CHECK ((direct_device_family IS NULL) = (direct_device_model_id IS NULL));

ALTER TABLE provider_connection
  ADD CONSTRAINT provider_connection_direct_device_identity_provider_check
  CHECK (direct_device_family IS NULL OR provider = 'direct_device');

ALTER TABLE provider_connection
  ADD CONSTRAINT provider_connection_direct_device_identity_family_check
  CHECK (direct_device_family IS NULL OR direct_device_family IN ('zepp_os', 'xiaomi', 'huawei', 'garmin'));
