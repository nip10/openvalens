import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { ProgressPhotos } from "@/components/progress-photos";
import { authClient } from "@/lib/auth-client";
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
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";
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
          className="text-sm text-muted-foreground"
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
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {t`Checking private measurement setting…`}
        </Text>
      </Container>
    );
  }
  if (screen.access === "error") {
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text accessibilityRole="alert" className="text-center text-foreground">
          {t`Could not check this setting. Measurements stay unavailable until it can be confirmed.`}
        </Text>
        <Button variant="secondary" onPress={screen.retryPreference}>
          {t`Try again`}
        </Button>
      </Container>
    );
  }

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View>
          <Text className="text-sm text-muted-foreground">{t`Your records`}</Text>
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            {t`Private measurements`}
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            {t`Manual entries for your own reference. Workspace owners and other members cannot view them. Values stay hidden in history until the hide-numbers setting can be checked.`}
          </Text>
        </View>
        {screen.access === "disabled" ? (
          <CardStack title={t`Private measurements are off`}>
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-sm text-muted-foreground">
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
                <Text accessibilityRole="alert" className="text-sm text-destructive">
                  {t`Could not update this setting. Try again.`}
                </Text>
              ) : null}
            </Card>
          </CardStack>
        ) : (
          <>
            <View className="flex-row items-center justify-between rounded-xl border border-border bg-card p-4">
              <Text className="text-sm text-foreground">{t`Private measurements are on`}</Text>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={preferenceMutation.isPending}
                onPress={() => preferenceMutation.mutate(false)}
              >
                {t`Turn off`}
              </Button>
            </View>
            {screen.preferenceMutationError ? (
              <Text accessibilityRole="alert" className="text-sm text-destructive">
                {t`Could not update this setting. Try again.`}
              </Text>
            ) : null}
            <CardStack title={editingId ? t`Edit entry` : t`Add an entry`}>
              <Card variant="secondary" className="gap-4 p-4">
                <View className="gap-2">
                  <Text className="text-sm font-medium text-foreground">{t`Measurement`}</Text>
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
                        className={`min-h-11 justify-center rounded-full border px-3 ${kind === option ? "border-primary bg-primary/15" : "border-border bg-card"}`}
                      >
                        <Text className="text-sm text-foreground">
                          {i18n._(KIND_LABELS[option])}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View className="flex-row gap-3">
                  <View className="flex-1 gap-2">
                    <Text className="text-sm font-medium text-foreground">
                      {t`${labelOf(kind)} value`}
                    </Text>
                    <TextInput
                      accessibilityLabel={t`${labelOf(kind)} value`}
                      value={value}
                      onChangeText={setValue}
                      keyboardType="decimal-pad"
                      className={INPUT_CLASS}
                    />
                  </View>
                  <View className="gap-2">
                    <Text className="text-sm font-medium text-foreground">{t`Unit`}</Text>
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
                          className={`min-h-11 justify-center rounded-lg border px-3 ${unit === option ? "border-primary bg-primary/15" : "border-border bg-card"}`}
                        >
                          <Text className="text-foreground">{option}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
                <View className="gap-2">
                  <Text className="text-sm font-medium text-foreground">
                    {t`Observed at (local time)`}
                  </Text>
                  <TextInput
                    accessibilityLabel={t`Observed at local time`}
                    value={measuredAt}
                    onChangeText={setMeasuredAt}
                    placeholder="YYYY-MM-DDTHH:MM"
                    className={INPUT_CLASS}
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
                      variant="secondary"
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
                    <Text accessibilityRole="alert" className="text-sm text-destructive">
                      {t`Enter a valid positive value and real local date/time.`}
                    </Text>
                  ) : null}
                </View>
                {screen.saveMutationError ? (
                  <Text accessibilityRole="alert" className="text-sm text-destructive">
                    {t`Could not save this entry. Try again.`}
                  </Text>
                ) : null}
              </Card>
            </CardStack>
            <CardStack title={t`History`}>
              <Card variant="secondary" className="p-0">
                {screen.history === "loading" ? (
                  <View className="flex-row items-center gap-3 p-4">
                    <Spinner />
                    <Text
                      accessibilityLiveRegion="polite"
                      className="text-sm text-muted-foreground"
                    >
                      {t`Loading your entries…`}
                    </Text>
                  </View>
                ) : null}
                {screen.history === "error" ? (
                  <View className="gap-3 p-4">
                    <Text accessibilityRole="alert" className="text-sm text-foreground">
                      {t`Could not load entries.`}
                    </Text>
                    <Button variant="secondary" onPress={screen.retryHistory}>
                      {t`Try again`}
                    </Button>
                  </View>
                ) : null}
                {screen.history === "empty" ? (
                  <Text className="p-4 text-sm text-muted-foreground">
                    {t`No private entries yet.`}
                  </Text>
                ) : null}
                {screen.history === "ready"
                  ? (historyQuery.data ?? []).map((entry, index, entries) => {
                      const date = new Date(entry.measuredAt).toLocaleString();
                      const label = labelOf(entry.kind);
                      return (
                        <View
                          key={entry.id}
                          className={`gap-2 p-4 ${index < entries.length - 1 ? "border-b border-border" : ""}`}
                        >
                          <View className="flex-row items-center justify-between gap-2">
                            <View className="flex-1">
                              <Text className="font-medium text-foreground">{label}</Text>
                              <Text className="text-xs text-muted-foreground">{date}</Text>
                            </View>
                            <View className="flex-row gap-2">
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t`Edit ${label} entry from ${date}`}
                                onPress={() => {
                                  setEditingId(entry.id);
                                  setKind(entry.kind as PrivateKind);
                                  setUnit(entry.unit);
                                  setValue("");
                                  setMeasuredAt(
                                    new Date(
                                      new Date(entry.measuredAt).getTime() -
                                        new Date(entry.measuredAt).getTimezoneOffset() * 60000,
                                    )
                                      .toISOString()
                                      .slice(0, 16),
                                  );
                                }}
                                className="min-h-11 justify-center px-2"
                              >
                                <Text className="font-medium text-foreground underline">
                                  {t`Edit`}
                                </Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t`Delete ${label} entry from ${date}`}
                                disabled={remove.isPending}
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
                                className="min-h-11 justify-center px-2"
                              >
                                <Text className="font-medium text-foreground underline">
                                  {t`Delete`}
                                </Text>
                              </Pressable>
                            </View>
                          </View>
                          {screen.deleteFailureFor === entry.id ? (
                            <View className="gap-2">
                              <Text accessibilityRole="alert" className="text-sm text-destructive">
                                {t`Could not delete this entry. It is still in history.`}
                              </Text>
                              <Button
                                size="sm"
                                variant="secondary"
                                isDisabled={screen.deletePending}
                                onPress={() => remove.mutate(entry.id)}
                              >
                                {t`Try delete again`}
                              </Button>
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  : null}
              </Card>
            </CardStack>
            <ProgressPhotos subject={subject} />
          </>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
            {notice}
          </Text>
        ) : null}
      </View>
    </Container>
  );
}
