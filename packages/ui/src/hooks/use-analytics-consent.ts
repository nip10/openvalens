import * as React from "react";

type Preference = { enabled: boolean; available: boolean };
type EventName = "preferences_opened" | "appearance_control_used" | "preferences_load_failed";
export type AnalyticsConsentApi = {
  getPreference(input: Record<string, never>): Promise<Preference>;
  setPreference(input: { enabled: boolean }): Promise<Preference>;
  capture(input: { event: EventName }): Promise<{ accepted: boolean }>;
};
type Pending = null | "read" | "enable" | "revoke";
type Failure = null | "read" | "enable" | "revoke";
type Snapshot = { preference: Preference | null; pending: Pending; error: Failure };
type Authority = {
  mounted: boolean;
  active: boolean;
  scope: string;
  generation: number;
  pending: Pending;
  gate: boolean;
  preference: Preference | null;
  error: Failure;
  openingHandled: boolean;
  explicitAction: boolean;
};

const revocationLatch = new Set<string>();

export function useAnalyticsConsent({
  api,
  scope,
  ownerId,
  active = true,
}: {
  api: AnalyticsConsentApi;
  scope: string;
  ownerId: string;
  active?: boolean;
}) {
  const authority = React.useRef<Authority>({
    mounted: false, active: false, scope: "", generation: 0, pending: null,
    gate: false, preference: null, error: null, openingHandled: false,
    explicitAction: false,
  });
  const [snapshot, setSnapshot] = React.useState<Snapshot>({ preference: null, pending: null, error: null });
  const trustedScope = React.useRef(scope);
  trustedScope.current = scope;
  const trustedOwner = React.useRef(ownerId);
  trustedOwner.current = ownerId;

  const owns = React.useCallback((capturedScope: string, capturedOwner: string, generation: number) => {
    const current = authority.current;
    return current.mounted && current.active && current.scope === capturedScope &&
      current.generation === generation && trustedScope.current === capturedScope && trustedOwner.current === capturedOwner;
  }, []);
  const publish = React.useCallback(() => {
    const current = authority.current;
    setSnapshot({ preference: current.preference, pending: current.pending, error: current.error });
  }, []);

  const deactivate = React.useCallback(() => {
    const current = authority.current;
    current.active = false;
    current.gate = false;
    current.pending = null;
    current.generation += 1;
    if (current.mounted) publish();
  }, [publish]);

  const read = React.useCallback(async () => {
    const current = authority.current;
    if (!current.mounted || !current.active || !current.scope || trustedScope.current !== current.scope || trustedOwner.current !== ownerId || current.pending) return;
    const capturedScope = current.scope;
    const capturedOwner = ownerId;
    const generation = ++current.generation;
    current.pending = "read";
    current.error = null;
    current.gate = false;
    publish();
    try {
      const preference = await api.getPreference({});
      if (!owns(capturedScope, capturedOwner, generation)) return;
      current.preference = preference;
      if (revocationLatch.has(ownerId)) {
        current.gate = false;
        current.error = "revoke";
      } else if (!current.explicitAction && preference.enabled && preference.available) {
        current.gate = true;
        if (!current.openingHandled) {
          current.openingHandled = true;
          void api.capture({ event: "preferences_opened" }).catch(() => undefined);
        }
      } else {
        current.gate = false;
        current.openingHandled = true;
      }
    } catch {
      if (!owns(capturedScope, capturedOwner, generation)) return;
      current.gate = false;
      current.error = revocationLatch.has(ownerId) ? "revoke" : "read";
    } finally {
      if (owns(capturedScope, capturedOwner, generation)) {
        current.pending = null;
        publish();
      }
    }
  }, [api, ownerId, owns, publish]);

  const activate = React.useCallback(() => {
    const current = authority.current;
    if (!current.mounted || !current.scope || trustedScope.current !== current.scope || current.active) return;
    current.active = true;
    current.gate = false;
    current.pending = null;
    current.error = null;
    current.explicitAction = false;
    current.openingHandled = false;
    current.generation += 1;
    void read();
  }, [read]);

  const setPreference = React.useCallback(async (enabled: boolean) => {
    const current = authority.current;
    if (!current.mounted || !current.active || !current.scope || trustedScope.current !== current.scope || trustedOwner.current !== ownerId || current.pending) return;
    const scopeAtStart = current.scope;
    if (enabled && (!current.preference?.available || current.error === "read" || current.preference.enabled && !revocationLatch.has(ownerId))) return;
    if (!enabled && !current.preference?.enabled && !revocationLatch.has(ownerId)) return;
    const action = enabled ? "enable" : "revoke";
    current.gate = false;
    current.pending = action;
    current.error = null;
    current.explicitAction = true;
    current.openingHandled = true;
    if (!enabled) revocationLatch.add(ownerId);
    const generation = ++current.generation;
    publish();
    try {
      const preference = await api.setPreference({ enabled });
      if (!owns(scopeAtStart, ownerId, generation)) return;
      current.preference = preference;
      const acceptedAck = enabled
        ? preference.enabled === true && preference.available === true
        : preference.enabled === false;
      if (!acceptedAck) {
        current.gate = false;
        current.error = action;
      } else {
        revocationLatch.delete(ownerId);
        current.error = null;
        current.gate = enabled && preference.available;
      }
    } catch {
      if (!owns(scopeAtStart, ownerId, generation)) return;
      current.gate = false;
      current.error = action;
    } finally {
      if (owns(scopeAtStart, ownerId, generation)) {
        current.pending = null;
        publish();
      }
    }
  }, [api, ownerId, owns, publish]);

  const retry = React.useCallback(() => {
    const current = authority.current;
    if (!current.active || current.pending || !current.error) return;
    if (current.error === "read" && !revocationLatch.has(ownerId)) void read();
    else void setPreference(current.error === "enable");
  }, [ownerId, read, setPreference]);

  React.useLayoutEffect(() => {
    const current = authority.current;
    current.mounted = true;
    const changedScope = current.scope !== scope;
    if (changedScope) {
      current.active = false;
      current.gate = false;
      current.pending = null;
      current.preference = null;
      current.error = null;
      current.scope = scope;
      current.generation += 1;
      current.openingHandled = false;
      current.explicitAction = false;
    }
    if (active && scope) activate();
    else deactivate();
    publish();
    return () => {
      current.active = false;
      current.gate = false;
      current.pending = null;
      current.generation += 1;
      current.mounted = false;
    };
  }, [scope, active, activate, deactivate, publish]);

  const current = authority.current;
  const ownsRenderedScope = !!scope && !!ownerId && trustedScope.current === scope && trustedOwner.current === ownerId && current.scope === scope && current.active;
  const preference = ownsRenderedScope ? snapshot.preference : null;
  const pending = ownsRenderedScope ? snapshot.pending : null;
  const error = ownsRenderedScope ? snapshot.error : null;
  const gate = ownsRenderedScope && current.gate && !revocationLatch.has(ownerId);
  return { preference, pending, error, gate, locallyRevoked: ownsRenderedScope && revocationLatch.has(ownerId), setPreference, retry, refresh: read, activate, deactivate };
}
