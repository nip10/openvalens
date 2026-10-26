import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import {
  History,
  Lock,
  Pencil,
  Plus,
  Ruler,
  Scale,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  Icon,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { ProgressPhotos } from "@/components/progress-photos";
import { authClient } from "@/lib/auth-client";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import {
  makeMeasurementPayload,
  bindPrivateMeasurementActions,
  nextKindDraft,
  nextUnitDraft,
  PRIVATE_KINDS,
  privateMeasurementScreenState,
  privateMeasurementKeys,
  unitsFor,
  type PrivateKind,
  type PrivateSubject,
} from "@/utils/private-measurements";
import { useThemeColor } from "@/utils/theme";

const KIND_LABELS: Record<PrivateKind, MessageDescriptor> = {
  weight: msg`Weight`,
  waist: msg`Waist`,
  hip: msg`Hip`,
  neck: msg`Neck`,
  chest: msg`Chest`,
  upper_arm: msg`Upper arm`,
  thigh: msg`Thigh`,
};

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink";
const nowLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export default function PrivateMeasurementsScreen() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { t } = useLingui();
  const subject: PrivateSubject | null =
    session?.user?.id && session.session.activeOrganizationId
      ? { userId: session.user.id, organizationId: session.session.activeOrganizationId }
      : null;
  if (sessionPending || !subject) {
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          className="font-sans text-sm text-ink-3"
        >
          {sessionPending
            ? t`Checking your account and workspace…`
            : t`Choose a workspace to continue.`}
        </Text>
      </Container>
    );
  }
  return (
    <PrivateMeasurementsForSubject
      key={`${subject.organizationId}:${subject.userId}`}
      subject={subject}
    />
  );
}

function PrivateMeasurementsForSubject({ subject }: { subject: PrivateSubject }) {
  const qc = useQueryClient();
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const labelOf = (value: string) => {
    const known = KIND_LABELS[value as PrivateKind];
    return known ? i18n._(known) : value;
  };
  const keys = privateMeasurementKeys(subject);
  const actions = bindPrivateMeasurementActions({
    setPreference: (enabled) => orpc.privateBody.setPreference.call({ enabled }),
    create: (value) => orpc.privateBody.create.call(value),
    update: (id, value) => orpc.privateBody.update.call({ id, value }),
    delete: (id) => orpc.privateBody.delete.call({ id }),
  });
  const preferenceQuery = useQuery({
    ...orpc.privateBody.preference.queryOptions({ input: {} }),
    queryKey: keys.preference,
    enabled: Boolean(subject.userId && subject.organizationId),
    retry: false,
  });
  const historyQuery = useQuery({
    ...orpc.privateBody.list.queryOptions({ input: {} }),
    queryKey: keys.list,
    enabled:
      Boolean(subject.userId && subject.organizationId) && preferenceQuery.data?.enabled === true,
  });
  const [kind, setKind] = useState<PrivateKind>("weight");
  const [unit, setUnit] = useState("kg");
  const [value, setValue] = useState("");
  const [measuredAt, setMeasuredAt] = useState(nowLocal);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.preference });
    void qc.invalidateQueries({ queryKey: keys.list });
  };
  const preferenceMutation = useMutation({
    mutationFn: actions.setPreference,
    onSuccess: (result) => {
      qc.setQueryData(keys.preference, result);
      setNotice(
        result.enabled ? t`Private measurements are on.` : t`Private measurements are off.`,
      );
      invalidate();
    },
    onError: () => setNotice(t`Could not update this setting. Try again.`),
  });
  const save = useMutation({
    mutationFn: (input: {
      id: string | null;
      value: NonNullable<ReturnType<typeof makeMeasurementPayload>>;
    }) => actions.save(input.id, input.value),
    onSuccess: () => {
      setValue("");
      setEditingId(null);
      setMeasuredAt(nowLocal());
      setNotice(t`Entry saved.`);
      invalidate();
    },
    onError: () => setNotice(t`Could not save this entry. Try again.`),
  });
  const remove = useMutation({
    mutationFn: actions.delete,
    onSuccess: () => {
      setNotice(t`Entry deleted.`);
      invalidate();
    },
    onError: () =>
      setNotice(t`Could not delete this entry. It is still in your history. Retry below.`),
  });

  const screen = privateMeasurementScreenState({
    subject,
    preference: {
      pending: preferenceQuery.isPending,
      error: preferenceQuery.isError,
      enabled: preferenceQuery.data?.enabled,
    },
    history: {
      pending: historyQuery.isPending,
      error: historyQuery.isError,
      count: historyQuery.data?.length,
    },
    refetchPreference: () => void preferenceQuery.refetch(),
    refetchHistory: () => void historyQuery.refetch(),
    preferenceMutation: {
      pending: preferenceMutation.isPending,
      error: preferenceMutation.isError,
    },
    saveMutation: { pending: save.isPending, error: save.isError },
    deleteMutation: {
      pending: remove.isPending,
      error: remove.isError,
      failedId: remove.variables,
    },
  });

  const payload = makeMeasurementPayload({ kind, unit, value, measuredAtLocal: measuredAt });
  if (screen.access === "loading") {
    return (
      <Container>
        <Page>
          <PageHeader title={t`Private measurements`} />
          <Sheet className="flex-row items-center gap-3">
            <Spinner />
            <Text className="font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
              {t`Checking private measurement setting…`}
            </Text>
          </Sheet>
        </Page>
      </Container>
    );
  }
  if (screen.access === "error") {
    return (
      <Container>
        <Page>
          <PageHeader title={t`Private measurements`} />
          <ErrorState
            title={t`Could not check this setting. Measurements stay unavailable until it can be confirmed.`}
            action={
              <Button variant="outline" size="sm" onPress={screen.retryPreference}>
                {t`Try again`}
              </Button>
            }
          />
        </Page>
      </Container>
    );
  }

  return (
    <Container>
      <Page>
        <PageHeader eyebrow={t`Your records`} title={t`Private measurements`} />
        <Sheet className="flex-row items-start gap-3 p-4">
          <ToneIcon icon={Lock} tone="weight" size="sm" />
          <Text className="min-w-0 flex-1 font-sans text-sm leading-relaxed text-ink-2">
            {t`Manual entries for your own reference. Workspace owners and other members cannot view them. Values stay hidden in history until the hide-numbers setting can be checked.`}
          </Text>
        </Sheet>
        {screen.access === "disabled" ? (
          <Section icon={Lock} tone="weight" title={t`Private measurements are off`} sheet>
            <Text className="font-sans text-base leading-relaxed text-ink-2">
              {t({
                message:
                  "This optional feature is off by default. Turning it on lets you record weight or circumference measurements and view progress photos in this account.",
                comment: "safety",
              })}
            </Text>
            <Button
              isDisabled={preferenceMutation.isPending}
              onPress={() => preferenceMutation.mutate(true)}
            >
              {preferenceMutation.isPending ? t`Saving…` : t`Turn on private measurements`}
            </Button>
            {screen.preferenceMutationError ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                {t`Could not update this setting. Try again.`}
              </Text>
            ) : null}
          </Section>
        ) : (
          <>
            <View className="gap-2">
              <Sheet className="flex-row items-center justify-between gap-3 p-4">
                <View className="min-w-0 flex-1 flex-row items-center gap-3">
                  <ToneIcon icon={ShieldCheck} tone="weight" />
                  <Text className="shrink font-sans text-base font-semibold text-ink-2">
                    {t`Private measurements are on`}
                  </Text>
                </View>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={preferenceMutation.isPending}
                  onPress={() => preferenceMutation.mutate(false)}
                >
                  {t`Turn off`}
                </Button>
              </Sheet>
              {screen.preferenceMutationError ? (
                <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                  {t`Could not update this setting. Try again.`}
                </Text>
              ) : null}
            </View>
            <Section
              icon={Plus}
              tone="weight"
              title={editingId ? t`Edit entry` : t`Add an entry`}
              sheet
            >
              <View className="gap-4">
                <View className="gap-2">
                  <Text className="font-sans text-sm font-medium text-ink-2">{t`Measurement`}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {PRIVATE_KINDS.map((option) => (
                      <Pressable
                        key={option}
                        onPress={() => {
                          const next = nextKindDraft(option);
                          setEditingId(next.editingId);
                          setKind(next.kind);
                          setUnit(next.unit);
                          setValue("");
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: kind === option }}
                        className={`min-h-11 justify-center rounded-full border px-4 ${kind === option ? "border-weight bg-weight-soft" : "border-rule-2 bg-sheet"}`}
                      >
                        <Text
                          className={`font-sans text-sm ${kind === option ? "font-semibold text-ink" : "text-ink-2"}`}
                        >
                          {i18n._(KIND_LABELS[option])}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View className="flex-row gap-3">
                  <View className="flex-1 gap-2">
                    <Text className="font-sans text-sm font-medium text-ink-2">
                      {t`${labelOf(kind)} value`}
                    </Text>
                    <TextInput
                      accessibilityLabel={t`${labelOf(kind)} value`}
                      value={value}
                      onChangeText={setValue}
                      keyboardType="decimal-pad"
                      className={INPUT_CLASS}
                      placeholderTextColor={placeholder}
                    />
                  </View>
                  <View className="gap-2">
                    <Text className="font-sans text-sm font-medium text-ink-2">{t`Unit`}</Text>
                    <View className="flex-row gap-2">
                      {unitsFor(kind).map((option) => (
                        <Pressable
                          key={option}
                          onPress={() => {
                            const next = nextUnitDraft(option);
                            setEditingId(next.editingId);
                            setUnit(next.unit);
                            setValue("");
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: unit === option }}
                          className={`min-h-11 justify-center rounded-xl border px-3 ${unit === option ? "border-weight bg-weight-soft" : "border-rule-2 bg-sheet"}`}
                        >
                          <Text className="font-sans text-base text-ink">{option}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
                <View className="gap-2">
                  <Text className="font-sans text-sm font-medium text-ink-2">
                    {t`Observed at (local time)`}
                  </Text>
                  <TextInput
                    accessibilityLabel={t`Observed at local time`}
                    value={measuredAt}
                    onChangeText={setMeasuredAt}
                    placeholder="YYYY-MM-DDTHH:MM"
                    className={INPUT_CLASS}
                    placeholderTextColor={placeholder}
                  />
                </View>
                <View className="flex-row flex-wrap items-center gap-3">
                  <Button
                    isDisabled={!payload || save.isPending}
                    onPress={() => payload && save.mutate({ id: editingId, value: payload })}
                  >
                    {save.isPending ? t`Saving…` : editingId ? t`Save changes` : t`Save entry`}
                  </Button>
                  {editingId ? (
                    <Button
                      variant="ghost"
                      onPress={() => {
                        setEditingId(null);
                        setValue("");
                        setMeasuredAt(nowLocal());
                      }}
                    >
                      {t`Cancel`}
                    </Button>
                  ) : null}
                  {value && !payload ? (
                    <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                      {t`Enter a valid positive value and real local date/time.`}
                    </Text>
                  ) : null}
                </View>
                {screen.saveMutationError ? (
                  <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                    {t`Could not save this entry. Try again.`}
                  </Text>
                ) : null}
              </View>
            </Section>
            <Section icon={History} tone="weight" title={t`History`}>
              {screen.history === "loading" ? (
                <Sheet className="flex-row items-center gap-3 p-4">
                  <Spinner />
                  <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
                    {t`Loading your entries…`}
                  </Text>
                </Sheet>
              ) : null}
              {screen.history === "error" ? (
                <ErrorState
                  title={t`Could not load entries.`}
                  action={
                    <Button variant="outline" size="sm" onPress={screen.retryHistory}>
                      {t`Try again`}
                    </Button>
                  }
                />
              ) : null}
              {screen.history === "empty" ? (
                <EmptyState icon={Ruler} tone="weight" title={t`No private entries yet.`} />
              ) : null}
              {screen.history === "ready" ? (
                <View className="gap-3">
                  {(historyQuery.data ?? []).map((entry) => {
                    const date = new Date(entry.measuredAt).toLocaleString();
                    const label = labelOf(entry.kind);
                    const measured = new Date(entry.measuredAt);
                    const localIso = new Date(
                      measured.getTime() - measured.getTimezoneOffset() * 60000,
                    ).toISOString();
                    return (
                      <ListCard
                        key={entry.id}
                        icon={entry.kind === "weight" ? Scale : Ruler}
                        tone="weight"
                        title={label}
                        subtitle={`${friendlyDate(i18n, localIso)} ${localIso.slice(11, 16)}`}
                        status={{ label: t`Hidden`, tone: "neutral" }}
                      >
                        <View className="flex-row flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            accessibilityLabel={t`Edit ${label} entry from ${date}`}
                            onPress={() => {
                              setEditingId(entry.id);
                              setKind(entry.kind as PrivateKind);
                              setUnit(entry.unit);
                              setValue("");
                              setMeasuredAt(localIso.slice(0, 16));
                            }}
                          >
                            <Icon icon={Pencil} size={14} color="ink-2" />
                            <Button.Label>{t`Edit`}</Button.Label>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            accessibilityLabel={t`Delete ${label} entry from ${date}`}
                            isDisabled={remove.isPending}
                            onPress={() =>
                              Alert.alert(
                                t`Delete private measurement?`,
                                t`This cannot be undone.`,
                                [
                                  { text: t`Cancel`, style: "cancel" },
                                  {
                                    text: t`Delete`,
                                    style: "destructive",
                                    onPress: () => {
                                      if (!remove.isPending) remove.mutate(entry.id);
                                    },
                                  },
                                ],
                              )
                            }
                          >
                            <Icon icon={Trash2} size={14} color="ink-2" />
                            <Button.Label>{t`Delete`}</Button.Label>
                          </Button>
                        </View>
                        {screen.deleteFailureFor === entry.id ? (
                          <View className="gap-2">
                            <Text
                              accessibilityRole="alert"
                              className="font-sans text-sm text-destructive"
                            >
                              {t`Could not delete this entry. It is still in history.`}
                            </Text>
                            <Button
                              size="sm"
                              variant="outline"
                              isDisabled={screen.deletePending}
                              onPress={() => remove.mutate(entry.id)}
                            >
                              {t`Try delete again`}
                            </Button>
                          </View>
                        ) : null}
                      </ListCard>
                    );
                  })}
                </View>
              ) : null}
            </Section>
            <ProgressPhotos subject={subject} />
          </>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
            {notice}
          </Text>
        ) : null}
      </Page>
    </Container>
  );
}
