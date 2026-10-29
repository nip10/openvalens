export interface HealthConsentStatus {
  required: boolean;
  currentVersion: string | null;
  accepted: boolean;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  privacyUrl: string | null;
}

export function needsHealthConsent(status: HealthConsentStatus | null | undefined): boolean {
  return (
    !!status?.required && (!status.accepted || status.acceptedVersion !== status.currentVersion)
  );
}
