import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { logKindPermissionCheck, type LogKind } from "@openvalens/api/presenters/log-kinds";
import { deviceTimeZone, newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  FIRST_LOG_CARD_COPY,
  FIRST_LOG_WATER_NOTE,
  firstLogKinds,
  turnsOnWater,
  type FirstLogKindId,
} from "@openvalens/api/presenters/onboarding";
import { buildQuickLogWrite, quickFormDefaults } from "@openvalens/api/presenters/quick-log";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "heroui-native";
import { BedDouble, Droplet, Scale, type LucideIcon } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Sheet, ToneIcon, type Tone } from "@/components/bloom";
import { QuickForm } from "@/components/quick-log/quick-form";
import { enqueueMetricSample } from "@/lib/offline/sync";
import { usePlainWaterOutbox } from "@/lib/plain-water/sync";
import { performPickerWrite, type PickerOffline } from "@/lib/quick-log/perform-write";
import { client, orpc } from "@/utils/orpc";

import type { OnboardingProfileFlow, StepNav } from "./flow";
import { StepFrame } from "./flow";

const CARD_ICON: Record<FirstLogKindId, { icon: LucideIcon; tone: Tone }> = {
  weight: { icon: Scale, tone: "weight" },
  water: { icon: Droplet, tone: "water" },
  sleep: { icon: BedDouble, tone: "sleep" },
};

const COPY = {
  saved: msg`Saved: {what}`,
  savedOffline: msg`Saved on this device: {what}. It syncs when you are back online.`,
  waterOn: msg`Water logging is on.`,
  waterFailed: msg`Could not turn on water logging. Try again.`,
};

/**
 * Screen 2 (and the "Log your first entry" item): Weight, Water or Last
 * night's sleep as three large cards, then that kind's quick form, the same
 * `QuickForm` and write path as the "+" log picker (#440). A weight or water
 * that cannot reach the server waits in the device's queues. Choosing Water
 * first turns plain water on.
 */
export function FirstLogStep({
  flow,
  nav,
}: {
  flow: OnboardingProfileFlow & {
    snapshot: NonNullable<OnboardingProfileFlow["snapshot"]>;
  };
  nav: StepNav;
}) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const water = useQuery(orpc.plainWater.getPreferences.queryOptions({ input: {} }));
  const waterOutbox = usePlainWaterOutbox();
  const products = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const weightUnit = products.data?.units === "imperial" ? "lb" : "kg";
  const kinds = firstLogKinds({
    enabledModules: flow.snapshot.enabledModules,
    can: logKindPermissionCheck(me.data?.role),
  });

  const [kind, setKind] = useState<LogKind<FirstLogKindId> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [mutationId, setMutationId] = useState(newClientMutationId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);

  const turnOnWater = useMutation(
    orpc.plainWater.updatePreferences.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() }),
    }),
  );

  const offline: PickerOffline = {
    enqueueMetric: enqueueMetricSample,
    enqueueWater: (input) => waterOutbox.enqueue({ kind: "add", input })?.id ?? null,
    discardWater: (id) => waterOutbox.discard(id),
  };

  const open = async (next: LogKind<FirstLogKindId>) => {
    setError(null);
    if (turnsOnWater(next.id, water.data?.enabled)) {
      try {
        await turnOnWater.mutateAsync({ enabled: true });
        toast.show({ variant: "success", label: i18n._(COPY.waterOn) });
      } catch {
        setError(COPY.waterFailed);
        return;
      }
    }
    setValues(quickFormDefaults(next, new Date(), { weightUnit }));
    setShowErrors(false);
    setFailed(false);
    setMutationId(newClientMutationId());
    setKind(next);
  };

  const parsed = kind
    ? buildQuickLogWrite(kind, values, {
        timeZone,
        locale: i18n.locale,
        // One id per open form, so a retried save cannot log twice.
        newId: () => mutationId,
      })
    : null;

  const submit = async () => {
    if (!kind || !parsed || saving) return;
    if (!parsed.ok) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const result = await performPickerWrite(parsed.write, client, offline);
      for (const key of [
        orpc.quickLog.key(),
        orpc.healthRecord.key(),
        orpc.body.key(),
        orpc.sleep.key(),
        orpc.plainWater.key(),
      ])
        void queryClient.invalidateQueries({ queryKey: key });
      const what = i18n._(kind.label);
      toast.show({
        variant: "success",
        label: i18n._({ ...(result.queued ? COPY.savedOffline : COPY.saved), values: { what } }),
      });
      nav.onDone();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>Log your first entry</Trans>}
      description={
        <Trans>Pick one to try it. It takes a few seconds, and you can change it later.</Trans>
      }
      // Until a card is chosen there is nothing to save: Skip (first run) or Back.
      continueLabel={t`Save`}
      onContinue={kind ? () => void submit() : undefined}
      busy={saving}
      error={error}
      onSkip={kind ? undefined : nav.onSkip}
      onBack={kind ? () => setKind(null) : nav.onBack}
    >
      {kind && parsed ? (
        <Sheet className="gap-5 p-4">
          <View className="flex-row items-center gap-3">
            <ToneIcon icon={CARD_ICON[kind.id].icon} tone={CARD_ICON[kind.id].tone} size="sm" />
            <Text className="font-display text-lg font-semibold text-ink">
              {i18n._(kind.label)}
            </Text>
          </View>
          {/* The picker's form; Save is the screen's own button at the bottom. */}
          <QuickForm
            kind={kind}
            values={values}
            errors={parsed.ok ? [] : parsed.errors}
            showErrors={showErrors}
            supplements={null}
            pending={saving}
            failed={failed}
            onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
            onSubmit={() => void submit()}
            showSave={false}
          />
        </Sheet>
      ) : me.isPending ? (
        <Sheet className="h-36" />
      ) : kinds.length === 0 ? (
        <Sheet>
          <Text className="font-sans text-sm leading-relaxed text-ink-2">
            <Trans>
              Your role in this workspace can't add entries. You can still look around and connect
              your data.
            </Trans>
          </Text>
        </Sheet>
      ) : (
        <View className="gap-3" accessibilityLabel={t`What to log`}>
          {kinds.map((card) => (
            <Pressable
              key={card.id}
              onPress={() => void open(card)}
              disabled={turnOnWater.isPending}
              accessibilityRole="button"
              testID={`first-log-${card.id}`}
              className="active:opacity-80"
            >
              <Sheet className="min-h-24 flex-row items-center gap-4 p-5">
                <ToneIcon icon={CARD_ICON[card.id].icon} tone={CARD_ICON[card.id].tone} />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-display text-lg font-semibold text-ink">
                    {i18n._(FIRST_LOG_CARD_COPY[card.id])}
                  </Text>
                  {turnsOnWater(card.id, water.data?.enabled ?? null) ? (
                    <Text className="font-sans text-sm text-ink-3">
                      {i18n._(FIRST_LOG_WATER_NOTE)}
                    </Text>
                  ) : null}
                </View>
              </Sheet>
            </Pressable>
          ))}
        </View>
      )}
    </StepFrame>
  );
}
