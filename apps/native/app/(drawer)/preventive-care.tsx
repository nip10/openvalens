import { useLingui } from "@lingui/react/macro";
import {
  DECLARATION_ANSWERS,
  type PreventiveItemUpdate,
  type PreventiveItemView,
} from "@openvalens/api/preventive-care-contract";
import {
  DECLARATION_LABELS,
  formatGuidanceDate,
  LIBRARY_COPY,
  PREVENTIVE_COPY,
  type PreventiveItemCard,
} from "@openvalens/api/presenters/preventive-care";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button } from "heroui-native";
import {
  BookOpen,
  CalendarClock,
  Circle,
  CircleDot,
  ExternalLink,
  MessageCircleQuestion,
  ShieldCheck,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, RefreshControl, Switch, Text, TextInput, View } from "react-native";

import {
  Details,
  ErrorState,
  Icon,
  InfoTip,
  ListCard,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
  StatTile,
  StatusPill,
  TileRow,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import {
  libraryModel,
  parseTypedDate,
  preventiveScreenModel,
} from "@/utils/preventive-care-screen";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #97 — preventive care on mobile, parity with the web page: the same
 * region-filtered items, authority grades (as text), citations with dates,
 * eligibility questions (never pre-selected), states (done / next date /
 * expect invitation / decided) and the opt-in evidence-check library. View
 * models come from `utils/preventive-care-screen.ts`.
 *
 * Bloom: two tiles lead (items for you, dates reached), then each item as a
 * card with its grade and state; facts, framing and citations sit behind an
 * ⓘ, and the record controls behind "Update your record".
 */

const INPUT_CLASS =
  "min-h-11 flex-1 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

function TextButton({
  label,
  onPress,
  disabled,
  external,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  external?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`min-h-11 flex-row items-center gap-1.5 self-start px-1 active:opacity-70 ${
        disabled ? "opacity-55" : ""
      }`}
    >
      <Text className="shrink font-sans text-sm font-medium text-ink underline">{label}</Text>
      {external ? <Icon icon={ExternalLink} size={14} /> : null}
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
      className={`min-h-11 flex-row items-center gap-1.5 rounded-full border px-3.5 active:opacity-70 ${
        selected ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-paper-2"
      } ${disabled ? "opacity-55" : ""}`}
    >
      <Icon icon={selected ? CircleDot : Circle} size={16} color={selected ? "signal" : "ink-3"} />
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function SwitchRow({
  label,
  value,
  disabled,
  onValueChange,
  info,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  info?: string;
}) {
  const signal = useThemeColor("signal");
  const track = useThemeColor("paper-3");
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1 flex-row items-center gap-1">
        <Text className="shrink font-sans text-sm text-ink-2">{label}</Text>
        {info ? <InfoTip title={label}>{info}</InfoTip> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: signal, false: track }}
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
      />
    </View>
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
  const placeholderColor = useThemeColor("ink-3");
  const parsed = parseTypedDate(text);
  return (
    <View className="gap-1.5">
      <Text className="font-sans text-sm text-ink-3">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="YYYY-MM-DD"
          accessibilityLabel={label}
          className={INPUT_CLASS}
          placeholderTextColor={placeholderColor}
        />
        <Button
          variant="outline"
          size="sm"
          isDisabled={disabled || parsed === undefined}
          onPress={() => onSave(parsed ?? null)}
        >
          <Button.Label>{t`Save`}</Button.Label>
        </Button>
      </View>
      {parsed === undefined ? (
        <Text className="font-sans text-xs text-ink-3">{t`Use the format YYYY-MM-DD.`}</Text>
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
  const { t, i18n } = useLingui();
  const lastDone = view.state.lastDoneOn;
  const nextOn = view.state.nextOn;
  const nextDay = nextOn ? friendlyDate(i18n, nextOn) : "";
  const doneDay = lastDone ? friendlyDate(i18n, lastDone) : "";
  const status = card.dateReachedText
    ? { tone: "warn" as const, label: card.dateReachedText }
    : nextOn
      ? { tone: "neutral" as const, label: t`Next: ${nextDay}` }
      : lastDone
        ? { tone: "good" as const, label: t`Done: ${doneDay}` }
        : null;

  return (
    <ListCard
      icon={ShieldCheck}
      tone="water"
      title={card.title}
      trailing={
        <InfoTip title={card.title}>
          {card.facts.map((fact) => (
            <Prose key={fact}>• {fact}</Prose>
          ))}
          <Text className="font-sans text-sm text-ink-3">{card.framing}</Text>
          <Text className="font-sans text-sm text-ink-3">
            {card.citation} {card.nonEndorsement}
          </Text>
          <TextButton
            label={i18n._(PREVENTIVE_COPY.sourceLink)}
            external
            onPress={() => void Linking.openURL(card.sourceUrl)}
          />
          <TextButton
            label={i18n._(PREVENTIVE_COPY.reportProblem)}
            external
            onPress={() => void Linking.openURL(PREVENTIVE_COPY.reportProblemUrl(card.key))}
          />
        </InfoTip>
      }
    >
      <View
        accessible
        accessibilityLabel={card.accessibilityLabel}
        className="flex-row flex-wrap items-center gap-2"
      >
        <View className="rounded-full bg-water-soft px-2.5 py-1">
          <Text className="font-sans text-[13px] font-semibold text-ink">{card.gradeLabel}</Text>
        </View>
        {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
      </View>
      <View className="gap-1">
        {card.beingReviewed ? (
          <Text className="font-sans text-sm text-ink-2">
            {i18n._(PREVENTIVE_COPY.beingReviewed)}
          </Text>
        ) : null}
        <Text className="font-sans text-sm text-ink-3">{card.applicabilityText}</Text>
        {card.stateLines.map((line) => (
          <Text key={line} className="font-sans text-sm text-ink-2">
            {line}
          </Text>
        ))}
      </View>
      {card.decisionAidUrl ? (
        <TextButton
          label={i18n._(PREVENTIVE_COPY.decisionAid)}
          external
          onPress={() => void Linking.openURL(card.decisionAidUrl!)}
        />
      ) : null}
      {canEdit && !card.beingReviewed ? (
        <Details summary={t`Update your record`}>
          <View className="gap-3 border-t border-rule pt-3">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={pending}
                    onPress={() => onUpdate({ itemId: view.id, nextOn: view.suggestedNextOn })}
                    className="self-start"
                  >
                    <Button.Label>
                      {i18n._(
                        PREVENTIVE_COPY.useSuggestion(formatGuidanceDate(view.suggestedNextOn)),
                      )}
                    </Button.Label>
                  </Button>
                ) : null}
                <SwitchRow
                  label={i18n._(PREVENTIVE_COPY.remind)}
                  value={view.state.remind}
                  disabled={pending || view.state.nextOn === null}
                  onValueChange={(remind) => onUpdate({ itemId: view.id, remind })}
                />
                {view.reminderMode === "expect_invitation" ? (
                  <Choice
                    label={i18n._(PREVENTIVE_COPY.plans.expect_invitation)}
                    selected={view.state.plan === "expect_invitation"}
                    disabled={pending}
                    onPress={() =>
                      onUpdate({
                        itemId: view.id,
                        plan:
                          view.state.plan === "expect_invitation" ? "none" : "expect_invitation",
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
        </Details>
      ) : null}
    </ListCard>
  );
}

export default function PreventiveCareScreen() {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const foreground = useThemeColor("foreground");
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

  const title = i18n._(PREVENTIVE_COPY.pageTitle);

  if (result.isPending)
    return (
      <Container>
        <Page>
          <PageHeader title={title} />
          <TileRow>
            <Sheet className="h-32" />
            <Sheet className="h-32" />
          </TileRow>
          <Sheet className="h-48" />
        </Page>
      </Container>
    );
  if (result.isError || !result.data)
    return (
      <Container>
        <Page>
          <PageHeader title={title} />
          <ErrorState
            title={t`Could not load preventive care.`}
            action={
              <Button variant="outline" size="sm" onPress={() => void result.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const model = preventiveScreenModel(i18n, result.data);
  const lib = libraryModel(i18n, model.libraryEnabled ? library.data : undefined);
  const dueCount = model.items.filter(({ view }) => view.dateReached).length;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={result.isRefetching}
            onRefresh={() => void result.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        {/* The intro is safety copy (general information, not medical advice): it stays on show. */}
        <PageHeader
          title={model.title}
          description={model.intro}
          info={<Text className="font-sans text-sm text-ink-3">{model.versionText}</Text>}
        />

        {message ? <ErrorState title={message} /> : null}

        {model.statusText ? (
          <Sheet className="items-start gap-3">
            <ToneIcon icon={ShieldCheck} tone="water" />
            <Text className="font-sans text-base text-ink-2">{model.statusText}</Text>
            {model.showProfileLink ? (
              <Link href="/profile" asChild>
                <Pressable
                  accessibilityRole="link"
                  className="min-h-11 justify-center active:opacity-70"
                >
                  <Text className="font-display text-base font-medium text-ink underline">
                    {i18n._(PREVENTIVE_COPY.profileLink)}
                  </Text>
                </Pressable>
              </Link>
            ) : null}
            {model.notes.map((note) => (
              <Text key={note} className="font-sans text-sm text-ink-3">
                {note}
              </Text>
            ))}
          </Sheet>
        ) : (
          <>
            <View className="gap-3">
              <TileRow>
                <StatTile
                  icon={ShieldCheck}
                  tone="water"
                  label={t`For you`}
                  value={model.items.length}
                />
                <StatTile
                  icon={CalendarClock}
                  tone="water"
                  label={t`Date reached`}
                  value={dueCount}
                  status={
                    dueCount > 0
                      ? { tone: "warn", label: t`Worth a look` }
                      : { tone: "good", label: t`All clear` }
                  }
                />
              </TileRow>

              {model.notes.length > 0 ? (
                model.items.length === 0 ? (
                  <Sheet className="gap-2">
                    {model.notes.map((note) => (
                      <Text key={note} className="font-sans text-sm text-ink-2">
                        {note}
                      </Text>
                    ))}
                  </Sheet>
                ) : (
                  <View className="flex-row items-center gap-1">
                    <Text className="shrink font-sans text-sm text-ink-3">{model.notes[0]}</Text>
                    {model.notes.length > 1 ? (
                      <InfoTip>
                        {model.notes.map((note) => (
                          <Prose key={note}>{note}</Prose>
                        ))}
                      </InfoTip>
                    ) : null}
                  </View>
                )
              ) : null}
            </View>

            {model.items.length > 0 ? (
              <View className="gap-3">
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
              </View>
            ) : null}

            {model.criteria.length > 0 ? (
              <Section
                icon={MessageCircleQuestion}
                tone="water"
                title={i18n._(PREVENTIVE_COPY.criteriaTitle)}
                info={i18n._(PREVENTIVE_COPY.criteriaIntro)}
              >
                <Sheet className="gap-0 p-0">
                  {model.criteria.map((criterion, index) => (
                    <View
                      key={criterion.id}
                      className={`gap-2 px-5 py-4 ${index > 0 ? "border-t border-rule" : ""}`}
                    >
                      <View className="flex-row items-start gap-1">
                        <Text className="shrink font-sans text-base font-semibold text-ink">
                          {criterion.question}
                        </Text>
                        <InfoTip title={criterion.question}>{criterion.purpose}</InfoTip>
                      </View>
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
                </Sheet>
              </Section>
            ) : null}

            {model.notShown.length > 0 ? (
              <Details
                summary={`${i18n._(PREVENTIVE_COPY.notShownTitle)} (${model.notShown.length})`}
              >
                <Sheet className="gap-2 p-4">
                  <Text className="font-sans text-sm text-ink-3">
                    {i18n._(PREVENTIVE_COPY.notShownIntro)}
                  </Text>
                  {model.notShown.map((name, index) => (
                    <Text key={`${name}-${index}`} className="font-sans text-sm text-ink-2">
                      • {name}
                    </Text>
                  ))}
                </Sheet>
              </Details>
            ) : null}
          </>
        )}

        {model.statusText === null ? (
          <>
            {model.canEdit ? (
              <Sheet className="py-3">
                <SwitchRow
                  label={i18n._(PREVENTIVE_COPY.libraryToggle)}
                  value={model.libraryEnabled}
                  disabled={pending}
                  onValueChange={(enabled) => settings.mutate(enabled)}
                  info={i18n._(PREVENTIVE_COPY.libraryToggleHint)}
                />
              </Sheet>
            ) : null}
            {lib.cards.length > 0 ? (
              <Section
                icon={BookOpen}
                tone="water"
                title={i18n._(LIBRARY_COPY.title)}
                info={lib.text}
              >
                <View className="gap-3">
                  {lib.cards.map((entry) => (
                    <Sheet key={entry.key} className="gap-2.5">
                      <Text
                        className="font-display text-lg font-semibold text-ink"
                        accessibilityRole="header"
                      >
                        {entry.title}
                      </Text>
                      <View className="flex-row flex-wrap items-center gap-2">
                        <StatusPill tone="neutral">{entry.verdictLabel}</StatusPill>
                        <Text className="font-sans text-sm text-ink-3">{entry.certaintyLabel}</Text>
                      </View>
                      {entry.lines.map((line) => (
                        <Text key={line} className="font-sans text-sm leading-relaxed text-ink-2">
                          {line}
                        </Text>
                      ))}
                      <Details summary={t`Sources`}>
                        <View>
                          {entry.sources.map((source) => (
                            <TextButton
                              key={source.url + source.citation}
                              label={`${source.citation}${source.note ? ` — ${source.note}` : ""}`}
                              external
                              onPress={() => void Linking.openURL(source.url)}
                            />
                          ))}
                        </View>
                      </Details>
                    </Sheet>
                  ))}
                </View>
              </Section>
            ) : (
              <Text className="font-sans text-sm text-ink-3">{lib.text}</Text>
            )}
            <Text className="font-sans text-xs text-ink-3">{model.disclaimer}</Text>
          </>
        ) : null}
      </Page>
    </Container>
  );
}
