import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { comparisonScreenModel, type ComparisonBlock } from "@/utils/comparison-screen";
import { orpc } from "@/utils/orpc";

/**
 * Issue #96 — reference comparisons on mobile. Same view model as the web
 * card (`utils/comparison-screen.ts` → `@openvalens/api/presenters/
 * reference-comparison`): own trend first, each comparison off until turned
 * on, the band or guideline range in words, the named source and its limits.
 * Every state is in text; blocks carry screen-reader labels and the toggles
 * expose their on/off state.
 */

function BlockView({
  block,
  pending,
  onToggle,
}: {
  block: ComparisonBlock;
  pending: boolean;
  onToggle: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  return (
    <View className="gap-2 border-t border-border pt-3">
      <View accessible accessibilityLabel={block.accessibilityLabel} className="gap-1">
        <Text className="text-base font-medium text-foreground" accessibilityRole="header">
          {block.title}
        </Text>
        {block.trendLines.map((line) => (
          <Text key={line} className="text-xs text-muted-foreground">
            {line}
          </Text>
        ))}
        {block.statusText ? (
          <Text className="text-sm text-foreground">{block.statusText}</Text>
        ) : null}
        {block.comparisonLines.map((line) => (
          <Text key={line} className="text-sm text-foreground">
            {line}
          </Text>
        ))}
      </View>
      {block.notes.map((note) => (
        <Text key={note} className="text-xs text-muted-foreground">
          • {note}
        </Text>
      ))}
      <Pressable
        onPress={() => setShowSource((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showSource }}
        className="min-h-11 justify-center"
      >
        <Text className="text-sm text-foreground underline">{block.sourceLabel}</Text>
      </Pressable>
      {showSource ? (
        <View className="gap-1">
          <Pressable onPress={() => void Linking.openURL(block.sourceUrl)} accessibilityRole="link">
            <Text className="text-xs text-foreground underline">{block.sourceCitation}</Text>
          </Pressable>
          {block.sourceDetails.map((line) => (
            <Text key={line} className="text-xs text-muted-foreground">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {block.disclosure ? (
        <Text className="text-xs text-muted-foreground">{block.disclosure}</Text>
      ) : null}
      <Pressable
        onPress={onToggle}
        disabled={pending}
        accessibilityRole="switch"
        accessibilityState={{ checked: block.optedIn, disabled: pending }}
        accessibilityLabel={`${block.title}: ${block.toggleLabel}`}
        className="min-h-11 justify-center self-start rounded-full border border-border px-4"
      >
        <Text className="text-sm font-medium text-foreground">{block.toggleLabel}</Text>
      </Pressable>
    </View>
  );
}

export function ReferenceComparisonsSection() {
  const queryClient = useQueryClient();
  const comparisons = useQuery(orpc.comparison.get.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.comparison.updateSettings.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.comparison.key() }),
    }),
  );

  if (comparisons.isPending) return <Spinner />;
  if (comparisons.isError || !comparisons.data)
    return (
      <Pressable
        onPress={() => void comparisons.refetch()}
        className="min-h-11 justify-center"
        accessibilityRole="button"
      >
        <Text className="text-sm text-foreground">
          Could not load reference comparisons. <Text className="underline">Retry</Text>
        </Text>
      </Pressable>
    );

  const model = comparisonScreenModel(comparisons.data);
  return (
    <CardStack>
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
          {model.title}
        </Text>
        <Text className="text-sm text-muted-foreground">{model.intro}</Text>
        <Text className="text-xs text-muted-foreground">{model.noOtherPeople}</Text>
        {model.withheldText ? (
          <Text className="text-sm text-foreground">{model.withheldText}</Text>
        ) : null}
        {update.isError ? (
          <Text className="text-sm text-foreground">Could not update the comparison setting.</Text>
        ) : null}
        {model.blocks.map((block) => (
          <BlockView
            key={block.key}
            block={block}
            pending={update.isPending}
            onToggle={() => update.mutate({ metric: block.key, enabled: !block.optedIn })}
          />
        ))}
        <View className="gap-1 border-t border-border pt-3">
          <Text className="text-base font-medium text-foreground" accessibilityRole="header">
            {model.notComparedTitle}
          </Text>
          {model.notCompared.map((line) => (
            <Text key={line} className="text-xs text-muted-foreground">
              • {line}
            </Text>
          ))}
        </View>
        <Text className="text-sm text-muted-foreground">{model.limits}</Text>
        <Text className="text-xs text-muted-foreground">{model.versionText}</Text>
      </Card>
    </CardStack>
  );
}
