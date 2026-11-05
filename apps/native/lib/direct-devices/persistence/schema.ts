export const DIRECT_DEVICE_SCHEMA_VERSION = 1;

export const DIRECT_DEVICE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS direct_device_binding (
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    provider_connection_id INTEGER,
    capture_checkpoint TEXT,
    PRIMARY KEY(scope, device_id)
  );
  CREATE TABLE IF NOT EXISTS direct_device_capture (
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    checkpoint_json TEXT NOT NULL,
    envelope_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(scope, device_id, capture_id)
  );
  CREATE TABLE IF NOT EXISTS direct_device_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    envelope_index INTEGER NOT NULL,
    request_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending', 'accepted', 'blocked')),
    receipt_json TEXT,
    last_error_code TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(scope, device_id, capture_id, envelope_index)
  );
  CREATE INDEX IF NOT EXISTS direct_device_outbox_pending
    ON direct_device_outbox(scope, state, seq);
`;
