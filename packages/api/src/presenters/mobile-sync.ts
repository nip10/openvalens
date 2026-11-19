import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

type DeviceStatus = {
  deviceId: string;
  provider: string;
  status: string;
  lastIngestAt: string | null;
};

export const MOBILE_SYNC_COPY = {
  title: msg`Phone sync`,
  empty: msg`No records received from your phone yet.`,
  error: msg`Could not load phone sync status.`,
};

/** One latest receipt per phone integration; revoked devices do not imply an active sync. */
export function latestPhoneSync(devices: readonly DeviceStatus[]): DeviceStatus[] {
  const latest = new Map<string, DeviceStatus>();
  const timestamp = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
  for (const device of devices) {
    if (device.status === "revoked") continue;
    const current = latest.get(device.provider);
    if (!current || timestamp(device.lastIngestAt) > timestamp(current.lastIngestAt))
      latest.set(device.provider, device);
  }
  return [...latest.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

export function phoneSyncLine(device: DeviceStatus, i18n: I18n): string {
  const provider = device.provider === "apple_health" ? "Apple Health" : "Health Connect";
  const at = device.lastIngestAt ? new Date(device.lastIngestAt) : null;
  if (!at || !Number.isFinite(at.getTime()))
    return i18n._(msg`${provider}: no records received yet.`);
  const when = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
  return i18n._(msg`Last received from ${provider}: ${when}`);
}
