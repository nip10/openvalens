export const DIRECT_DEVICE_SCHEMA_VERSION = 4;

export const DIRECT_DEVICE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS direct_device_binding (
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    provider_connection_id INTEGER,
    capture_checkpoint TEXT,
    family TEXT,
    model_id TEXT,
    pebble_native_id TEXT,
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
  CREATE TABLE IF NOT EXISTS direct_device_pebble_item (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    log_tag INTEGER NOT NULL CHECK(log_tag IN (81, 83, 84)),
    item_type INTEGER NOT NULL,
    item_size INTEGER NOT NULL,
    session_timestamp INTEGER NOT NULL,
    raw_hex TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(scope, device_id, log_tag, item_type, item_size, raw_hex)
  );
  CREATE INDEX IF NOT EXISTS direct_device_pebble_item_order
    ON direct_device_pebble_item(scope, device_id, seq);
  CREATE TABLE IF NOT EXISTS direct_device_pebble_projection (
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('activity', 'sleep')),
    revision INTEGER NOT NULL,
    through_seq INTEGER NOT NULL,
    manifest_json TEXT NOT NULL,
    PRIMARY KEY(scope, device_id, kind)
  );
  CREATE TABLE IF NOT EXISTS direct_device_fossil_file (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    file_crc INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    raw_hex TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('stored', 'unreadable')),
    created_at INTEGER NOT NULL,
    UNIQUE(scope, device_id, file_crc, file_size)
  );
  CREATE TABLE IF NOT EXISTS direct_device_fossil_projection (
    scope TEXT NOT NULL,
    device_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    coverage_json TEXT NOT NULL,
    PRIMARY KEY(scope, device_id)
  );
`;
