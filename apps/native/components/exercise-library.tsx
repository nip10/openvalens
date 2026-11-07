import { Trans, useLingui } from "@lingui/react/macro";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Card, Spinner } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { DISPLAY_MAX_FONT_SCALE } from "@/components/font-scale";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { ExerciseDetailView } from "@/components/exercise-detail";
import { ExerciseThumbnail } from "@/components/exercise-thumbnail";
import { SelectField } from "@/components/select-field";
import { rowChips } from "@/lib/exercises/detail";
import { useThemeColor } from "@/utils/theme";
import { ChevronRight } from "lucide-react-native";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { workoutTypeLabel } from "@openvalens/api/presenters/workouts";

const INPUT =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG_LANGUAGE = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 16) || "en";
type CatalogIntent =
  | {
      scope: string;
      operation: "createCustom";
      payload: { name: string; language: string; instructions?: string };
      clientMutationId: string;
    }
  | {
      scope: string;
      operation: "addFromLibrary";
      payload: { workoutId: number; exerciseId: number; language: string };
      clientMutationId: string;
    };

function secureClientMutationId(): string | null {
  try {
    const value = Crypto.randomUUID();
    return UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

export default function ExerciseLibraryScreen() {
  const { t, i18n } = useLingui();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [query, setQuery] = useState("");
  const [muscleExternalId, setMuscleExternalId] = useState("");
  const [equipmentExternalId, setEquipmentExternalId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [workoutId, setWorkoutId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState("en");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [refreshedAfterUncertain, setRefreshedAfterUncertain] = useState(false);
  const previousScope = useRef(scope);
  const currentScopeRef = useRef(scope);
  const intentRef = useRef<CatalogIntent | null>(null);
  const dispatchingIntentRef = useRef<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [, refreshAfterScopeReset] = useState(0);
  currentScopeRef.current = scope;
  const scopeChanging = previousScope.current !== scope;
  useEffect(
    () => () => {
      intentRef.current = null;
      dispatchingIntentRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    intentRef.current = null;
    dispatchingIntentRef.current = null;
    setIsDispatching(false);
    setSelectedId(null);
    setQuery("");
    setWorkoutId(null);
    setName("");
    setInstructions("");
    setLanguage("en");
    setMuscleExternalId("");
    setEquipmentExternalId("");
    setShowCreate(false);
    setUncertain(false);
    setRefreshedAfterUncertain(false);
    setNotice("");
    refreshAfterScopeReset((value) => value + 1);
  }, [scope]);
  const params = {
    query: scopeChanging ? undefined : query.trim() || undefined,
    language: CATALOG_LANGUAGE,
    limit: 50,
  };
  const filters = useQuery({
    ...orpc.exerciseCatalog.filters.queryOptions({ input: {} }),
    queryKey: [...orpc.exerciseCatalog.filters.queryOptions({ input: {} }).queryKey, { scope }],
    enabled: Boolean(scope),
    placeholderData: undefined,
  });
  const searchParams = {
    ...params,
    muscleExternalId: scopeChanging ? undefined : muscleExternalId || undefined,
    equipmentExternalId: scopeChanging ? undefined : equipmentExternalId || undefined,
  };
  const catalog = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({ input: searchParams }),
    queryKey: [
      ...orpc.exerciseCatalog.search.queryOptions({ input: searchParams }).queryKey,
      { scope },
    ],
    enabled: Boolean(scope),
    placeholderData: undefined,
  });
  const detail = useQuery({
    ...orpc.exerciseCatalog.get.queryOptions({
      input: { id: selectedId ?? 1, language: CATALOG_LANGUAGE },
    }),
    queryKey: [
      ...orpc.exerciseCatalog.get.queryOptions({
        input: { id: selectedId ?? 1, language: CATALOG_LANGUAGE },
      }).queryKey,
      { scope },
    ],
    enabled: Boolean(scope && selectedId && !scopeChanging),
  });
  const workouts = useQuery({
    ...orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }),
    queryKey: [
      ...orpc.plans.workouts.listWorkouts.queryOptions({ input: { limit: 50 } }).queryKey,
      { scope },
    ],
    enabled: Boolean(scope),
  });
  const custom = useMutation(orpc.exerciseCatalog.createCustom.mutationOptions({ retry: false }));
  const add = useMutation(orpc.exerciseCatalog.addFromLibrary.mutationOptions({ retry: false }));
  const intentIsCurrent = (intent: CatalogIntent) =>
    currentScopeRef.current === intent.scope &&
    intentRef.current?.scope === intent.scope &&
    intentRef.current.clientMutationId === intent.clientMutationId &&
    intentRef.current.operation === intent.operation;
  const dispatchIntent = async (intent: CatalogIntent) => {
    if (dispatchingIntentRef.current || !intentIsCurrent(intent)) return;
    dispatchingIntentRef.current = intent.clientMutationId;
    setIsDispatching(true);
    try {
      let result: { id: number; name: string } | null;
      if (intent.operation === "createCustom") {
        const request = { ...intent.payload, clientMutationId: intent.clientMutationId };
        result = await custom.mutateAsync(request);
      } else {
        const request = { ...intent.payload, clientMutationId: intent.clientMutationId };
        result = await add.mutateAsync(request);
      }
      if (!intentIsCurrent(intent)) return;
      if (!result) {
        setUncertain(true);
        setRefreshedAfterUncertain(false);
        setNotice(t`Could not confirm the result. Refresh and review before trying again.`);
        return;
      }
      intentRef.current = null;
      setUncertain(false);
      setRefreshedAfterUncertain(false);
      setNotice(
        intent.operation === "createCustom"
          ? t`${result.name} added to this workspace.`
          : t`${result.name} added to the workout.`,
      );
      if (intent.operation === "createCustom") {
        if (
          name.trim() === intent.payload.name &&
          language.trim() === intent.payload.language &&
          (instructions.trim() || undefined) === intent.payload.instructions
        ) {
          setName("");
          setInstructions("");
        }
        void catalog.refetch();
      } else void workouts.refetch();
    } catch {
      if (!intentIsCurrent(intent)) return;
      setUncertain(true);
      setRefreshedAfterUncertain(false);
      setNotice(t`Could not confirm the result. Refresh and review before trying again.`);
    } finally {
      if (dispatchingIntentRef.current === intent.clientMutationId) {
        dispatchingIntentRef.current = null;
        setIsDispatching(false);
      }
    }
  };
  const startCreate = () => {
    if (!scope || scopeChanging || uncertain || isDispatching || dispatchingIntentRef.current)
      return;
    const payload = {
      name: name.trim(),
      language: language.trim(),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    };
    const clientMutationId = secureClientMutationId();
    if (!clientMutationId) {
      setNotice(t`Secure request IDs are unavailable. No request was sent.`);
      return;
    }
    const intent: CatalogIntent = { scope, operation: "createCustom", payload, clientMutationId };
    intentRef.current = intent;
    void dispatchIntent(intent);
  };
  const startAdd = () => {
    if (
      !scope ||
      scopeChanging ||
      uncertain ||
      isDispatching ||
      dispatchingIntentRef.current ||
      !selectedId ||
      !workoutId
    )
      return;
    const payload = {
      workoutId,
      exerciseId: selectedId,
      language: detail.data?.language ?? CATALOG_LANGUAGE,
    };
    const clientMutationId = secureClientMutationId();
    if (!clientMutationId) {
      setNotice(t`Secure request IDs are unavailable. No request was sent.`);
      return;
    }
    const intent: CatalogIntent = { scope, operation: "addFromLibrary", payload, clientMutationId };
    intentRef.current = intent;
    void dispatchIntent(intent);
  };
  const refreshToReconcile = async () => {
    const intent = intentRef.current;
    if (!intent || intent.scope !== currentScopeRef.current) return;
    const results = await Promise.all([catalog.refetch(), workouts.refetch()]);
    if (intentIsCurrent(intent) && results.every((result) => !result.isError)) {
      setRefreshedAfterUncertain(true);
      setNotice(
        t`Library and workouts refreshed. Review them, then retry the same request if needed.`,
      );
    }
  };

  const chevron = useThemeColor("ink-3");
  const muscleOptions = filters.data?.muscles ?? [];
  const equipmentOptions = filters.data?.equipment ?? [];
  if (sessionPending || scopeChanging)
    return (
      <Container>
        <View className="flex-1 items-center justify-center p-6">
          <Spinner />
        </View>
      </Container>
    );
  if (!scope)
    return (
      <Container>
        <View className="gap-2 p-4">
          <Text
            className="font-display text-[30px] font-semibold leading-[36px] text-ink"
            maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
          >
            <Trans>Exercise library</Trans>
          </Text>
          <Text className="font-sans text-sm text-ink-3">
            <Trans>Sign in to browse exercises for your workspace.</Trans>
          </Text>
        </View>
      </Container>
    );

  return (
    <Container>
      <View className="gap-4 p-4">
        {selectedId ? null : (
          <View className="flex-row items-center justify-between gap-2">
            <Text
              accessibilityRole="header"
              className="shrink font-display text-[28px] font-semibold leading-[34px] text-ink"
              maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
            >
              <Trans>Exercise library</Trans>
            </Text>
            <Pressable
              testID="library-custom"
              accessibilityRole="button"
              accessibilityState={{ expanded: showCreate }}
              onPress={() => setShowCreate((value) => !value)}
              className="min-h-11 justify-center rounded-full border border-rule-2 bg-sheet px-4"
            >
              <Text className="font-sans text-sm font-semibold text-ink">{t`+ Custom`}</Text>
            </Pressable>
          </View>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
            {notice}
          </Text>
        ) : null}
        {isDispatching ? (
          <Button
            variant="secondary"
            onPress={() => {
              intentRef.current = null;
              dispatchingIntentRef.current = null;
              setIsDispatching(false);
              setUncertain(false);
              setRefreshedAfterUncertain(false);
              setNotice(t`Stopped waiting. The request may still complete on the server.`);
            }}
          >
            {t`Cancel request`}
          </Button>
        ) : null}
        {uncertain ? (
          <Card variant="secondary" className="gap-2 rounded-3xl p-4">
            <Text className="font-sans text-sm text-ink">
              <Trans>Could not confirm. Refresh and review before trying again.</Trans>
            </Text>
            {!refreshedAfterUncertain ? (
              <Button
                variant="secondary"
                isDisabled={isDispatching}
                onPress={() => void refreshToReconcile()}
              >
                {t`Refresh and review`}
              </Button>
            ) : (
              <Button
                variant="secondary"
                isDisabled={isDispatching}
                onPress={() => {
                  const intent = intentRef.current;
                  if (intent) void dispatchIntent(intent);
                }}
              >
                {t`Retry same request`}
              </Button>
            )}
          </Card>
        ) : null}
        {selectedId ? (
          <ExerciseDetailView
            exerciseId={selectedId}
            onBack={() => setSelectedId(null)}
            extra={
              <View className="gap-3 rounded-3xl bg-paper-2 p-4">
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  <Trans>Add to workout</Trans>
                </Text>
                {workouts.isPending ? (
                  <Spinner />
                ) : workouts.isError ? (
                  <View className="gap-2">
                    <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
                      <Trans>Could not load workouts.</Trans>
                    </Text>
                    <Button variant="secondary" onPress={() => void workouts.refetch()}>
                      {t`Retry workouts`}
                    </Button>
                  </View>
                ) : workouts.data?.length ? (
                  <View className="flex-row flex-wrap gap-2">
                    {workouts.data.map((workout) => (
                      <Pressable
                        key={workout.id}
                        disabled={uncertain || isDispatching || scopeChanging || !workout.canEdit}
                        onPress={() => setWorkoutId(workout.id)}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: workoutId === workout.id,
                          disabled: !workout.canEdit,
                        }}
                        className={`min-h-11 justify-center rounded-xl border border-rule-2 px-3 ${workoutId === workout.id ? "bg-primary/10" : ""}`}
                      >
                        <Text className="font-sans text-sm text-ink">
                          {friendlyDate(i18n, workout.date)},{" "}
                          {i18n._(workoutTypeLabel(workout.type))}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text className="font-sans text-sm text-ink-3">
                    <Trans>Create a workout first, then return here to add an exercise.</Trans>
                  </Text>
                )}
                <Button
                  isDisabled={
                    !workoutId || !selectedId || isDispatching || uncertain || scopeChanging
                  }
                  onPress={startAdd}
                >
                  {isDispatching ? t`Adding…` : t`Add exercise`}
                </Button>
              </View>
            }
          />
        ) : (
          <>
            <Card variant="secondary" className="gap-3 rounded-3xl p-5">
              <Text className="font-display text-xl font-semibold text-ink">
                <Trans>Browse</Trans>
              </Text>
              <TextInput
                editable={!uncertain && !isDispatching && !scopeChanging}
                value={query}
                onChangeText={setQuery}
                placeholder={t`Search by exercise name`}
                accessibilityLabel={t`Search by exercise name`}
                className={INPUT}
                placeholderTextColor="#9ca3af"
              />
              {filters.isError ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="font-sans flex-1 text-xs text-ink-3" accessibilityRole="alert">
                    <Trans>Filters are unavailable; name search still works.</Trans>
                  </Text>
                  <Button size="sm" variant="secondary" onPress={() => void filters.refetch()}>
                    {t`Retry filters`}
                  </Button>
                </View>
              ) : muscleOptions.length > 0 || equipmentOptions.length > 0 ? (
                // Dropdowns, not pill rows (#404); a filter with no options is hidden.
                <View className="flex-row gap-2">
                  {muscleOptions.length > 0 ? (
                    <View className="flex-1">
                      <SelectField
                        testID="library-filter-muscle"
                        accessibilityLabel={t`Filter by muscle`}
                        value={muscleExternalId || "all"}
                        options={[
                          { value: "all", label: t`All muscles` },
                          ...muscleOptions.map((item) => ({
                            value: item.externalId,
                            label: item.name,
                          })),
                        ]}
                        onChange={(value) => setMuscleExternalId(value === "all" ? "" : value)}
                      />
                    </View>
                  ) : null}
                  {equipmentOptions.length > 0 ? (
                    <View className="flex-1">
                      <SelectField
                        testID="library-filter-equipment"
                        accessibilityLabel={t`Filter by equipment`}
                        value={equipmentExternalId || "all"}
                        options={[
                          { value: "all", label: t`All equipment` },
                          ...equipmentOptions.map((item) => ({
                            value: item.externalId,
                            label: item.name,
                          })),
                        ]}
                        onChange={(value) => setEquipmentExternalId(value === "all" ? "" : value)}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
              {!scope ? (
                <Text className="font-sans text-sm text-ink-3">
                  <Trans>Sign in to browse your workspace library.</Trans>
                </Text>
              ) : catalog.isPending ? (
                <Spinner />
              ) : catalog.isError ? (
                <View className="gap-2">
                  <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
                    <Trans>Could not load exercises.</Trans>
                  </Text>
                  <Button variant="secondary" onPress={() => void catalog.refetch()}>
                    {t`Try again`}
                  </Button>
                </View>
              ) : catalog.data?.length ? (
                <View className="sheet px-3.5 py-1">
                  {catalog.data.map((item, index) => (
                    <Pressable
                      key={item.id}
                      testID={`library-row-${index + 1}`}
                      disabled={uncertain || isDispatching || scopeChanging}
                      onPress={() => setSelectedId(item.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedId === item.id }}
                      className={`min-h-[76px] flex-row items-center gap-3 ${
                        index < catalog.data!.length - 1 ? "border-b border-rule" : ""
                      }`}
                    >
                      <ExerciseThumbnail exerciseId={item.id} media={item.media} size={52} />
                      <View className="min-w-0 flex-1 gap-1.5">
                        <Text className="font-sans text-base font-semibold text-ink">
                          {item.name}
                        </Text>
                        <View className="flex-row flex-wrap gap-1.5">
                          {item.source === "user" ? (
                            <Text className="rounded-full bg-paper-3 px-2 py-0.5 font-sans text-xs text-ink-2">
                              {t`Custom`}
                            </Text>
                          ) : null}
                          {rowChips({
                            muscles: item.muscles ?? [],
                            equipment: item.equipment ?? [],
                          }).map((chip) => (
                            <Text
                              key={chip}
                              className="rounded-full bg-paper-2 px-2 py-0.5 font-sans text-xs text-ink-2"
                            >
                              {chip}
                            </Text>
                          ))}
                        </View>
                      </View>
                      <ChevronRight size={16} color={chevron} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View className="gap-1 rounded-2xl border border-dashed border-rule-2 p-4">
                  <Text className="font-sans font-medium text-ink">
                    {query.trim() ? t`No exercises match this search.` : t`No exercises found yet`}
                  </Text>
                  <Text className="font-sans text-sm text-ink-3">
                    {query.trim()
                      ? t`Try another name, or clear the search.`
                      : t`An administrator can import licensed exercises, or you can create a workspace exercise below.`}
                  </Text>
                </View>
              )}
            </Card>
            {showCreate ? (
              <Card variant="secondary" className="gap-3 rounded-3xl p-5">
                <Text className="font-display text-xl font-semibold text-ink">
                  <Trans>Create workspace exercise</Trans>
                </Text>
                <Text className="font-sans text-xs text-ink-3">
                  <Trans>Visible to members of this workspace.</Trans>
                </Text>
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  <Trans>Name</Trans>
                </Text>
                <TextInput
                  editable={!uncertain && !isDispatching && !scopeChanging}
                  value={name}
                  onChangeText={setName}
                  maxLength={200}
                  accessibilityLabel={t`Exercise name`}
                  className={INPUT}
                />
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  <Trans>Language code</Trans>
                </Text>
                <TextInput
                  editable={!uncertain && !isDispatching && !scopeChanging}
                  value={language}
                  onChangeText={setLanguage}
                  maxLength={16}
                  accessibilityLabel={t`Language code`}
                  className={INPUT}
                />
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  <Trans>Instructions (optional)</Trans>
                </Text>
                <TextInput
                  editable={!uncertain && !isDispatching && !scopeChanging}
                  value={instructions}
                  onChangeText={setInstructions}
                  multiline
                  maxLength={5000}
                  accessibilityLabel={t`Exercise instructions, optional`}
                  className={`${INPUT} min-h-24 py-2`}
                />
                <Button
                  isDisabled={
                    !name.trim() ||
                    language.trim().length < 2 ||
                    isDispatching ||
                    uncertain ||
                    scopeChanging
                  }
                  onPress={startCreate}
                >
                  {isDispatching ? t`Creating…` : t`Create exercise`}
                </Button>
              </Card>
            ) : null}
          </>
        )}
      </View>
    </Container>
  );
}
