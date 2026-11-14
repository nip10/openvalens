import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { DueSupplement, RecentLogEntry } from "@openvalens/api/contracts/quick-log";
import type { LogKind } from "@openvalens/api/presenters/log-kinds";
import { deviceTimeZone, newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  parseOneLiner,
  type OneLinerEntry,
  type OneLinerSupplement,
} from "@openvalens/api/presenters/one-liner";
import {
  buildQuickLogWrite,
  hasQuickForm,
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
} from "@openvalens/api/presenters/trackers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Button, cn, useToast } from "heroui-native";
import { ArrowLeft, Settings2, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
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
import {
  createHomeWidgetLinkCheck,
  createHomeWidgetWriteLog,
  guardHomeWidgetTap,
  isOwnRecord,
} from "@/lib/home-widget/link-guard";
import { takeHomeWidgetTap } from "@/lib/home-widget/platform";
import {
  discardQueuedSupplementIntake,
  enqueueMetricSample,
  enqueueSupplementIntake,
  useCacheFirst,
  useQueuedSupplementIntakes,
} from "@/lib/offline/sync";
import { usePlainWaterOutbox } from "@/lib/plain-water/sync";
import {
  performPickerWrite,
  type PickerOffline,
  type PickerWrite,
} from "@/lib/quick-log/perform-write";
import {
  buildPickerSections,
  buildTypedSection,
  dueWithQueuedIntakes,
  kindOpening,
  PICKER_COPY,
  type PickerItem,
  typedSubmitItem,
} from "@/lib/quick-log/picker";
import { useLogKinds } from "@/lib/quick-log/use-log-kinds";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

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
  widgetNotOwn: msg({
    message:
      "The widget logs only to your own record, so nothing was logged here. Pick what to log, or switch to your own workspace.",
    comment:
      "After a tap on the home-screen widget while the active workspace belongs to someone else (one the member looks after).",
  }),
  widgetRepeat: msg({
    message: "{what} was logged from the widget a moment ago, so this tap was ignored.",
    comment: "After a second tap on the same home-screen widget button within a few seconds.",
  }),
  widgetConfirm: msg({
    message: "From the home-screen widget. Nothing is saved until you tap Save.",
    comment:
      "Shown when a home-screen widget link opens the app with the entry ready to save, e.g. on iPhone.",
  }),
  repeatHint: msg`Logs the same again, now.`,
};

/** Widget writes in this app process, for ignoring a quick repeat (#505). */
const widgetWrites = createHomeWidgetWriteLog();

type Tracker = Awaited<ReturnType<typeof client.trackers.list>>[number];

type PickerView =
  | { type: "list" }
  /** A widget link that is not known to be the widget's: the entry, saved with one tap (#505). */
  | {
      type: "widget_confirm";
      kind: LogKind;
      what: string;
      entry: { type: "water" } | { type: "take"; item: DueSupplement };
    }
  | { type: "form"; kind: LogKind; preset?: Record<string, string> }
  | { type: "tracker"; kind: LogKind; tracker: Tracker };

/**
 * The mobile log picker (#440), opened from the "+" tab: supplements due now
 * with one-tap "Taken", recent entries to repeat, then every kind the member
 * can log, from the one shared list plus drink presets (#443) and their custom
 * trackers. Simple kinds save here at once with an undo; food, drinks, pain
 * (#442, the body map), labs, workouts and the like open their own screen; a
 * recent drink repeats at once as the same preset. Turned-off features never appear. `?kind=<id>` opens one kind
 * directly (the app-icon quick actions, components/quick-log/quick-actions-sync).
 *
 * The text field on top takes typed one-liners, read by the web palette's
 * parser: "500 ml" or "peso 82,4" previews the entry and saves through the
 * same write path (offline queue and undo included); a bare "82" lists the
 * kinds it could be and saves nothing until one is tapped.
 *
 * `?widget=<action>` is a tap on the home-screen widget (#449): water and
 * "Taken" save at once, with Undo, the same as a tap here; "Log…" just
 * opens the picker. Any app or page can open that link, so it only saves at
 * once after a tap on the Android widget itself (its receiver, which no
 * other app can reach, records the tap), in the member's own workspace, and
 * not twice within a few seconds; else the entry waits for one "Save" tap or
 * nothing is written (`lib/home-widget/link-guard.ts`, #505).
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
  // A typed one-liner (#440): "500 ml", "peso 82,4", "bp 120/80".
  const [typed, setTyped] = useState("");
  const placeholderColor = useThemeColor("ink-3");
  const water = usePlainWaterOutbox();

  // What the member can log: modules, preferences and role.
  const { kinds, trackers, settled: kindsKnown } = useLogKinds({ timeZone });
  // The role here: a widget tap writes only to the member's own record (#505).
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
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

  /** A one-liner that cannot save as typed: its quick form with the values, or its screen. */
  const openTyped = (entry: OneLinerEntry) => {
    if (hasQuickForm(entry.kind)) {
      setFailed(false);
      setView({ type: "form", kind: entry.kind, preset: entry.values });
      return;
    }
    // Pain opens the body map's pain layer at the region named (#442).
    if (entry.kind.id === "pain" && entry.values.region) {
      goTo(`/body-map?layer=pain&region=${encodeURIComponent(entry.values.region)}` as Href);
      return;
    }
    openKind(entry.kind);
  };

  const choose = (item: PickerItem) => {
    if (saving) return;
    const action = item.action;
    switch (action.type) {
      case "typed":
        if (action.preview.write)
          void save(
            action.preview.write,
            `${action.preview.title} · ${action.preview.value}`,
            action.entry.kind,
          );
        else openTyped(action.entry);
        return;
      case "typed_workout": {
        const workout = kinds.find((kind) => kind.id === "workout");
        if (workout) openKind(workout);
        return;
      }
      case "typed_food":
        router.replace({ pathname: "/log-food", params: { food: action.text } });
        return;
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
  const kindsSettled = Boolean(session.data) && kindsKnown;
  // A cached answer may be from before a dose was taken elsewhere: wait for the refetch.
  const nextDue = due.isFetching ? undefined : nextDueSupplement(due.data, queuedIntakes, timeZone);
  // #505: whether this link follows a tap on the Android widget itself, asked once per link.
  const [widgetLink] = useState(() => createHomeWidgetLinkCheck(takeHomeWidgetTap));
  const ownRecord = isOwnRecord(me);
  const waterKind = kinds.find((kind) => kind.id === "water");
  const glassOfWaterLabel = (write: ReturnType<typeof glassOfWaterWrite>) =>
    waterKind ? `${i18n._(waterKind.label)} · ${quickLogWriteValue(write, waterKind, i18n)}` : "";
  const saveGlassOfWater = () => {
    if (!waterKind) return;
    const write = glassOfWaterWrite({ timeZone, newId: newClientMutationId });
    void save(write, glassOfWaterLabel(write), waterKind);
  };
  useEffect(() => {
    if (!widgetAction) {
      widgetHandled.current = false;
      widgetLink.reset();
      return;
    }
    if (widgetHandled.current || saving) return;
    const plan = guardHomeWidgetTap(
      planHomeWidgetTap(widgetAction, {
        availability: kindsSettled ? homeWidgetAvailability(kinds) : null,
        next: has("supplement_intake") ? nextDue : null,
      }),
      {
        ownRecord,
        verified: widgetAction === "log" ? true : widgetLink.verified(widgetAction),
        lastWriteAt: widgetAction === "log" ? undefined : widgetWrites.lastWriteAt(widgetAction),
        now: Date.now(),
      },
    );
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
      case "not_own_record":
        stay();
        toast.show({ label: i18n._(COPY.widgetNotOwn) });
        return;
      case "repeat_ignored":
        stay();
        toast.show({
          label: i18n._({
            ...COPY.widgetRepeat,
            values: { what: i18n._(HOME_WIDGET_COPY[plan.action]) },
          }),
        });
        return;
      case "confirm_water":
        stay();
        if (waterKind)
          setView({
            type: "widget_confirm",
            kind: waterKind,
            what: glassOfWaterLabel(glassOfWaterWrite({ timeZone, newId: () => "" })),
            entry: { type: "water" },
          });
        return;
      case "confirm_take":
        stay();
        if (supplementKind)
          setView({
            type: "widget_confirm",
            kind: supplementKind,
            what: `${plan.item.name} · ${plan.item.dose}`,
            entry: { type: "take", item: plan.item },
          });
        return;
      case "save_water":
        widgetWrites.record("water", Date.now());
        saveGlassOfWater();
        return;
      case "take":
        widgetWrites.record("supplement", Date.now());
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
  }, [widgetAction, kindsSettled, kinds, nextDue, saving, ownRecord]);

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

  const listed = buildPickerSections(
    {
      kinds,
      recents: recents.data?.entries ?? [],
      due: dueWithQueuedIntakes(due.data, queuedIntakes, timeZone),
    },
    i18n,
  );
  // What the member typed, read by the same parser as the web palette.
  const oneLinerSupplements: OneLinerSupplement[] = supplementOptions ?? [];
  const oneLiner = parseOneLiner(typed, {
    kinds,
    trackers: trackers.data ?? [],
    supplements: oneLinerSupplements,
    locale: i18n.locale,
    weightUnit,
    kindCounts: recents.data?.kindCounts,
    // Typed food opens the food search with the text (see buildTypedSection).
    foodDrafts: false,
  });
  const typedSection = buildTypedSection(oneLiner, i18n, {
    timeZone,
    newId: newClientMutationId,
    locale: i18n.locale,
    weightUnit,
    supplements: oneLinerSupplements,
  });
  const sections = typedSection ? [typedSection, ...listed] : listed;
  const submitTyped = () => {
    const item = typedSubmitItem(oneLiner, typedSection);
    if (item) choose(item);
  };
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
        ) : view.type === "widget_confirm" ? (
          <WidgetConfirmView
            what={view.what}
            saving={saving}
            failed={failed}
            onSave={() => {
              if (saving) return;
              const entry = view.entry;
              if (entry.type === "water") saveGlassOfWater();
              else takeSupplement(entry.item);
            }}
          />
        ) : (
          <>
            <TextInput
              testID="quick-log-type"
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={submitTyped}
              returnKeyType="done"
              placeholder={i18n._(PICKER_COPY.typePlaceholder)}
              placeholderTextColor={placeholderColor}
              accessibilityLabel={i18n._(PICKER_COPY.typeLabel)}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
              className="min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink"
            />
            {sections.map((section) => (
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
            ))}
          </>
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

/** A widget link's entry, ready to save with one tap (#505: iOS, or a link no widget tap is behind). */
function WidgetConfirmView({
  what,
  saving,
  failed,
  onSave,
}: {
  what: string;
  saving: boolean;
  failed: boolean;
  onSave: () => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <View className="gap-5">
      <Text className="font-sans text-lg font-semibold text-ink" testID="quick-log-widget-entry">
        {what}
      </Text>
      <Text className="font-sans text-sm text-ink-3">{i18n._(COPY.widgetConfirm)}</Text>
      {failed ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not save. Try again.`}
        </Text>
      ) : null}
      <Button testID="quick-log-save" onPress={onSave} isDisabled={saving}>
        <Button.Label>{saving ? t`Saving…` : t`Save`}</Button.Label>
      </Button>
    </View>
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
