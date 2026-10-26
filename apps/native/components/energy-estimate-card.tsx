import {
  ENERGY_ESTIMATE_COPY,
  presentEnergyEstimate,
  presentProposal,
} from "@openvalens/api/presenters/energy-estimate";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { Button } from "heroui-native";
import { Gauge, Sparkles, Square, SquareCheck } from "lucide-react-native";

import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { Icon, InfoTip, Prose, Section } from "@/components/bloom";
import { orpc } from "@/utils/orpc";

export function EnergyEstimateCard({
  scope,
  hideNumbers,
  preferenceKnown,
  safetyOff,
}: {
  scope: string | null;
  hideNumbers: boolean;
  preferenceKnown: boolean;
  safetyOff: boolean;
}) {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const visible = Boolean(scope && preferenceKnown && !hideNumbers && !safetyOff);
  const date = localDateIn(deviceTimeZone());
  const estimateOptions = orpc.nutritionEnergy.estimate.queryOptions({ input: { to: date } });
  const estimate = useQuery({
    ...estimateOptions,
    queryKey: [...estimateOptions.queryKey, { offlineScope: scope }],
    enabled: visible,
    retry: false,
  });
  const proposalOptions = orpc.nutritionEnergy.listProposals.queryOptions({ input: {} });
  const proposals = useQuery({
    ...proposalOptions,
    queryKey: [...proposalOptions.queryKey, { offlineScope: scope }],
    enabled: Boolean(scope),
    retry: false,
  });
  const ask = useMutation(orpc.nutritionEnergy.propose.mutationOptions());
  const accept = useMutation(orpc.nutritionEnergy.acceptProposal.mutationOptions());
  const dismiss = useMutation(orpc.nutritionEnergy.dismissProposal.mutationOptions());
  const authorized =
    visible &&
    estimate.isSuccess &&
    estimate.data.status === "estimated" &&
    estimate.data.estimate !== null;
  const pending = proposals.data?.proposals.find((p) => p.status === "pending");
  const display = authorized ? presentEnergyEstimate(estimate.data, false, i18n) : null;
  const proposalDisplay = pending ? presentProposal(pending, false, i18n) : null;
  const range = display?.range ?? "";
  const suggestion = proposalDisplay?.suggestion ?? t`Unavailable`;
  const currentTarget = proposalDisplay?.current ?? i18n._(ENERGY_ESTIMATE_COPY.noTarget);
  useEffect(() => {
    setConfirmed(false);
    setStatus("");
  }, [scope, hideNumbers]);
  const refresh = () => {
    if (scope !== activeScope.current) return;
    void queryClient.invalidateQueries({ queryKey: orpc.nutritionEnergy.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() });
  };
  const finish = (message: string) => {
    if (scope !== activeScope.current) return;
    setStatus(message);
    AccessibilityInfo.announceForAccessibility(message);
    refresh();
  };
  const today = () => localDateIn(deviceTimeZone());
  const description = estimate.data?.status === "no_estimate" ? estimate.data.reasonNotes : [];

  return (
    <Section
      icon={Gauge}
      tone="food"
      sheet
      title={i18n._(ENERGY_ESTIMATE_COPY.title)}
      description={i18n._(ENERGY_ESTIMATE_COPY.subtitle)}
    >
      <Text className="font-sans text-sm text-ink-3">
        {i18n._(ENERGY_ESTIMATE_COPY.provisional)}
      </Text>
      {hideNumbers || !preferenceKnown ? (
        <Text className="font-sans text-sm text-ink-2">{i18n._(ENERGY_ESTIMATE_COPY.hidden)}</Text>
      ) : safetyOff ? (
        <Text className="font-sans text-sm text-ink-2">
          {i18n._(ENERGY_ESTIMATE_COPY.unavailable)}
        </Text>
      ) : estimate.isError ? (
        <View className="items-start gap-2 rounded-2xl bg-destructive/5 px-4 py-3">
          <Text className="font-sans text-sm text-ink-2" accessibilityRole="alert">
            {i18n._(ENERGY_ESTIMATE_COPY.error)}
          </Text>
          <Button size="sm" variant="outline" onPress={() => void estimate.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </View>
      ) : estimate.isPending ? (
        <Text className="font-sans text-sm text-ink-3">
          <Trans>Loading estimate…</Trans>
        </Text>
      ) : display ? (
        <View className="gap-1">
          <Text
            className="font-display text-[34px] font-medium leading-[40px] text-ink"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {display.value}
          </Text>
          <View className="flex-row flex-wrap items-center gap-1">
            <Text className="shrink font-sans text-sm text-ink-3">
              {t`${range} (arithmetic range, not a confidence interval)`}
            </Text>
            <InfoTip label={t`How this is estimated`}>
              <Prose>{display.window}</Prose>
              {display.notes.map((note, i) => (
                <Prose key={i}>{note}</Prose>
              ))}
            </InfoTip>
          </View>
        </View>
      ) : (
        <View className="gap-1">
          <Text className="font-sans text-sm text-ink-2">
            {i18n._(ENERGY_ESTIMATE_COPY.unavailable)}
          </Text>
          {description.map((note, i) => (
            <Text key={i} className="font-sans text-sm text-ink-3">
              {note}
            </Text>
          ))}
        </View>
      )}
      {pending ? (
        <View className="gap-2 rounded-2xl bg-food-soft px-4 py-3">
          <View className="flex-row items-center gap-2">
            <Icon icon={Sparkles} size={16} color="food" />
            <Text className="shrink font-display text-base font-medium text-ink">
              {i18n._(ENERGY_ESTIMATE_COPY.pending)}
            </Text>
          </View>
          {authorized && proposalDisplay && (
            <>
              <Text className="font-sans text-sm text-ink">{t`Suggested: ${suggestion}`}</Text>
              <Text className="font-sans text-sm text-ink-2">
                {t`Current target: ${currentTarget}`}
              </Text>
            </>
          )}
          {pending.expired && (
            <Text className="font-sans text-sm text-ink-2">
              <Trans>This suggestion has expired.</Trans>
            </Text>
          )}
          {authorized && pending.needsConfirmation && (
            <Pressable
              onPress={() => setConfirmed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              className="min-h-11 flex-row items-center gap-2"
            >
              <Icon icon={confirmed ? SquareCheck : Square} size={20} color="ink-2" />
              <Text className="flex-1 font-sans text-sm text-ink-2">
                <Trans comment="safety">I have read this and want to accept the suggestion.</Trans>
              </Text>
            </Pressable>
          )}
          <View className="flex-row flex-wrap gap-2">
            {authorized ? (
              <Button
                isDisabled={
                  !authorized ||
                  pending.expired ||
                  accept.isPending ||
                  (pending.needsConfirmation && !confirmed)
                }
                onPress={() =>
                  accept.mutate(
                    {
                      proposalId: pending.id,
                      effectiveFrom: today(),
                      ...(pending.needsConfirmation && confirmed ? { confirmed: true } : {}),
                    },
                    {
                      onSuccess: (result) =>
                        finish(
                          result.outcome === "declined"
                            ? result.note
                            : t`Suggestion accepted. Targets refreshed.`,
                        ),
                      onError: () =>
                        finish(t`Could not confirm the result. Refresh to check its status.`),
                    },
                  )
                }
              >
                {i18n._(ENERGY_ESTIMATE_COPY.accept)}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              isDisabled={dismiss.isPending}
              onPress={() =>
                dismiss.mutate(
                  { proposalId: pending.id },
                  {
                    onSuccess: (result) =>
                      finish(
                        result.outcome === "declined"
                          ? result.note
                          : t`Suggestion dismissed. Targets refreshed.`,
                      ),
                    onError: () =>
                      finish(t`Could not confirm the result. Refresh to check its status.`),
                  },
                )
              }
            >
              {i18n._(ENERGY_ESTIMATE_COPY.dismiss)}
            </Button>
          </View>
        </View>
      ) : null}
      {authorized && !pending && (
        <Button
          variant="outline"
          className="self-start"
          isDisabled={!display || ask.isPending}
          onPress={() =>
            ask.mutate(
              { to: today() },
              {
                onSuccess: (result) => {
                  if (scope !== activeScope.current) return;
                  if (result.outcome === "declined") finish(result.note);
                  else {
                    setStatus(t`Suggestion is ready for your review.`);
                    refresh();
                  }
                },
                onError: () =>
                  finish(t`Could not confirm whether a suggestion was created. Refresh to check.`),
              },
            )
          }
        >
          <Icon icon={Sparkles} size={16} color="ink-2" />
          <Button.Label>{i18n._(ENERGY_ESTIMATE_COPY.ask)}</Button.Label>
        </Button>
      )}
      {status ? (
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
          {status}
        </Text>
      ) : null}
    </Section>
  );
}
