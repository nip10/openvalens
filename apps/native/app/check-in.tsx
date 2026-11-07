import { presentProposal } from "@openvalens/api/presenters/energy-estimate";
import {
  CHECK_IN_MACRO_COPY,
  PRESET_COPY,
  checkInMacros,
} from "@openvalens/api/presenters/macro-presets";
import {
  MACRO_LETTERS,
  NUTRIENT_LABELS,
  ROW_MACRO_KEYS,
  deviceTimeZone,
  localDateIn,
  shiftLocalDate,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  CHECK_IN_COPY,
  HIDDEN_VALUE,
  checkInBasis,
  checkInHeader,
  checkInState,
  formatTarget,
  goalLine,
  loggedDaysLine,
  loggedDaysOfLastWeek,
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useRouter } from "expo-router";
import { Button, Spinner } from "heroui-native";
import { Info, Square, SquareCheck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DISPLAY_MAX_FONT_SCALE, Icon, Sheet } from "@/components/bloom";
import { MACRO_TEXT } from "@/components/nutrition-macro-line";
import { authClient } from "@/lib/auth-client";
import { useModuleEnabled } from "@/lib/modules/use-modules";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

/**
 * The weekly check-in (#397). Collaborative only (D2 in #390): it shows a
 * proposal worked out on the server from the experimental estimate and the
 * member's goal, and the member accepts it or keeps their targets. The
 * server re-checks every accept against the nutrition safety policy. Last
 * week's intake against the target never enters the proposal.
 */
export default function CheckInRoute() {
  const { t, i18n } = useLingui();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = authClient.useSession();
  const foodEnabled = useModuleEnabled("food");
  const queryClient = useQueryClient();
  const today = localDateIn(deviceTimeZone());
  const overview = useQuery(
    orpc.nutritionTargets.get.queryOptions({ input: { localDate: today } }),
  );
  const settings = overview.data?.settings;
  const hideNumbers = resolveHideNumbers(settings?.hideNumbers);
  const safetyOff = overview.data?.safety.energySuggestions === "off";
  const state = settings
    ? checkInState({
        checkInDay: settings.checkInDay,
        today,
        lastCheckInOn: settings.lastCheckInOn,
      })
    : null;
  const open = state?.state === "due" || state?.state === "early";
  const estimate = useQuery({
    ...orpc.nutritionEnergy.estimate.queryOptions({ input: { to: today } }),
    enabled: open && !hideNumbers && !safetyOff,
    retry: false,
  });
  const proposals = useQuery({
    ...orpc.nutritionEnergy.listProposals.queryOptions({ input: {} }),
    enabled: open,
    retry: false,
  });
  const propose = useMutation(orpc.nutritionEnergy.propose.mutationOptions());
  const accept = useMutation(orpc.nutritionEnergy.acceptProposal.mutationOptions());
  const dismiss = useMutation(orpc.nutritionEnergy.dismissProposal.mutationOptions());
  const record = useMutation(orpc.nutritionTargets.updateSettings.mutationOptions());
  const setTarget = useMutation(orpc.nutritionTargets.setTarget.mutationOptions());
  const trend = useQuery({
    ...orpc.body.weightTrend.queryOptions({
      input: { from: shiftLocalDate(today, -27), to: today },
    }),
    enabled: open && !hideNumbers && !safetyOff && Boolean(settings?.macroPreset),
    retry: false,
  });
  const [declined, setDeclined] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const asked = useRef(false);
  const pending = proposals.data?.proposals.find((p) => p.status === "pending" && !p.expired);

  // Work out this week's proposal once, when the check-in is open and none is waiting.
  useEffect(() => {
    if (!open || hideNumbers || safetyOff || asked.current) return;
    if (!proposals.isSuccess || pending) return;
    asked.current = true;
    propose.mutate(
      { to: today },
      {
        onSuccess: (result) => {
          if (result.outcome === "declined") setDeclined(result.note);
          void queryClient.invalidateQueries({ queryKey: orpc.nutritionEnergy.key() });
        },
        onError: () => setDeclined(i18n._(CHECK_IN_COPY.paused)),
      },
    );
  }, [
    open,
    hideNumbers,
    safetyOff,
    proposals.isSuccess,
    pending,
    propose,
    today,
    queryClient,
    i18n,
  ]);

  if (session.isPending) return null;
  if (!session.data?.user) return <Redirect href="/" />;
  if (!foodEnabled) return <Redirect href="/(drawer)/(tabs)" />;

  const finish = (text: string) => {
    if (!settings) return;
    record.mutate(
      { expectedRevision: settings.revision, lastCheckInOn: today },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() });
          void queryClient.invalidateQueries({ queryKey: orpc.nutritionEnergy.key() });
        },
        onSuccess: () => {
          AccessibilityInfo.announceForAccessibility(text);
          router.back();
        },
        onError: () => setMessage(t`Could not save the check-in. Try again.`),
      },
    );
  };

  const onAccept = () => {
    if (!pending) return;
    accept.mutate(
      {
        proposalId: pending.id,
        effectiveFrom: today,
        ...(pending.needsConfirmation && confirmed ? { confirmed: true } : {}),
      },
      {
        onSuccess: (result) => {
          if (result.outcome === "declined") {
            setMessage(result.note);
            AccessibilityInfo.announceForAccessibility(result.note);
            return;
          }
          if (!macros?.ok) {
            finish(i18n._(CHECK_IN_COPY.accepted));
            return;
          }
          // The same accept also saves the proposed P/C/F, each "entered by you".
          void (async () => {
            try {
              await setTarget.mutateAsync({
                nutrient: "proteinG",
                minAmount: macros.proteinG,
                maxAmount: null,
                effectiveFrom: today,
              });
              await setTarget.mutateAsync({
                nutrient: "carbohydrateG",
                minAmount: macros.carbohydrateG,
                maxAmount: macros.carbohydrateG,
                effectiveFrom: today,
              });
              await setTarget.mutateAsync({
                nutrient: "fatG",
                minAmount: macros.fatG,
                maxAmount: macros.fatG,
                effectiveFrom: today,
              });
              finish(i18n._(CHECK_IN_COPY.acceptedWithMacros));
            } catch {
              setMessage(i18n._(CHECK_IN_COPY.macrosNotSaved));
            }
          })();
        },
        onError: () => setMessage(t`Could not confirm the result. Refresh to check its status.`),
      },
    );
  };

  const onKeep = () => {
    if (pending)
      dismiss.mutate(
        { proposalId: pending.id },
        {
          onSuccess: () => finish(i18n._(CHECK_IN_COPY.kept)),
          onError: () => setMessage(t`Could not confirm the result. Refresh to check its status.`),
        },
      );
    else finish(i18n._(CHECK_IN_COPY.kept));
  };

  const shown = pending && !hideNumbers ? presentProposal(pending, false, i18n) : null;
  const energyTarget = overview.data?.targets.find((target) => target.nutrient === "energyKcal");
  const nowText = energyTarget ? formatTarget(energyTarget, hideNumbers, i18n) : "—";
  const proposedText = hideNumbers ? i18n._(HIDDEN_VALUE) : (shown?.suggestion ?? "—");
  const estimateKcal = pending?.estimateKcal ?? null;
  const intakeDays =
    pending?.estimate?.inputs.intake.days ??
    (estimate.data && "inputs" in estimate.data ? estimate.data.inputs.intake.days : []);
  const logged = loggedDaysOfLastWeek(intakeDays);
  const busy = accept.isPending || dismiss.isPending || record.isPending || setTarget.isPending;
  const weightKg =
    [...(trend.data?.points ?? [])].reverse().find((point) => point.trendKg !== null)?.trendKg ??
    null;
  const macros =
    settings && pending
      ? checkInMacros({
          preset: settings.macroPreset,
          proteinGPerKg: settings.proteinGPerKg,
          reference: overview.data?.proteinReference ?? null,
          energyKcal: pending.targetKcal,
          weightKg,
        })
      : null;
  const nowFor = (key: (typeof ROW_MACRO_KEYS)[number]) => {
    const target = overview.data?.targets.find((item) => item.nutrient === key);
    return target ? formatTarget(target, hideNumbers, i18n) : "—";
  };
  const proposedFor = (key: (typeof ROW_MACRO_KEYS)[number]) => {
    if (hideNumbers) return i18n._(HIDDEN_VALUE);
    if (!macros?.ok) return "—";
    return key === "proteinG" ? t`at least ${macros.proteinG} g` : `${macros[key]} g`;
  };
  const dateText = state && state.state !== "off" ? friendlyDate(i18n, state.checkInDate) : "";

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <Stack.Screen options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <View className="min-h-12 flex-row items-center justify-end px-4">
        <Button className="min-h-11" variant="ghost" onPress={() => router.back()}>
          <Button.Label>{t`Close`}</Button.Label>
        </Button>
      </View>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-6">
        {!settings || overview.isPending ? (
          <Spinner />
        ) : safetyOff || state?.state === "off" ? (
          <Text className="font-sans text-base text-ink-2">{i18n._(CHECK_IN_COPY.off)}</Text>
        ) : !open ? (
          <Text className="font-sans text-base text-ink-2">{i18n._(CHECK_IN_COPY.notDue)}</Text>
        ) : (
          <>
            <Text className="font-sans text-sm font-semibold text-ink-3">
              {checkInHeader(dateText, i18n)}
            </Text>
            <Text
              className="font-display text-[28px] font-semibold leading-tight text-ink"
              accessibilityRole="header"
              maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
            >
              {i18n._(CHECK_IN_COPY.title)}
            </Text>
            {hideNumbers ? (
              <Text className="font-sans text-base text-ink-2">{i18n._(CHECK_IN_COPY.hidden)}</Text>
            ) : (
              <Text className="font-sans text-base text-ink-2">
                {estimateKcal !== null
                  ? `${checkInBasis(
                      estimateKcal,
                      goalLine(settings.energyDirection, settings.energyRatePercent, i18n),
                      i18n,
                    )} ${i18n._(CHECK_IN_COPY.adherence)}`
                  : i18n._(CHECK_IN_COPY.adherence)}
              </Text>
            )}
            {propose.isPending || proposals.isPending ? <Spinner /> : null}
            {pending ? (
              <Sheet className="gap-0 px-4 py-1" testID="check-in-proposal">
                <View className="flex-row gap-2 py-2">
                  <Text className="flex-[1.2] font-sans text-xs font-semibold text-ink-3">
                    {i18n._(CHECK_IN_COPY.target)}
                  </Text>
                  <Text className="flex-1 font-sans text-xs font-semibold text-ink-3">
                    {i18n._(CHECK_IN_COPY.now)}
                  </Text>
                  <Text className="flex-1 font-sans text-xs font-semibold text-ink-3">
                    {i18n._(CHECK_IN_COPY.proposed)}
                  </Text>
                </View>
                <View
                  className="min-h-12 flex-row items-center gap-2 border-t border-rule"
                  accessible
                  accessibilityLabel={t`Energy: now ${nowText}, proposed ${proposedText}`}
                >
                  <Text className="flex-[1.2] font-sans text-base text-ink">{t`Energy`}</Text>
                  <Text
                    className="flex-1 font-sans text-sm text-ink-3"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {nowText}
                  </Text>
                  <Text
                    className="flex-1 font-sans text-base font-semibold text-ink"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {proposedText}
                  </Text>
                </View>
                {macros?.ok
                  ? ROW_MACRO_KEYS.map((key) => {
                      const label = i18n._(NUTRIENT_LABELS[key].label);
                      const now = nowFor(key);
                      const proposed = proposedFor(key);
                      return (
                        <View
                          key={key}
                          testID={`check-in-${key}`}
                          className="min-h-12 flex-row items-center gap-2 border-t border-rule"
                          accessible
                          accessibilityLabel={t`${label}: now ${now}, proposed ${proposed}`}
                        >
                          <Text className={`flex-[1.2] font-sans text-base ${MACRO_TEXT[key]}`}>
                            {i18n._(MACRO_LETTERS[key])} · {label}
                          </Text>
                          <Text
                            className="flex-1 font-sans text-sm text-ink-3"
                            style={{ fontVariant: ["tabular-nums"] }}
                          >
                            {now}
                          </Text>
                          <Text
                            className="flex-1 font-sans text-base font-semibold text-ink"
                            style={{ fontVariant: ["tabular-nums"] }}
                          >
                            {proposed}
                          </Text>
                        </View>
                      );
                    })
                  : null}
              </Sheet>
            ) : declined ? (
              <Text className="font-sans text-base text-ink-2" accessibilityLiveRegion="polite">
                {declined} {i18n._(CHECK_IN_COPY.paused)}
              </Text>
            ) : null}
            {pending && !hideNumbers ? (
              <Text className="font-sans text-sm text-ink-3">
                {macros === null
                  ? i18n._(CHECK_IN_MACRO_COPY.energyOnly)
                  : macros.ok
                    ? i18n._(CHECK_IN_MACRO_COPY.fromPreset)
                    : i18n._(
                        macros.reason === "does_not_fit"
                          ? PRESET_COPY.doesNotFit
                          : macros.reason === "needs_energy"
                            ? PRESET_COPY.needsEnergy
                            : PRESET_COPY.needsWeight,
                      )}
              </Text>
            ) : null}
            <View className="flex-row items-start gap-2 rounded-2xl bg-paper-2 p-3">
              <Icon icon={Info} size={16} color="ink-2" />
              <Text className="flex-1 font-sans text-sm text-ink-2">
                {logged.of > 0 && !hideNumbers
                  ? `${loggedDaysLine(logged.logged, logged.of, i18n)} `
                  : ""}
                {i18n._(CHECK_IN_COPY.pauseRule)} {i18n._(CHECK_IN_COPY.experimental)}
              </Text>
            </View>
            {pending?.needsConfirmation ? (
              <Pressable
                onPress={() => setConfirmed((value) => !value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmed }}
                className="min-h-11 flex-row items-center gap-2"
              >
                <Icon icon={confirmed ? SquareCheck : Square} size={20} color="ink-2" />
                <Text className="flex-1 font-sans text-sm text-ink-2">
                  {t({
                    message: "I have read this and want to accept the suggestion.",
                    comment: "safety",
                  })}
                </Text>
              </Pressable>
            ) : null}
            {message ? (
              <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
                {message}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
      {settings && open && !safetyOff ? (
        <View className="gap-1.5 border-t border-rule px-4 pt-3">
          {pending && !hideNumbers ? (
            <Button
              className="min-h-12"
              testID="check-in-accept"
              isDisabled={busy || (pending.needsConfirmation && !confirmed)}
              onPress={onAccept}
            >
              <Button.Label>{i18n._(CHECK_IN_COPY.accept)}</Button.Label>
            </Button>
          ) : null}
          <Button
            className="min-h-11"
            variant="ghost"
            testID="check-in-keep"
            isDisabled={busy}
            onPress={onKeep}
          >
            <Button.Label>{i18n._(CHECK_IN_COPY.keep)}</Button.Label>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
