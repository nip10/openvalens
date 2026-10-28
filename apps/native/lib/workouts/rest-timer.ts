import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

import {
  adjustRestTimer,
  EMPTY_REST_TIMER,
  remainingRestSeconds,
  restoreRestTimer,
  startRestTimer,
  type RestTimerState,
} from "./rest-timer-state";

const PREFIX = "workout-rest-timer:v1:";
const DEFAULT_SECONDS = 90;
const CHANNEL = "workout-rest-timer";
type RecordValue = { timer: RestTimerState; preferences: Record<string, number> };
const emptyRecord = (): RecordValue => ({ timer: EMPTY_REST_TIMER, preferences: {} });
const native = Platform.OS === "ios" || Platform.OS === "android";
const MAX_SECONDS = 3600;
const REST_TITLE = msg`Rest timer complete`;
const REST_BODY = msg`Your rest is over.`;
const safeError = () => "rest_timer_storage_error";
const boundedSeconds = (seconds: number) =>
  Number.isFinite(seconds) && Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_SECONDS
    ? seconds
    : null;

function validKey(key: string): string {
  return key.startsWith("id:")
    ? key
    : `name:${key
        .replace(/^name:/, "")
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")}`;
}

async function readRecord(scope: string): Promise<RecordValue> {
  const raw = await AsyncStorage.getItem(PREFIX + encodeURIComponent(scope));
  if (!raw) return emptyRecord();
  try {
    const value = JSON.parse(raw) as Partial<RecordValue>;
    if (
      !value ||
      typeof value !== "object" ||
      !value.timer ||
      typeof value.timer !== "object" ||
      !value.preferences ||
      typeof value.preferences !== "object"
    )
      throw new Error("Invalid saved rest timer record");
    const timer = value.timer as RestTimerState;
    if (
      (timer.deadline !== null &&
        (typeof timer.deadline !== "number" || !Number.isFinite(timer.deadline))) ||
      (timer.exerciseKey !== null && typeof timer.exerciseKey !== "string") ||
      (timer.notificationId !== null && typeof timer.notificationId !== "string") ||
      (timer.notificationMarker != null && typeof timer.notificationMarker !== "string")
    )
      throw new Error("Invalid saved rest timer state");
    if (
      Object.values(value.preferences).some(
        (seconds) => typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0,
      )
    )
      throw new Error("Invalid saved rest timer preferences");
    return { timer: value.timer ?? EMPTY_REST_TIMER, preferences: value.preferences ?? {} };
  } catch (cause) {
    throw new Error("Could not restore saved rest timer", { cause });
  }
}

async function writeRecord(scope: string, value: RecordValue): Promise<void> {
  await AsyncStorage.setItem(PREFIX + encodeURIComponent(scope), JSON.stringify(value));
}

async function cancel(id: string | null): Promise<void> {
  if (native && id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}

async function reconcile(scope: string, timer: RestTimerState): Promise<void> {
  if (!native) return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const marker = timer.notificationMarker;
  if (!marker) return;
  const matching = all.filter((item) => item.content.data?.restTimerId === marker);
  const keep = timer.notificationId;
  await Promise.all(
    matching
      .filter((item) => item.identifier !== keep)
      .map((item) =>
        Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => undefined),
      ),
  );
}

export interface WorkoutRestTimer {
  ready: boolean;
  remainingSeconds: number;
  active: boolean;
  exerciseKey: string | null;
  restSeconds(exerciseKey: string, fallbackSeconds?: number): number;
  setRestSeconds(key: string, seconds: number): Promise<boolean>;
  start(key: string, seconds?: number): Promise<boolean>;
  adjust(seconds: number): Promise<boolean>;
  skip(): Promise<boolean>;
  enableAlerts(): Promise<"granted" | "denied" | "unsupported">;
  alertsPrecision: "best-effort" | "unavailable";
  error: string | null;
}

export function useWorkoutRestTimer(scope: string | null): WorkoutRestTimer {
  const { i18n } = useLingui();
  const [ready, setReady] = useState(false);
  const [remainingSeconds, setRemaining] = useState(0);
  const [timer, setTimer] = useState<RestTimerState>(EMPTY_REST_TIMER);
  const [preferences, setPreferences] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef(scope);
  const recordRef = useRef<RecordValue>(emptyRecord());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const finishRef = useRef<string | null>(null);
  const loadedScopeRef = useRef<string | null>(null);
  scopeRef.current = scope;
  if (loadedScopeRef.current !== scope) {
    loadedScopeRef.current = null;
    recordRef.current = emptyRecord();
    finishRef.current = null;
  }

  const serialize = useCallback(<T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    setReady(false);
    setError(null);
    setTimer(EMPTY_REST_TIMER);
    setPreferences({});
    setRemaining(0);
    recordRef.current = emptyRecord();
    loadedScopeRef.current = null;
    if (!scope)
      return () => {
        live = false;
      };
    void serialize(async () => {
      const record = await readRecord(scope);
      if (!live || scopeRef.current !== scope) return;
      record.timer = restoreRestTimer(record.timer, Date.now());
      recordRef.current = record;
      await reconcile(scope, record.timer);
      if (!live || scopeRef.current !== scope) return;
      if (record.timer.deadline && native) {
        const all = await Notifications.getAllScheduledNotificationsAsync();
        if (!live || scopeRef.current !== scope) return;
        const exists =
          record.timer.notificationId &&
          all.some((n) => n.identifier === record.timer.notificationId);
        if (!exists) {
          record.timer.notificationId = null;
          const markerMatch =
            record.timer.notificationMarker &&
            all.find((n) => n.content.data?.restTimerId === record.timer.notificationMarker);
          if (markerMatch) record.timer.notificationId = markerMatch.identifier;
          else record.timer.notificationMarker = null;
          if (!markerMatch && remainingRestSeconds(record.timer, Date.now()) > 0) {
            try {
              const permission = await Notifications.getPermissionsAsync();
              if (!live || scopeRef.current !== scope) return;
              if (permission.granted) {
                const marker = `workout-rest:${Date.now()}-${Math.random().toString(36).slice(2)}`;
                if (Platform.OS === "android")
                  await Notifications.setNotificationChannelAsync(CHANNEL, {
                    name: "Rest timer",
                    importance: Notifications.AndroidImportance.HIGH,
                    sound: "default",
                    vibrationPattern: [0, 250, 250, 250],
                  });
                if (!live || scopeRef.current !== scope) return;
                const id = await Notifications.scheduleNotificationAsync({
                  content: {
                    title: i18n._(REST_TITLE),
                    body: i18n._(REST_BODY),
                    data: { kind: "workout-rest", restTimerId: marker },
                    sound: "default",
                  },
                  trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.DATE,
                    date: new Date(record.timer.deadline),
                    ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}),
                  },
                });
                if (!live || scopeRef.current !== scope) {
                  await cancel(id);
                  return;
                }
                record.timer = { ...record.timer, notificationId: id, notificationMarker: marker };
              }
            } catch {
              /* timer remains usable without OS alerts */
            }
          }
        }
      }
      if (!live || scopeRef.current !== scope) return;
      await writeRecord(scope, record);
      if (!live || scopeRef.current !== scope) return;
      loadedScopeRef.current = scope;
      setTimer(record.timer);
      setPreferences(record.preferences);
      setRemaining(remainingRestSeconds(record.timer, Date.now()));
      setReady(true);
    }).catch((_cause: unknown) => {
      if (live && scopeRef.current === scope) {
        recordRef.current = emptyRecord();
        setTimer(EMPTY_REST_TIMER);
        setPreferences({});
        setRemaining(0);
        setError(safeError());
        setReady(true);
      }
    });
    return () => {
      live = false;
      // Switching accounts must not leave the previous account's alert pending on this device;
      // its stored deadline reschedules the alert when that scope is loaded again. Unmounting keeps it.
      if (scopeRef.current === scope) return;
      void serialize(async () => {
        const record = await readRecord(scope).catch(() => null);
        await cancel(record?.timer.notificationId ?? null);
      });
    };
  }, [scope, serialize, i18n]);

  useEffect(() => {
    const update = () => {
      if (!scope || !ready || loadedScopeRef.current !== scope || scopeRef.current !== scope)
        return;
      const current = recordRef.current.timer;
      const remaining = remainingRestSeconds(current, Date.now());
      setRemaining(remaining);
      if (
        current.deadline &&
        remaining === 0 &&
        finishRef.current !== `${scope}:${current.deadline}`
      ) {
        finishRef.current = `${scope}:${current.deadline}`;
        if (
          AppState.currentState === "active" &&
          loadedScopeRef.current === scope &&
          scopeRef.current === scope
        )
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
        void serialize(async () => {
          if (scopeRef.current !== scope || recordRef.current.timer.deadline !== current.deadline)
            return;
          await cancel(current.notificationId);
          const next = { ...recordRef.current, timer: EMPTY_REST_TIMER };
          await writeRecord(scope!, next);
          recordRef.current = next;
          setTimer(next.timer);
        }).catch((_cause: unknown) => setError(safeError()));
      }
    };
    update();
    const interval = setInterval(update, 250);
    const subscription = AppState.addEventListener("change", update);
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [scope, ready, serialize]);

  const restSeconds = useCallback(
    (key: string, fallbackSeconds?: number) =>
      preferences[validKey(key)] ??
      boundedSeconds(fallbackSeconds ?? DEFAULT_SECONDS) ??
      DEFAULT_SECONDS,
    [preferences],
  );
  const setRestSeconds = useCallback(
    (key: string, seconds: number) =>
      serialize(async () => {
        const value = boundedSeconds(seconds);
        if (
          !scope ||
          scopeRef.current !== scope ||
          loadedScopeRef.current !== scope ||
          value === null
        )
          return false;
        const next = {
          ...recordRef.current,
          preferences: { ...recordRef.current.preferences, [validKey(key)]: value },
        };
        try {
          if (scopeRef.current !== scope) return false;
          await writeRecord(scope, next);
          if (scopeRef.current !== scope) return false;
          recordRef.current = next;
          setPreferences(next.preferences);
          return true;
        } catch {
          setError(safeError());
          return false;
        }
      }),
    [scope, serialize],
  );
  const start = useCallback(
    (key: string, seconds?: number) =>
      serialize(async () => {
        if (
          !scope ||
          !ready ||
          error ||
          scopeRef.current !== scope ||
          loadedScopeRef.current !== scope
        )
          return false;
        const normalized = validKey(key),
          duration = boundedSeconds(
            seconds ?? recordRef.current.preferences[normalized] ?? DEFAULT_SECONDS,
          );
        if (duration === null) return false;
        const prior = recordRef.current.timer;
        await cancel(prior.notificationId);
        if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
        let next = startRestTimer(prior, normalized, duration, Date.now());
        if (native && duration > 0)
          try {
            const permission = await Notifications.getPermissionsAsync();
            if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
            if (permission.granted) {
              const restTimerId = `workout-rest:${Date.now()}-${Math.random().toString(36).slice(2)}`;
              if (Platform.OS === "android") {
                await Notifications.setNotificationChannelAsync(CHANNEL, {
                  name: "Rest timer",
                  importance: Notifications.AndroidImportance.HIGH,
                  sound: "default",
                  vibrationPattern: [0, 250, 250, 250],
                });
                if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
              }
              const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                  title: i18n._(REST_TITLE),
                  body: i18n._(REST_BODY),
                  data: { kind: "workout-rest", restTimerId },
                  sound: "default",
                },
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: new Date(next.deadline!),
                  ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}),
                },
              });
              if (scopeRef.current !== scope) {
                await cancel(notificationId);
                return false;
              }
              next = { ...next, notificationId, notificationMarker: restTimerId };
            }
          } catch {
            /* notifications are optional */
          }
        const record = { ...recordRef.current, timer: next };
        try {
          if (scopeRef.current !== scope) {
            await cancel(next.notificationId);
            return false;
          }
          await writeRecord(scope, record);
          if (scopeRef.current !== scope) {
            await cancel(next.notificationId);
            return false;
          }
          recordRef.current = record;
          setTimer(next);
          setRemaining(remainingRestSeconds(next, Date.now()));
          return true;
        } catch {
          await cancel(next.notificationId);
          setError(safeError());
          return false;
        }
      }),
    [scope, ready, error, serialize, i18n],
  );
  const finish = useCallback(
    () =>
      serialize(async () => {
        if (!scope || scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
        const old = recordRef.current.timer;
        await cancel(old.notificationId);
        if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
        const record = { ...recordRef.current, timer: EMPTY_REST_TIMER };
        try {
          await writeRecord(scope, record);
          if (scopeRef.current !== scope) return false;
          recordRef.current = record;
          setTimer(record.timer);
          setRemaining(0);
          return true;
        } catch {
          setError(safeError());
          return false;
        }
      }),
    [scope, serialize],
  );
  const adjust = useCallback(
    (seconds: number) =>
      serialize(async () => {
        if (
          !scope ||
          scopeRef.current !== scope ||
          loadedScopeRef.current !== scope ||
          !recordRef.current.timer.deadline ||
          !Number.isInteger(seconds) ||
          !Number.isFinite(seconds) ||
          Math.abs(seconds) > MAX_SECONDS
        )
          return false;
        const old = recordRef.current.timer,
          changed = adjustRestTimer(old, seconds, Date.now());
        await cancel(old.notificationId);
        if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
        if (!changed.deadline) {
          const record = { ...recordRef.current, timer: EMPTY_REST_TIMER };
          await writeRecord(scope, record);
          if (scopeRef.current !== scope) return false;
          recordRef.current = record;
          setTimer(record.timer);
          setRemaining(0);
          return true;
        }
        let next = {
          ...changed,
          notificationId: null as string | null,
          notificationMarker: null as string | null,
        };
        if (native && remainingRestSeconds(changed, Date.now()) > 0) {
          try {
            const permission = await Notifications.getPermissionsAsync();
            if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
            if (permission.granted) {
              const restTimerId = `workout-rest:${Date.now()}-${Math.random().toString(36).slice(2)}`;
              if (Platform.OS === "android") {
                await Notifications.setNotificationChannelAsync(CHANNEL, {
                  name: "Rest timer",
                  importance: Notifications.AndroidImportance.HIGH,
                  sound: "default",
                  vibrationPattern: [0, 250, 250, 250],
                });
                if (scopeRef.current !== scope || loadedScopeRef.current !== scope) return false;
              }
              next.notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                  title: i18n._(REST_TITLE),
                  body: i18n._(REST_BODY),
                  data: { kind: "workout-rest", restTimerId },
                  sound: "default",
                },
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: new Date(changed.deadline),
                  ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}),
                },
              });
              if (scopeRef.current !== scope) {
                await cancel(next.notificationId);
                return false;
              }
              next.notificationMarker = restTimerId;
            }
          } catch {
            /* countdown remains active without an OS alert */
          }
        }
        const record = { ...recordRef.current, timer: next };
        try {
          await writeRecord(scope, record);
          if (scopeRef.current !== scope) {
            await cancel(next.notificationId);
            return false;
          }
          recordRef.current = record;
          setTimer(next);
          setRemaining(remainingRestSeconds(next, Date.now()));
          return true;
        } catch {
          await cancel(next.notificationId);
          setError(safeError());
          return false;
        }
      }),
    [scope, serialize, start, i18n],
  );
  const enableAlerts = useCallback(async (): Promise<"granted" | "denied" | "unsupported"> => {
    if (!native) return "unsupported";
    try {
      const result = await Notifications.requestPermissionsAsync();
      return result.granted ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }, []);
  return {
    ready,
    remainingSeconds,
    active: timer.deadline !== null && remainingSeconds > 0,
    exerciseKey: timer.exerciseKey,
    restSeconds,
    setRestSeconds,
    start,
    adjust,
    skip: finish,
    enableAlerts,
    alertsPrecision: native ? "best-effort" : "unavailable",
    error,
  };
}
