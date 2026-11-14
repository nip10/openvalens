import {
  asksForHeight,
  ENERGY_ESTIMATE_COPY,
  HEIGHT_PROMPT_COPY,
  parseHeightAnswer,
  presentEnergyEstimate,
  presentProposal,
} from "@openvalens/api/presenters/energy-estimate";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, TextInput, View } from "react-native";
import { Button, cn } from "heroui-native";
import { Gauge, Sparkles, Square, SquareCheck } from "lucide-react-native";

import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { Icon, Section } from "@/components/bloom";
import { DecimalHint } from "@/components/decimal-hint";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export function EnergyEstimateCard({
  scope,
  hideNumbers,
  preferenceKnown,
  safetyOff,
  height,
}: {
  scope: string | null;
  hideNumbers: boolean;
  preferenceKnown: boolean;
  safetyOff: boolean;
  /** The saved height and the settings revision, so a suggestion can ask for height in place (#444). */
  height?: { cm: number | null; revision: number };
}) {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const [askHeight, setAskHeight] = useState(false);
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
  const suggestion = proposalDisplay?.suggestion ?? t`Unavailable`;
  const currentTarget = proposalDisplay?.current ?? i18n._(ENERGY_ESTIMATE_COPY.noTarget);
  useEffect(() => {
    setConfirmed(false);
    setStatus("");
    setAskHeight(false);
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
  /** `savedHeightCm`: a height just saved, before the settings refetch lands. */
  const askForSuggestion = (savedHeightCm?: number) =>
    ask.mutate(
      { to: today() },
      {
        onSuccess: (result) => {
          if (scope !== activeScope.current) return;
          // A missing height is asked for right here instead of in onboarding (#444).
          const wantsHeight = asksForHeight(result, savedHeightCm ?? height?.cm);
          setAskHeight(wantsHeight);
          if (wantsHeight) {
            setStatus("");
            refresh();
          } else if (result.outcome === "declined") finish(result.note);
          else {
            setStatus(t`Suggestion is ready for your review.`);
            refresh();
          }
        },
        onError: () =>
          finish(t`Could not confirm whether a suggestion was created. Refresh to check.`),
      },
    );
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
        // The figure, range and method live on the Food tab's trend card (#395).
        <Text className="font-sans text-sm text-ink-2">
          {t`The estimate and how it is worked out are on the Food tab.`}
        </Text>
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
          onPress={() => askForSuggestion()}
        >
          <Icon icon={Sparkles} size={16} color="ink-2" />
          <Button.Label>{i18n._(ENERGY_ESTIMATE_COPY.ask)}</Button.Label>
        </Button>
      )}
      {authorized && !pending && askHeight && height?.cm === null ? (
        <HeightPrompt
          revision={height.revision}
          onSaved={(cm) => {
            setAskHeight(false);
            refresh();
            askForSuggestion(cm);
          }}
          onConflict={refresh}
        />
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
          {status}
        </Text>
      ) : null}
    </Section>
  );
}

/**
 * Asks for the member's height in place when a reduction suggestion needs it
 * (#444), saves it to the nutrition settings, then the card asks again.
 */
function HeightPrompt({
  revision,
  onSaved,
  onConflict,
}: {
  revision: number;
  onSaved: (heightCm: number) => void;
  onConflict: () => void;
}) {
  const { i18n } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation(orpc.nutritionTargets.updateSettings.mutationOptions());
  const submit = () => {
    const parsed = parseHeightAnswer(text, i18n.locale);
    if (!parsed.ok) {
      setError(i18n._(parsed.error));
      return;
    }
    setError(null);
    save.mutate(
      { expectedRevision: revision, heightCm: parsed.value },
      {
        onSuccess: (result) => {
          if (result.outcome === "updated") {
            onSaved(parsed.value);
            return;
          }
          setError(i18n._(HEIGHT_PROMPT_COPY.conflict));
          onConflict();
        },
        onError: () => setError(i18n._(HEIGHT_PROMPT_COPY.failed)),
      },
    );
  };
  const label = i18n._(HEIGHT_PROMPT_COPY.label);
  return (
    <View className="gap-2 rounded-2xl bg-food-soft px-4 py-3">
      <Text className="font-display text-base font-medium text-ink" accessibilityRole="header">
        {i18n._(HEIGHT_PROMPT_COPY.title)}
      </Text>
      <Text className="font-sans text-sm text-ink-2">{i18n._(HEIGHT_PROMPT_COPY.body)}</Text>
      <Text className="font-sans text-sm font-medium text-ink-2">{label}</Text>
      <TextInput
        testID="energy-height-input"
        accessibilityLabel={label}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        returnKeyType="done"
        onSubmitEditing={submit}
        placeholder="100–250"
        placeholderTextColor={placeholderColor}
        className={cn(
          "min-h-11 max-w-48 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink",
          error && "border-destructive",
        )}
        style={{ fontVariant: ["tabular-nums"] }}
      />
      <DecimalHint value={text} />
      {error ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {error}
        </Text>
      ) : null}
      <Button
        testID="energy-height-save"
        variant="outline"
        size="sm"
        className="self-start"
        onPress={submit}
        isDisabled={save.isPending}
      >
        <Button.Label>{i18n._(HEIGHT_PROMPT_COPY.save)}</Button.Label>
      </Button>
    </View>
  );
}
