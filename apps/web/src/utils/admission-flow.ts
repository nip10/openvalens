/**
 * Issue #63 admission flow controller.
 *
 * A small state machine that owns the volatile admission lifecycle:
 * email + credential → verification code → complete.
 *
 * Design constraints:
 * - Secrets (credential, enrollmentId, code) live only in this controller's
 *   state and are never written to storage, URL, query cache, or logs.
 * - Direct typed oRPC client calls (no React Query mutation cache for secrets).
 * - Late/async outcomes are ignored when the principal, kind, or mounted state
 *   has changed.
 * - Sync in-flight guard blocks same-tick duplicate submits; a per-request epoch
 *   token prevents an old request's cleanup from releasing a new request's guard.
 * - Principal identity is user.id. The hook reinitializes the controller in a
 *   commit-phase effect on userId/kind changes, wiping secrets so a new actor
 *   must re-enter the token and code from scratch.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AdmissionKind } from "./admission-keys";
import { classifyAdmissionError, type AdmissionErrorCode } from "./admission-error";
import { client } from "./orpc";

export type AdmissionApi = {
  begin: (input: { kind: AdmissionKind; credential: string; email: string }) => Promise<{
    enrollmentId: string;
  }>;
  complete: (input: {
    enrollmentId: string;
    credential: string;
    verificationCode: string;
  }) => Promise<{ completed: true }>;
};

export type AdmissionStep = "token" | "code" | "success";

export type AdmissionFlowState = {
  step: AdmissionStep;
  email: string;
  credential: string;
  code: string;
  enrollmentId: string;
  errorCode: AdmissionErrorCode | null;
  credentialVisible: boolean;
  isBusy: boolean;
  /**
   * True when the flow finished while a session matching the form email was
   * present. The backend is the authority; this is only a UI hint.
   */
  hasMatchingSession: boolean;
  /** Non-error transient status for magic-link delivery feedback. */
  linkDelivery: "idle" | "sending" | "sent" | "error";
  /** Owner stamp used by the React hook to discard state from a prior scope. */
  ownerKey: string;
};

export type AdmissionFlow = {
  userId: string | null;
  ownerKey: string;
  get state(): AdmissionFlowState;
  setEmail: (email: string) => void;
  setCredential: (credential: string) => void;
  setCode: (code: string) => void;
  setSessionEmail: (sessionEmail: string | null) => void;
  toggleCredentialVisible: () => void;
  begin: () => Promise<void>;
  complete: () => Promise<void>;
  resend: () => Promise<void>;
  reset: () => void;
  requestMagicLink: (purpose: "resume" | "dashboard") => Promise<void>;
  /** Test-only: simulate unmount. Clears retained secrets. */
  _unmount: () => void;
};

export type AdmissionFlowActions = Omit<
  AdmissionFlow,
  "state" | "get state" | "_unmount" | "userId" | "ownerKey" | "setSessionEmail"
> & {
  state: AdmissionFlowState;
};

function makeOwnerKey(kind: AdmissionKind, userId: string | null): string {
  return `${kind}:${userId ?? "anon"}`;
}

function initialState(ownerKey: string, step: AdmissionStep = "token"): AdmissionFlowState {
  return {
    step,
    email: "",
    credential: "",
    code: "",
    enrollmentId: "",
    errorCode: null,
    credentialVisible: false,
    isBusy: false,
    hasMatchingSession: false,
    linkDelivery: "idle",
    ownerKey,
  };
}

export function createAdmissionFlow({
  kind,
  userId,
  sessionEmail,
  onRequestMagicLink,
  onStateChange,
  admissionApi = client.admission,
}: {
  kind: AdmissionKind;
  userId: string | null;
  sessionEmail: string | null;
  onRequestMagicLink: (email: string, purpose: "resume" | "dashboard") => Promise<void>;
  onStateChange: (state: AdmissionFlowState) => void;
  admissionApi?: AdmissionApi;
}): AdmissionFlow {
  const ownerKey = makeOwnerKey(kind, userId);
  let state = initialState(ownerKey);
  let epoch = 0;
  let unmounted = false;
  let liveSessionEmail = sessionEmail;

  function notify(next: AdmissionFlowState) {
    if (unmounted) return;
    state = next;
    onStateChange(next);
  }

  function safeUpdate(partial: Partial<AdmissionFlowState>) {
    notify({ ...state, ...partial });
  }

  function isSessionMatch(email: string): boolean {
    if (!liveSessionEmail) return false;
    return liveSessionEmail.toLowerCase() === email.toLowerCase();
  }

  function setSessionEmail(next: string | null) {
    liveSessionEmail = next;
  }

  function checkStale(requestEpoch: number): boolean {
    return unmounted || requestEpoch !== epoch;
  }

  function clearSecrets(step: AdmissionStep, prev: AdmissionFlowState): AdmissionFlowState {
    return {
      ...initialState(ownerKey, step),
      email: prev.email,
      hasMatchingSession: step === "success" ? isSessionMatch(prev.email) : false,
      linkDelivery: step === "success" ? prev.linkDelivery : "idle",
    };
  }

  function setEmail(email: string) {
    safeUpdate({ email, errorCode: null });
  }

  function setCredential(credential: string) {
    safeUpdate({ credential, errorCode: null });
  }

  function setCode(code: string) {
    safeUpdate({ code, errorCode: null });
  }

  function toggleCredentialVisible() {
    safeUpdate({ credentialVisible: !state.credentialVisible });
  }

  function reset() {
    epoch += 1;
    notify(initialState(ownerKey));
  }

  async function begin() {
    if (state.isBusy) return;
    const email = state.email.trim();
    if (email.length === 0 || email.length > 320) {
      safeUpdate({ errorCode: "invalid_input" });
      return;
    }
    const credential = state.credential;
    if (credential.length === 0 || credential.length > 512) {
      safeUpdate({ errorCode: "invalid_input" });
      return;
    }

    const requestEpoch = ++epoch;
    safeUpdate({ errorCode: null, isBusy: true });

    try {
      const result = await admissionApi.begin({ kind, credential, email });
      if (checkStale(requestEpoch)) return;
      notify({
        ...state,
        step: "code",
        enrollmentId: result.enrollmentId,
        code: "",
        errorCode: null,
        isBusy: false,
      });
    } catch (error) {
      if (checkStale(requestEpoch)) return;
      safeUpdate({ errorCode: classifyAdmissionError(error), isBusy: false });
    }
  }

  async function complete() {
    if (state.isBusy) return;
    const code = state.code;
    const enrollmentId = state.enrollmentId;
    const credential = state.credential;
    if (
      code.length === 0 ||
      code.length > 512 ||
      enrollmentId.length === 0 ||
      credential.length === 0
    ) {
      safeUpdate({ errorCode: "invalid_input" });
      return;
    }

    const requestEpoch = ++epoch;
    safeUpdate({ errorCode: null, isBusy: true });

    try {
      await admissionApi.complete({ enrollmentId, credential, verificationCode: code });
      if (checkStale(requestEpoch)) return;
      notify(clearSecrets("success", state));
    } catch (error) {
      if (checkStale(requestEpoch)) return;
      const codeErr = classifyAdmissionError(error);
      if (codeErr === "denied" && !isSessionMatch(state.email)) {
        safeUpdate({ errorCode: "session_mismatch", isBusy: false });
      } else {
        safeUpdate({ errorCode: codeErr, isBusy: false });
      }
    }
  }

  async function resend() {
    if (state.isBusy) return;
    const email = state.email;
    const credential = state.credential;
    if (email.length === 0 || credential.length === 0) return;

    const requestEpoch = ++epoch;
    safeUpdate({ errorCode: null, isBusy: true });

    try {
      await admissionApi.begin({ kind, credential, email });
      if (checkStale(requestEpoch)) return;
      safeUpdate({ code: "", errorCode: null, isBusy: false });
    } catch (error) {
      if (checkStale(requestEpoch)) return;
      safeUpdate({ errorCode: classifyAdmissionError(error), isBusy: false });
    }
  }

  async function requestMagicLink(purpose: "resume" | "dashboard") {
    if (state.linkDelivery === "sending") return;
    const email = state.email.trim();
    if (email.length === 0) return;

    const requestEpoch = ++epoch;
    safeUpdate({ linkDelivery: "sending", errorCode: null });

    try {
      await onRequestMagicLink(email, purpose);
      if (checkStale(requestEpoch)) return;
      safeUpdate({ linkDelivery: "sent" });
    } catch {
      if (checkStale(requestEpoch)) return;
      safeUpdate({ linkDelivery: "error", errorCode: "delivery_failed" });
    }
  }

  function doUnmount() {
    unmounted = true;
    epoch += 1;
    // Wipe retained secrets from this controller instance.
    state = initialState(ownerKey);
  }

  return {
    userId,
    ownerKey,
    get state() {
      return state;
    },
    setEmail,
    setCredential,
    setCode,
    setSessionEmail,
    toggleCredentialVisible,
    begin,
    complete,
    resend,
    reset,
    requestMagicLink,
    _unmount: doUnmount,
  };
}

export function useAdmissionFlow({
  kind,
  userId,
  sessionEmail,
  onRequestMagicLink,
  admissionApi = client.admission,
}: {
  kind: AdmissionKind;
  userId: string | null;
  sessionEmail: string | null;
  onRequestMagicLink: (email: string, purpose: "resume" | "dashboard") => Promise<void>;
  admissionApi?: AdmissionApi;
}): AdmissionFlowActions {
  const ownerKey = makeOwnerKey(kind, userId);
  const [state, setState] = useState<AdmissionFlowState>(() => initialState(ownerKey));
  const controllerRef = useRef<AdmissionFlow | null>(null);

  // Commit-phase ownership: create the controller here, not during render, so
  // StrictMode teardown/replay correctly discards the old instance and creates
  // a fresh one before paint. userId/kind changes reinitialize the controller
  // and wipe secrets for the new principal.
  useLayoutEffect(() => {
    const controller = createAdmissionFlow({
      kind,
      userId,
      sessionEmail,
      onRequestMagicLink,
      onStateChange: setState,
      admissionApi,
    });
    controllerRef.current = controller;
    setState(controller.state);

    return () => {
      controller._unmount();
      controllerRef.current = null;
      setState(initialState(ownerKey));
    };
  }, [kind, userId]);

  // React to email-only changes (same principal signed in with a different
  // verified email) without resetting the flow.
  useLayoutEffect(() => {
    controllerRef.current?.setSessionEmail(sessionEmail);
  }, [sessionEmail]);

  // Action callbacks are bound to this render's owner. Old closures from a
  // previous {kind, userId} scope cannot invoke a controller that belongs to a
  // different owner, even during the brief window before a layout effect runs.
  const actions = useMemo(
    () => ({
      setEmail: (email: string) => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return;
        ctrl.setEmail(email);
      },
      setCredential: (credential: string) => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return;
        ctrl.setCredential(credential);
      },
      setCode: (code: string) => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return;
        ctrl.setCode(code);
      },
      toggleCredentialVisible: () => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return;
        ctrl.toggleCredentialVisible();
      },
      begin: () => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return Promise.resolve();
        return ctrl.begin();
      },
      complete: () => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return Promise.resolve();
        return ctrl.complete();
      },
      resend: () => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return Promise.resolve();
        return ctrl.resend();
      },
      reset: () => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return;
        ctrl.reset();
      },
      requestMagicLink: (purpose: "resume" | "dashboard") => {
        const ctrl = controllerRef.current;
        if (!ctrl || ctrl.ownerKey !== ownerKey) return Promise.resolve();
        return ctrl.requestMagicLink(purpose);
      },
    }),
    [ownerKey],
  );

  // If React has not yet committed the controller for the current owner (e.g.
  // during the render immediately after a principal change), render a fresh
  // empty state for this owner instead of publishing stale secrets/actions.
  const committedState = state.ownerKey === ownerKey ? state : initialState(ownerKey);
  return { state: committedState, ...actions };
}
