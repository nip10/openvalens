import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { DueSupplement, RecentLogEntry } from "@openvalens/api/contracts/quick-log";
import {
  availableLogKinds,
  drinkLogKinds,
  LOG_KINDS,
  logKindPermissionCheck,
  type LogKind,
} from "@openvalens/api/presenters/log-kinds";
import { deviceTimeZone, newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  buildQuickLogWrite,
  quickFormDefaults,
  quickLogWriteValue,
  recentEntryTitle,
  recentEntryValue,
  repeatRecentEntry,
} from "@openvalens/api/presenters/quick-log";
import {
  formatTrackerValue,
  parseTrackerInput,
  trackerIdFromLogKind,
  trackerLogKinds,
} from "@openvalens/api/presenters/trackers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Button, cn, useToast } from "heroui-native";
import { ArrowLeft, Settings2, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DISPLAY_MAX_FONT_SCALE, Icon, ToneIcon } from "@/components/bloom";
import { LOG_KIND_ICONS, LOG_KIND_TONES } from "@/components/quick-log/log-kind-icons";
import { QuickForm, type SupplementOption } from "@/components/quick-log/quick-form";
import { TrackerValueInput } from "@/components/trackers/tracker-value-input";
import { authClient } from "@/lib/auth-client";
import { HOME_WIDGET_COPY } from "@/lib/home-widget/copy";
import {
  glassOfWaterWrite,
  homeWidgetAvailability,
  nextDueSupplement,
  parseHomeWidgetAction,
  planHomeWidgetTap,
} from "@/lib/home-widget/model";
import { useModules } from "@/lib/modules/use-modules";
import {
  discardQueuedSupplementIntake,
  enqueueMetricSample,
  enqueueSupplementIntake,
  useCacheFirst,
  useQueuedSupplementIntakes,
} from "@/lib/offline/sync";
import { usePlainWaterOutbox } from "@/lib/plain-water/sync";
import { WATER_PREFERENCES_CACHE_KEY } from "@/lib/plain-water/view";
import {
  performPickerWrite,
  type PickerOffline,
  type PickerWrite,
} from "@/lib/quick-log/perform-write";
import {
  buildPickerSections,
  dueWithQueuedIntakes,
  kindOpening,
  type PickerItem,
} from "@/lib/quick-log/picker";
import { client, orpc } from "@/utils/orpc";

/** How long the undo toast stays (#440: about 6 s). */
export const UNDO_TOAST_MS = 6_000;

const COPY = {
  title: msg`Log`,
  close: msg`Close`,
  back: msg`Back`,
  saved: msg`Saved: {what}`,
  savedOffline: msg`Saved on this device: {what}. It syncs when you are back online.`,
  undo: msg`Undo`,
  edit: msg`Open`,
  undone: msg`Removed: {what}`,
  undoFailed: msg`Could not remove it. Open the screen to change it.`,
  failed: msg`Could not save. Try again.`,
  takeHint: msg`Logs the scheduled dose now. Long-press to change it.`,
  widgetOff: msg({
    message: "{what} is turned off, so nothing was logged.",
    comment: "After a tap on the home-screen widget for a kind the member has turned off.",
  }),
  repeatHint: msg`Logs the same again, now.`,
};

type Tracker = Awaited<ReturnType<typeof client.trackers.list>>[number];

type PickerView =
  | { type: "list" }
  | { type: "form"; kind: LogKind; preset?: Record<string, string> }
  | { type: "tracker"; kind: LogKind; tracker: Tracker };

/**
 * The mobile log picker (#440), opened from the "+" tab: supplements due now
 * with one-tap "Taken", recent entries to repeat, then every kind the member
 * can log, from the one shared list plus drink presets (#443) and their custom
 * trackers. Simple kinds save here at once with an undo; food, drinks, pain
 * (#442, the body map), labs, workouts and the like open their own screen; a
 * recent drink repeats at once as the same preset. Turned-off features never appear. `?kind=<id>` opens one kind
 * directly (for app-icon quick actions). `?widget=<action>` is a tap on the
 * home-screen widget (#449): water and "Taken" save at once, with Undo, the
 * same as a tap here; "Log…" just opens the picker.
 */
export default function QuickLogRoute() {
  const { t, i18n } = useLingui();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; widget?: string }>();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const [view, setView] = useState<PickerView>({ type: "list" });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const water = usePlainWaterOutbox();

  // What the member can log: modules, preferences and role.
  const { enabled, isEnabled, profile } = useModules();
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const waterPreferences = useCacheFirst(
    WATER_PREFERENCES_CACHE_KEY,
    orpc.plainWater.getPreferences.queryOptions({ input: {} }),
  );
  const privateBody = useQuery({
    ...orpc.privateBody.preference.queryOptions({ input: {} }),
    enabled: isEnabled("body"),
  });
  // Pain (#442): the member's own opt-in. Fails closed: unknown or an error reads as off.
  const pain = useQuery({
    ...orpc.pain.preference.queryOptions({ input: {} }),
    enabled: isEnabled("body"),
  });
  const trackers = useQuery(
    orpc.trackers.list.queryOptions({ input: { timeZone, includeArchived: false } }),
  );
  // Drink presets (#443), only the ones the server can log (FDC imported).
  const drinkPresets = useQuery({
    ...orpc.nutritionDrinks.presets.queryOptions({ input: {} }),
    enabled: isEnabled("food"),
  });
  const kinds = useMemo(
    () =>
      availableLogKinds<LogKind>(
        {
          enabledModules: [...enabled],
          preferences: {
            plain_water: waterPreferences.data?.enabled === true,
            private_body: privateBody.data?.enabled === true,
            pain: pain.data?.enabled === true,
          },
          can: logKindPermissionCheck(me.data?.role),
        },
        [
          ...LOG_KINDS,
          ...drinkLogKinds(drinkPresets.data?.presets),
          ...trackerLogKinds(trackers.data ?? []),
        ],
      ),
    [
      enabled,
      waterPreferences.data?.enabled,
      privateBody.data?.enabled,
      pain.data?.enabled,
      me.data?.role,
      drinkPresets.data?.presets,
      trackers.data,
    ],
  );
  const has = (id: string) => kinds.some((kind) => kind.id === id);
  const canRecords = kinds.some((kind) => kind.permission.resource === "records");

  const recents = useQuery({
    ...orpc.quickLog.recents.queryOptions({ input: {} }),
    enabled: canRecords,
  });
  // Cached on the device, so "Taken" still works offline (#440); the intake then waits in the outbox.
  const due = useCacheFirst(`quick-log:supplements-due:${timeZone}`, {
    ...orpc.quickLog.supplementsDue.queryOptions({ input: { timeZone } }),
    enabled: has("supplement_intake"),
  });
  const supplements = useCacheFirst("quick-log:supplements", {
    ...orpc.plans.listSupplements.queryOptions({ input: {} }),
    enabled: has("supplement_intake"),
  });
  const queuedIntakes = useQueuedSupplementIntakes();
  const supplementOptions: SupplementOption[] | null = supplements.data
    ? supplements.data.map((item) => ({ id: item.id, name: item.name, dose: item.dose }))
    : null;

  const products = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const weightUnit = products.data?.units === "imperial" ? "lb" : "kg";

  const offline: PickerOffline = {
    enqueueMetric: enqueueMetricSample,
    enqueueWater: (input) => water.enqueue({ kind: "add", input })?.id ?? null,
    discardWater: (id) => water.discard(id),
    enqueueSupplement: enqueueSupplementIntake,
    discardSupplement: discardQueuedSupplementIntake,
  };

  const refresh = () => {
    for (const key of [
      orpc.healthRecord.key(),
      orpc.vitals.key(),
      orpc.activity.key(),
      orpc.body.key(),
      orpc.sleep.key(),
      orpc.plainWater.key(),
      orpc.supplementIntake.key(),
      orpc.goals.key(),
      orpc.trackers.key(),
      orpc.quickLog.key(),
      orpc.nutritionDiary.key(),
      orpc.nutritionDrinks.key(),
      orpc.pain.key(),
    ])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(drawer)/(tabs)"));

  /** Leaves the picker for a screen in the app: back to the tabs first, then there. */
  const goTo = (href: Href) => {
    close();
    setTimeout(() => router.push(href), 0);
  };

  /** Toast after a save; the action undoes it, or opens the screen to change it. */
  const announce = (
    what: string,
    kind: LogKind | undefined,
    result: { undo?: () => Promise<void>; queued: boolean },
  ) => {
    const undo = result.undo;
    toast.show({
      variant: "success",
      label: result.queued
        ? i18n._({ ...COPY.savedOffline, values: { what } })
        : i18n._({ ...COPY.saved, values: { what } }),
      duration: UNDO_TOAST_MS,
      ...(undo
        ? {
            actionLabel: i18n._(COPY.undo),
            onActionPress: ({ hide }) => {
              hide();
              undo().then(
                () => {
                  toast.show({ label: i18n._({ ...COPY.undone, values: { what } }) });
                  refresh();
                },
                () => toast.show({ variant: "danger", label: i18n._(COPY.undoFailed) }),
              );
            },
          }
        : kind
          ? {
              actionLabel: i18n._(COPY.edit),
              onActionPress: ({ hide }) => {
                hide();
                router.push(kind.paths.native as Href);
              },
            }
          : {}),
    });
  };

  const save = async (write: PickerWrite, what: string, kind: LogKind | undefined) => {
    setSaving(true);
    setFailed(false);
    try {
      const result = await performPickerWrite(write, client, offline);
      refresh();
      close();
      announce(what, kind, result);
    } catch {
      setFailed(true);
      toast.show({ variant: "danger", label: i18n._(COPY.failed) });
    } finally {
      setSaving(false);
    }
  };

  const openKind = (kind: LogKind, preset?: Record<string, string>) => {
    setFailed(false);
    switch (kindOpening(kind)) {
      case "quick_form":
        setView({ type: "form", kind, preset });
        return;
      case "tracker": {
        const tracker = trackers.data?.find((item) => item.id === trackerIdFromLogKind(kind.id));
        if (tracker) setView({ type: "tracker", kind, tracker });
        else goTo(kind.paths.native as Href);
        return;
      }
      case "food":
        // The add-food flow carries the food recents, favourites, copy and templates.
        router.replace("/log-food");
        return;
      case "screen":
        goTo(kind.paths.native as Href);
    }
  };

  const repeat = (entry: RecentLogEntry, kind: LogKind) => {
    const write = repeatRecentEntry(entry, { timeZone, newId: newClientMutationId });
    void save(write, `${recentEntryTitle(entry, i18n)} · ${recentEntryValue(entry, i18n)}`, kind);
  };

  const supplementKind = kinds.find((kind) => kind.id === "supplement_intake");
  const takeSupplement = (item: DueSupplement) => {
    if (!supplementKind) return;
    if (!item.dose) {
      openKind(supplementKind, { supplement: String(item.supplementId) });
      return;
    }
    void save(
      {
        type: "supplement",
        input: {
          supplementId: item.supplementId,
          occurredAt: new Date().toISOString(),
          timeZone,
          dose: item.dose,
          clientMutationId: newClientMutationId(),
        },
      },
      `${item.name} · ${item.dose}`,
      supplementKind,
    );
  };

  const choose = (item: PickerItem) => {
    if (saving) return;
    const action = item.action;
    switch (action.type) {
      case "take":
        takeSupplement(action.item);
        return;
      case "repeat":
        repeat(action.entry, action.kind);
        return;
      case "kind":
        openKind(action.kind);
        return;
      case "more":
        goTo("/settings/modules");
    }
  };

  // `?widget=<action>`: a tap on the home-screen widget, acted on once what the
  // member can log is known (a kind turned off since the widget was drawn is not saved).
  const widgetAction = parseHomeWidgetAction(params.widget);
  const widgetHandled = useRef(false);
  const waiting = (query: { isPending: boolean; isFetching: boolean }) =>
    query.isPending && query.isFetching;
  const kindsSettled =
    Boolean(session.data) && !waiting(profile) && !waiting(me) && !waiting(waterPreferences);
  // A cached answer may be from before a dose was taken elsewhere: wait for the refetch.
  const nextDue = due.isFetching ? undefined : nextDueSupplement(due.data, queuedIntakes, timeZone);
  useEffect(() => {
    if (!widgetAction) {
      widgetHandled.current = false;
      return;
    }
    if (widgetHandled.current || saving) return;
    const plan = planHomeWidgetTap(widgetAction, {
      availability: kindsSettled ? homeWidgetAvailability(kinds) : null,
      next: has("supplement_intake") ? nextDue : null,
    });
    if (plan.type === "wait") return;
    widgetHandled.current = true;
    // The picker stays open: clear the action so the same tap again acts again.
    const stay = () => router.setParams({ widget: undefined });
    switch (plan.type) {
      case "picker":
        stay();
        return;
      case "off":
        stay();
        toast.show({
          label: i18n._({
            ...COPY.widgetOff,
            values: { what: i18n._(HOME_WIDGET_COPY[plan.action]) },
          }),
        });
        return;
      case "save_water": {
        const waterKind = kinds.find((kind) => kind.id === "water");
        if (!waterKind) return;
        const write = glassOfWaterWrite({ timeZone, newId: newClientMutationId });
        void save(
          write,
          `${i18n._(waterKind.label)} · ${quickLogWriteValue(write, waterKind, i18n)}`,
          waterKind,
        );
        return;
      }
      case "take":
        takeSupplement(plan.item);
        return;
      case "choose_supplement":
        stay();
        if (supplementKind)
          openKind(
            supplementKind,
            plan.supplementId === null ? undefined : { supplement: String(plan.supplementId) },
          );
    }
    // The handlers read the latest data; run once per tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetAction, kindsSettled, kinds, nextDue, saving]);

  // `?kind=<id>`: open that kind once it is known to be available.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !params.kind) return;
    const kind = kinds.find((item) => item.id === params.kind);
    if (!kind) return;
    if (kindOpening(kind) === "tracker" && !trackers.data) return;
    opened.current = true;
    openKind(kind);
    // openKind reads the latest data; run once per available kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.kind, kinds, trackers.data]);

  if (!session.isPending && !session.data) return <Redirect href="/" />;

  const sections = buildPickerSections(
    {
      kinds,
      recents: recents.data?.entries ?? [],
      due: dueWithQueuedIntakes(due.data, queuedIntakes, timeZone),
    },
    i18n,
  );
  const heading = view.type === "list" ? i18n._(COPY.title) : i18n._(view.kind.label);

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingTop: Platform.OS === "ios" ? 8 : insets.top,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View className="min-h-14 flex-row items-center gap-2 px-3">
        {view.type !== "list" ? (
          <Pressable
            testID="quick-log-back"
            onPress={() => {
              setFailed(false);
              setView({ type: "list" });
            }}
            accessibilityRole="button"
            accessibilityLabel={i18n._(COPY.back)}
            hitSlop={8}
            className="min-h-11 min-w-11 items-center justify-center rounded-full active:opacity-70"
          >
            <Icon icon={ArrowLeft} size={22} color="ink-2" />
          </Pressable>
        ) : null}
        {view.type !== "list" ? (
          <ToneIcon
            icon={LOG_KIND_ICONS[view.kind.icon]}
            tone={LOG_KIND_TONES[view.kind.icon]}
            size="sm"
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 font-display text-2xl font-semibold text-ink",
            view.type === "list" && "px-2",
          )}
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
        >
          {heading}
        </Text>
        <Pressable
          testID="quick-log-close"
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={i18n._(COPY.close)}
          hitSlop={8}
          className="min-h-11 min-w-11 items-center justify-center rounded-full active:opacity-70"
        >
          <Icon icon={X} size={22} color="ink-2" />
        </Pressable>
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-6 px-4 pb-8 pt-2"
      >
        {view.type === "form" ? (
          <QuickFormView
            key={view.kind.id}
            kind={view.kind}
            preset={view.preset}
            weightUnit={weightUnit}
            supplements={supplementOptions}
            saving={saving}
            failed={failed}
            timeZone={timeZone}
            onSave={(write, what) => void save(write, what, view.kind)}
          />
        ) : view.type === "tracker" ? (
          <TrackerFormView
            key={view.kind.id}
            tracker={view.tracker}
            saving={saving}
            failed={failed}
            timeZone={timeZone}
            onSave={(write, what) => void save(write, what, view.kind)}
          />
        ) : (
          sections.map((section) => (
            <View key={section.id} className="gap-1">
              <Text
                className="px-1 pb-1 font-sans text-[13px] font-semibold text-ink-3"
                accessibilityRole="header"
              >
                {section.heading}
              </Text>
              {section.items.map((item) => (
                <PickerRow
                  key={item.id}
                  item={item}
                  disabled={saving}
                  accessibilityHint={
                    item.action.type === "take"
                      ? i18n._(COPY.takeHint)
                      : item.action.type === "repeat"
                        ? i18n._(COPY.repeatHint)
                        : undefined
                  }
                  onPress={() => choose(item)}
                  onLongPress={
                    item.action.type === "take" && supplementKind
                      ? () => {
                          const due = item.action as { item: DueSupplement };
                          openKind(supplementKind, { supplement: String(due.item.supplementId) });
                        }
                      : undefined
                  }
                />
              ))}
            </View>
          ))
        )}
        {view.type === "list" && saving ? (
          <Text className="px-1 font-sans text-sm text-ink-3">{t`Saving…`}</Text>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function PickerRow({
  item,
  disabled,
  accessibilityHint,
  onPress,
  onLongPress,
}: {
  item: PickerItem;
  disabled: boolean;
  accessibilityHint?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const label = item.detail ? `${item.label} · ${item.detail}` : item.label;
  return (
    <Pressable
      testID={`quick-log-${item.id}`}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={item.hint ? `${label}, ${item.hint}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      className={cn(
        "min-h-14 flex-row items-center gap-3 rounded-2xl px-2 py-2 active:bg-paper-2",
        disabled && "opacity-55",
      )}
    >
      {item.icon ? (
        <ToneIcon icon={LOG_KIND_ICONS[item.icon]} tone={LOG_KIND_TONES[item.icon]} size="md" />
      ) : (
        <View className="h-10 w-10 items-center justify-center rounded-full bg-paper-2">
          <Icon icon={Settings2} size={20} color="ink-3" />
        </View>
      )}
      <Text className="min-w-0 flex-1 font-sans text-base text-ink" numberOfLines={2}>
        {item.label}
        {item.detail ? (
          <Text className="text-ink-3" style={{ fontVariant: ["tabular-nums"] }}>
            {` · ${item.detail}`}
          </Text>
        ) : null}
      </Text>
      {item.hint ? (
        <Text className="font-sans text-sm font-semibold text-signal">{item.hint}</Text>
      ) : null}
    </Pressable>
  );
}

function QuickFormView({
  kind,
  preset,
  weightUnit,
  supplements,
  saving,
  failed,
  timeZone,
  onSave,
}: {
  kind: LogKind;
  preset?: Record<string, string>;
  weightUnit: "kg" | "lb";
  supplements: readonly SupplementOption[] | null;
  saving: boolean;
  failed: boolean;
  timeZone: string;
  onSave: (write: PickerWrite, what: string) => void;
}) {
  const { i18n } = useLingui();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...quickFormDefaults(kind, new Date(), { weightUnit }),
    ...preset,
  }));
  const [showErrors, setShowErrors] = useState(false);
  // One id per open form, so a retried save cannot log twice.
  const [mutationId] = useState(newClientMutationId);
  const parsed = buildQuickLogWrite(kind, values, {
    timeZone,
    locale: i18n.locale,
    newId: () => mutationId,
    supplementDose: (id) => supplements?.find((item) => item.id === id)?.dose ?? null,
  });

  return (
    <QuickForm
      kind={kind}
      values={values}
      errors={parsed.ok ? [] : parsed.errors}
      showErrors={showErrors}
      supplements={kind.id === "supplement_intake" ? supplements : null}
      pending={saving}
      failed={failed}
      onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
      onSubmit={() => {
        if (!parsed.ok) {
          setShowErrors(true);
          return;
        }
        onSave(parsed.write, i18n._(kind.label));
      }}
    />
  );
}

function TrackerFormView({
  tracker,
  saving,
  failed,
  timeZone,
  onSave,
}: {
  tracker: Tracker;
  saving: boolean;
  failed: boolean;
  timeZone: string;
  onSave: (write: PickerWrite, what: string) => void;
}) {
  const { t, i18n } = useLingui();
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const value = parseTrackerInput(tracker, text, i18n.locale);
  const submit = () => {
    setTouched(true);
    if (value === null) return;
    onSave(
      { type: "tracker", input: { trackerId: tracker.id, value, timeZone } },
      `${tracker.name} · ${formatTrackerValue(i18n, tracker, value)}`,
    );
  };
  return (
    <View className="gap-5">
      <TrackerValueInput
        label={t`Value for ${tracker.name}`}
        type={tracker.type}
        unit={tracker.unit}
        template={tracker.template}
        text={text}
        onText={setText}
        testID={`quick-log-tracker-${tracker.id}`}
      />
      {touched && value === null ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {tracker.type === "duration"
            ? t`Enter a duration such as 20 min, 1:30 or 45 s.`
            : tracker.type === "number"
              ? t`Enter a number.`
              : t`Choose a value.`}
        </Text>
      ) : null}
      {failed ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not save. Try again.`}
        </Text>
      ) : null}
      <Button testID="quick-log-save" onPress={submit} isDisabled={saving}>
        <Button.Label>{saving ? t`Saving…` : t`Save`}</Button.Label>
      </Button>
    </View>
  );
}
