import {
  ENERGY_ESTIMATE_COPY,
  presentEnergyEstimate,
  presentProposal,
} from "@openvalens/api/presenters/energy-estimate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { Button, Card } from "heroui-native";

import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
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
  const display = authorized ? presentEnergyEstimate(estimate.data, false) : null;
  const proposalDisplay = pending ? presentProposal(pending, false) : null;
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
    <Card variant="secondary" className="gap-3 p-4">
      <Text className="font-medium text-foreground" accessibilityRole="header">
        {ENERGY_ESTIMATE_COPY.title}
      </Text>
      <Text className="text-sm font-medium text-foreground">{ENERGY_ESTIMATE_COPY.subtitle}</Text>
      <Text className="text-sm text-muted-foreground">{ENERGY_ESTIMATE_COPY.provisional}</Text>
      {hideNumbers || !preferenceKnown ? (
        <Text className="text-sm text-muted-foreground">{ENERGY_ESTIMATE_COPY.hidden}</Text>
      ) : safetyOff ? (
        <Text className="text-sm text-muted-foreground">{ENERGY_ESTIMATE_COPY.unavailable}</Text>
      ) : estimate.isError ? (
        <View className="gap-2">
          <Text className="text-sm text-muted-foreground" accessibilityRole="alert">
            {ENERGY_ESTIMATE_COPY.error}
          </Text>
          <Button variant="secondary" onPress={() => void estimate.refetch()}>
            Retry
          </Button>
        </View>
      ) : estimate.isPending ? (
        <Text className="text-sm text-muted-foreground">Loading estimate…</Text>
      ) : display ? (
        <View className="gap-1 rounded-lg border border-border p-3">
          <Text className="text-xl font-semibold text-foreground">{display.value}</Text>
          <Text className="text-sm text-foreground">
            {display.range} (arithmetic range, not a confidence interval)
          </Text>
          <Text className="text-xs text-muted-foreground">{display.window}</Text>
          {display.notes.map((note, i) => (
            <Text key={i} className="text-xs text-muted-foreground">
              {note}
            </Text>
          ))}
        </View>
      ) : (
        <View className="gap-1">
          <Text className="text-sm text-muted-foreground">{ENERGY_ESTIMATE_COPY.unavailable}</Text>
          {description.map((note, i) => (
            <Text key={i} className="text-xs text-muted-foreground">
              {note}
            </Text>
          ))}
        </View>
      )}
      {pending ? (
        <View className="gap-2 rounded-lg border border-border p-3">
          <Text className="font-medium text-foreground">{ENERGY_ESTIMATE_COPY.pending}</Text>
          {authorized && proposalDisplay && (
            <>
              <Text className="text-sm text-foreground">
                Suggested: {proposalDisplay.suggestion ?? "Unavailable"}
              </Text>
              <Text className="text-sm text-foreground">
                Current target: {proposalDisplay.current ?? ENERGY_ESTIMATE_COPY.noTarget}
              </Text>
            </>
          )}
          {pending.expired && (
            <Text className="text-sm text-muted-foreground">This suggestion has expired.</Text>
          )}
          {authorized && pending.needsConfirmation && (
            <Pressable
              onPress={() => setConfirmed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              className="min-h-11 flex-row items-center gap-2"
            >
              <Text className="text-foreground">{confirmed ? "☑" : "☐"}</Text>
              <Text className="flex-1 text-sm text-foreground">
                I have read this and want to accept the suggestion.
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
                            : "Suggestion accepted. Targets refreshed.",
                        ),
                      onError: () =>
                        finish("Could not confirm the result. Refresh to check its status."),
                    },
                  )
                }
              >
                {ENERGY_ESTIMATE_COPY.accept}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              isDisabled={dismiss.isPending}
              onPress={() =>
                dismiss.mutate(
                  { proposalId: pending.id },
                  {
                    onSuccess: (result) =>
                      finish(
                        result.outcome === "declined"
                          ? result.note
                          : "Suggestion dismissed. Targets refreshed.",
                      ),
                    onError: () =>
                      finish("Could not confirm the result. Refresh to check its status."),
                  },
                )
              }
            >
              {ENERGY_ESTIMATE_COPY.dismiss}
            </Button>
          </View>
        </View>
      ) : null}
      {authorized && !pending && (
        <Button
          variant="secondary"
          isDisabled={!display || ask.isPending}
          onPress={() =>
            ask.mutate(
              { to: today() },
              {
                onSuccess: (result) => {
                  if (scope !== activeScope.current) return;
                  if (result.outcome === "declined") finish(result.note);
                  else {
                    setStatus("Suggestion is ready for your review.");
                    refresh();
                  }
                },
                onError: () =>
                  finish("Could not confirm whether a suggestion was created. Refresh to check."),
              },
            )
          }
        >
          {ENERGY_ESTIMATE_COPY.ask}
        </Button>
      )}
      {status ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
          {status}
        </Text>
      ) : null}
    </Card>
  );
}
