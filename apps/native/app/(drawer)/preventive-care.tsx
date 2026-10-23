import { useLingui } from "@lingui/react/macro";
import {
  DECLARATION_ANSWERS,
  type PreventiveItemUpdate,
  type PreventiveItemView,
} from "@openvalens/api/preventive-care-contract";
import {
  DECLARATION_LABELS,
  formatGuidanceDate,
  PREVENTIVE_COPY,
  type PreventiveItemCard,
} from "@openvalens/api/presenters/preventive-care";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Linking, Pressable, RefreshControl, Switch, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { client, orpc } from "@/utils/orpc";
import {
  libraryModel,
  parseTypedDate,
  preventiveScreenModel,
} from "@/utils/preventive-care-screen";

/**
 * Issue #97 — preventive care on mobile, parity with the web page: the same
 * region-filtered items, authority grades (as text), citations with dates,
 * eligibility questions (never pre-selected), states (done / next date /
 * expect invitation / decided) and the opt-in evidence-check library. View
 * models come from `utils/preventive-care-screen.ts`.
 */

function TextButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="min-h-11 justify-center px-1"
    >
      <Text className="font-medium text-foreground underline">{label}</Text>
    </Pressable>
  );
}

function Choice({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      className={`min-h-11 justify-center rounded-full border px-3 ${selected ? "border-foreground bg-accent" : "border-border"}`}
    >
      <Text className="text-sm text-foreground">
        {selected ? "● " : "○ "}
        {label}
      </Text>
    </Pressable>
  );
}

function DateField({
  label,
  initial,
  onSave,
  disabled,
}: {
  label: string;
  initial: string | null;
  onSave: (value: string | null) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(initial ?? "");
  const { t } = useLingui();
  const parsed = parseTypedDate(text);
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="YYYY-MM-DD"
          accessibilityLabel={label}
          className="min-h-11 flex-1 rounded-lg border border-border bg-card px-3 text-base text-foreground"
          placeholderTextColor="#9ca3af"
        />
        <TextButton
          label={t`Save`}
          disabled={disabled || parsed === undefined}
          onPress={() => onSave(parsed ?? null)}
        />
      </View>
      {parsed === undefined ? (
        <Text className="text-xs text-muted-foreground">{t`Use the format YYYY-MM-DD.`}</Text>
      ) : null}
    </View>
  );
}

function ItemCard({
  card,
  view,
  canEdit,
  pending,
  onUpdate,
}: {
  card: PreventiveItemCard;
  view: PreventiveItemView;
  canEdit: boolean;
  pending: boolean;
  onUpdate: (patch: PreventiveItemUpdate) => void;
}) {
  const { i18n } = useLingui();
  return (
    <Card variant="secondary" className="gap-2 p-4">
      <View accessible accessibilityLabel={card.accessibilityLabel} className="gap-1">
        <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
          {card.title}
        </Text>
        <Text className="text-sm font-medium text-foreground">{card.gradeLabel}</Text>
      </View>
      {card.beingReviewed ? (
        <Text className="text-sm text-foreground">{i18n._(PREVENTIVE_COPY.beingReviewed)}</Text>
      ) : null}
      <Text className="text-sm font-medium text-foreground">{card.applicabilityText}</Text>
      {card.facts.map((fact) => (
        <Text key={fact} className="text-sm text-foreground">
          • {fact}
        </Text>
      ))}
      {card.stateLines.map((line) => (
        <Text key={line} className="text-sm text-foreground">
          {line}
        </Text>
      ))}
      {card.dateReachedText ? (
        <Text className="text-sm font-medium text-foreground">{card.dateReachedText}</Text>
      ) : null}
      {card.decisionAidUrl ? (
        <TextButton
          label={i18n._(PREVENTIVE_COPY.decisionAid)}
          onPress={() => void Linking.openURL(card.decisionAidUrl!)}
        />
      ) : null}
      <Text className="text-sm text-muted-foreground">{card.framing}</Text>
      <Text className="text-xs text-muted-foreground">
        {card.citation} {card.nonEndorsement}
      </Text>
      <View className="flex-row flex-wrap gap-3">
        <TextButton
          label={i18n._(PREVENTIVE_COPY.sourceLink)}
          onPress={() => void Linking.openURL(card.sourceUrl)}
        />
        <TextButton
          label={i18n._(PREVENTIVE_COPY.reportProblem)}
          onPress={() => void Linking.openURL(PREVENTIVE_COPY.reportProblemUrl(card.key))}
        />
      </View>
      {canEdit && !card.beingReviewed ? (
        <View className="gap-3 border-t border-border pt-3">
          <DateField
            label={i18n._(PREVENTIVE_COPY.lastDone)}
            initial={view.state.lastDoneOn}
            disabled={pending}
            onSave={(value) => onUpdate({ itemId: view.id, lastDoneOn: value })}
          />
          {view.canRemind ? (
            <>
              <DateField
                label={i18n._(PREVENTIVE_COPY.nextDate)}
                initial={view.state.nextOn}
                disabled={pending}
                onSave={(value) =>
                  onUpdate({
                    itemId: view.id,
                    nextOn: value,
                    ...(value === null ? { remind: false } : {}),
                  })
                }
              />
              {view.suggestedNextOn && view.suggestedNextOn !== view.state.nextOn ? (
                <TextButton
                  label={i18n._(
                    PREVENTIVE_COPY.useSuggestion(formatGuidanceDate(view.suggestedNextOn)),
                  )}
                  disabled={pending}
                  onPress={() => onUpdate({ itemId: view.id, nextOn: view.suggestedNextOn })}
                />
              ) : null}
              <View className="min-h-11 flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm text-foreground">
                  {i18n._(PREVENTIVE_COPY.remind)}
                </Text>
                <Switch
                  value={view.state.remind}
                  disabled={pending || view.state.nextOn === null}
                  onValueChange={(remind) => onUpdate({ itemId: view.id, remind })}
                  accessibilityLabel={i18n._(PREVENTIVE_COPY.remind)}
                  accessibilityState={{ checked: view.state.remind }}
                />
              </View>
              {view.reminderMode === "expect_invitation" ? (
                <Choice
                  label={i18n._(PREVENTIVE_COPY.plans.expect_invitation)}
                  selected={view.state.plan === "expect_invitation"}
                  disabled={pending}
                  onPress={() =>
                    onUpdate({
                      itemId: view.id,
                      plan: view.state.plan === "expect_invitation" ? "none" : "expect_invitation",
                    })
                  }
                />
              ) : null}
            </>
          ) : null}
          {view.canDecide ? (
            <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
              {(["decided_yes", "decided_no", "decided_later"] as const).map((plan) => (
                <Choice
                  key={plan}
                  label={i18n._(PREVENTIVE_COPY.plans[plan])}
                  selected={view.state.plan === plan}
                  disabled={pending}
                  onPress={() => onUpdate({ itemId: view.id, plan })}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function PreventiveCareScreen() {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const [message, setMessage] = useState<string | null>(null);
  const result = useQuery(orpc.preventiveCare.get.queryOptions({ input: {} }));
  const library = useQuery({
    ...orpc.preventiveCare.library.queryOptions({ input: {} }),
    enabled: result.data?.libraryEnabled === true,
  });
  const onSuccess = () => {
    setMessage(null);
    void queryClient.invalidateQueries({ queryKey: orpc.preventiveCare.key() });
  };
  const onError = () => setMessage(t`Could not save. Nothing was changed.`);
  const declare = useMutation({
    mutationFn: (input: Parameters<typeof client.preventiveCare.declare>[0]) =>
      client.preventiveCare.declare(input),
    onSuccess,
    onError,
  });
  const update = useMutation({
    mutationFn: (patch: PreventiveItemUpdate) => client.preventiveCare.updateItem(patch),
    onSuccess,
    onError,
  });
  const settings = useMutation({
    mutationFn: (libraryEnabled: boolean) =>
      client.preventiveCare.settings.update({ libraryEnabled }),
    onSuccess,
    onError,
  });
  const pending = declare.isPending || update.isPending || settings.isPending;

  if (result.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );
  if (result.isError || !result.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">{t`Could not load preventive care.`}</Text>
        <TextButton label={t`Retry`} onPress={() => void result.refetch()} />
      </Container>
    );

  const model = preventiveScreenModel(i18n, result.data);
  const lib = libraryModel(i18n, model.libraryEnabled ? library.data : undefined);

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={result.isRefetching}
            onRefresh={() => void result.refetch()}
          />
        ),
      }}
    >
      <View className="gap-4 p-4">
        <View className="gap-1">
          <Text className="font-mono text-3xl text-foreground">{model.title}</Text>
          <Text className="text-sm text-muted-foreground">{model.intro}</Text>
        </View>
        {message ? <Text className="text-sm text-foreground">{message}</Text> : null}
        {model.statusText ? (
          <View className="gap-2">
            <Text className="text-base text-foreground">{model.statusText}</Text>
            {model.showProfileLink ? (
              <Link href="/profile" asChild>
                <Pressable accessibilityRole="link" className="min-h-11 justify-center">
                  <Text className="font-medium text-foreground underline">
                    {i18n._(PREVENTIVE_COPY.profileLink)}
                  </Text>
                </Pressable>
              </Link>
            ) : null}
          </View>
        ) : null}
        {model.notes.map((note) => (
          <Text key={note} className="text-sm text-foreground">
            {note}
          </Text>
        ))}
        {model.criteria.length > 0 ? (
          <CardStack>
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
                {i18n._(PREVENTIVE_COPY.criteriaTitle)}
              </Text>
              <Text className="text-sm text-muted-foreground">
                {i18n._(PREVENTIVE_COPY.criteriaIntro)}
              </Text>
              {model.criteria.map((criterion) => (
                <View key={criterion.id} className="gap-1 border-t border-border pt-2">
                  <Text className="text-sm font-medium text-foreground">{criterion.question}</Text>
                  <Text className="text-xs text-muted-foreground">{criterion.purpose}</Text>
                  <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                    {DECLARATION_ANSWERS.map((answer) => (
                      <Choice
                        key={answer}
                        label={i18n._(DECLARATION_LABELS[answer])}
                        selected={criterion.answer === answer}
                        disabled={pending || !model.canEdit}
                        onPress={() => declare.mutate({ criterion: criterion.id, answer })}
                      />
                    ))}
                  </View>
                  {criterion.answer !== null && model.canEdit ? (
                    <TextButton
                      label={i18n._(PREVENTIVE_COPY.clearAnswer)}
                      disabled={pending}
                      onPress={() => declare.mutate({ criterion: criterion.id, answer: null })}
                    />
                  ) : null}
                </View>
              ))}
            </Card>
          </CardStack>
        ) : null}
        {model.items.map(({ card, view }) => (
          <ItemCard
            key={card.key}
            card={card}
            view={view}
            canEdit={model.canEdit}
            pending={pending}
            onUpdate={(patch) => update.mutate(patch)}
          />
        ))}
        {model.notShown.length > 0 ? (
          <View className="gap-1">
            <Text className="text-base font-medium text-foreground">
              {i18n._(PREVENTIVE_COPY.notShownTitle)} ({model.notShown.length})
            </Text>
            <Text className="text-sm text-muted-foreground">
              {i18n._(PREVENTIVE_COPY.notShownIntro)}
            </Text>
            {model.notShown.map((title, index) => (
              <Text key={`${title}-${index}`} className="text-sm text-foreground">
                • {title}
              </Text>
            ))}
          </View>
        ) : null}
        {model.statusText === null ? (
          <>
            <Text className="text-xs text-muted-foreground">{model.disclaimer}</Text>
            {model.canEdit ? (
              <View className="gap-1">
                <View className="min-h-11 flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm text-foreground">
                    {i18n._(PREVENTIVE_COPY.libraryToggle)}
                  </Text>
                  <Switch
                    value={model.libraryEnabled}
                    disabled={pending}
                    onValueChange={(enabled) => settings.mutate(enabled)}
                    accessibilityLabel={i18n._(PREVENTIVE_COPY.libraryToggle)}
                    accessibilityState={{ checked: model.libraryEnabled }}
                  />
                </View>
                <Text className="text-xs text-muted-foreground">
                  {i18n._(PREVENTIVE_COPY.libraryToggleHint)}
                </Text>
              </View>
            ) : null}
            <Text className="text-sm text-muted-foreground">{lib.text}</Text>
            {lib.cards.map((entry) => (
              <Card key={entry.key} variant="secondary" className="gap-2 p-4">
                <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
                  {entry.title}
                </Text>
                <Text className="text-sm font-medium text-foreground">
                  {entry.verdictLabel} · {entry.certaintyLabel}
                </Text>
                {entry.lines.map((line) => (
                  <Text key={line} className="text-sm text-foreground">
                    {line}
                  </Text>
                ))}
                {entry.sources.map((source) => (
                  <TextButton
                    key={source.url + source.citation}
                    label={`${source.citation}${source.note ? ` — ${source.note}` : ""}`}
                    onPress={() => void Linking.openURL(source.url)}
                  />
                ))}
              </Card>
            ))}
          </>
        ) : null}
        <Text className="text-xs text-muted-foreground">{model.versionText}</Text>
      </View>
    </Container>
  );
}
