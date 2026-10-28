import { ph, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Card, Spinner } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Image, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { ExerciseAttribution, TranslationAttribution } from "@/components/exercise-attribution";
import { MuscleGuide } from "@/components/muscle-guide";
import { WorkoutExerciseHistory } from "@/components/workout-history";
import { authClient } from "@/lib/auth-client";
import { ENV } from "@/src/env";
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

type PreviewAsset = {
  assetId: string;
  path: string;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  license: string;
  licenseUrl: string;
  author: string | null;
  attribution: string | null;
  sourceUrl: string;
  transformationNotice: string;
};
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPreviewAsset(value: unknown): value is PreviewAsset {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.assetId !== "string" ||
    !ASSET_ID.test(item.assetId) ||
    item.path !== `/api/exercise-assets/${item.assetId}`
  )
    return false;
  return (
    (item.contentType === "image/jpeg" || item.contentType === "image/png") &&
    typeof item.width === "number" &&
    Number.isSafeInteger(item.width) &&
    item.width > 0 &&
    item.width <= 10_000 &&
    typeof item.height === "number" &&
    Number.isSafeInteger(item.height) &&
    item.height > 0 &&
    item.height <= 10_000 &&
    typeof item.license === "string" &&
    item.license.trim().length > 0 &&
    typeof item.licenseUrl === "string" &&
    safeHttpUrl(item.licenseUrl) !== null &&
    (typeof item.author === "string" || item.author === null) &&
    (typeof item.attribution === "string" || item.attribution === null) &&
    typeof item.sourceUrl === "string" &&
    safeHttpUrl(item.sourceUrl) !== null &&
    typeof item.transformationNotice === "string"
  );
}

function previewAssets(value: unknown): PreviewAsset[] {
  return Array.isArray(value) ? value.filter(isPreviewAsset).slice(0, 4) : [];
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function previewUrl(
  asset: PreviewAsset,
  apiBase: string,
  browserOrigin: string | null,
): string | null {
  if (!ASSET_ID.test(asset.assetId) || asset.path !== `/api/exercise-assets/${asset.assetId}`)
    return null;
  if (Platform.OS === "web" && !browserOrigin) return null;
  try {
    const api = new URL(apiBase);
    if (
      (api.protocol !== "http:" && api.protocol !== "https:") ||
      api.username ||
      api.password ||
      api.search ||
      api.hash
    )
      return null;
    if (Platform.OS === "web" && api.origin !== browserOrigin) return null;
    return `${api.origin}/api/exercise-assets/${asset.assetId}`;
  } catch {
    return null;
  }
}

export function ExerciseMediaGallery({
  exerciseName,
  media,
  muscles,
}: {
  exerciseName: string;
  media: unknown;
  muscles: Array<{
    name: string;
    role?: string | null;
    location?: string | null;
    externalMuscleId?: string | null;
  }>;
}) {
  const { t } = useLingui();
  const assets = previewAssets(media);
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, "loaded" | "failed">>({});
  useEffect(() => {
    if (Platform.OS === "web") setBrowserOrigin(window.location.origin);
  }, []);
  if (assets.length === 0)
    return (
      <View className="gap-3">
        <Text className="font-sans rounded-2xl border border-dashed border-rule-2 p-4 text-center text-xs text-ink-3">
          {Array.isArray(media) && media.length > 0
            ? t`Preview unavailable because image license details are incomplete.`
            : t`No preview image is provided.`}
        </Text>
        <MuscleGuide muscles={muscles} />
      </View>
    );
  if (Platform.OS === "web" && !browserOrigin)
    return (
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans rounded-2xl border border-dashed border-rule-2 p-4 text-center text-xs text-ink-3"
      >
        <Trans>Preparing preview…</Trans>
      </Text>
    );
  const urls = assets.map((asset) => ({
    asset,
    url: previewUrl(asset, ENV.EXPO_PUBLIC_SERVER_URL, browserOrigin),
  }));
  return (
    <View className="gap-4" accessibilityLabel={t`${exerciseName} previews`}>
      {urls.map(({ asset, url }, index) => (
        <View key={asset.assetId} className="gap-2">
          <View
            className="relative overflow-hidden rounded-2xl border border-rule bg-paper-2"
            style={{ aspectRatio: asset.width / asset.height, maxHeight: 320 }}
          >
            {!url ? (
              <View className="flex-1 items-center justify-center p-4">
                <Text className="font-sans text-center text-xs text-ink-3">
                  <Trans>Preview unavailable on this connection.</Trans>
                </Text>
              </View>
            ) : states[asset.assetId] === "failed" ? (
              <View className="flex-1 items-center justify-center p-4">
                <Text
                  accessibilityLiveRegion="polite"
                  className="font-sans text-center text-xs text-ink-3"
                >
                  <Trans>Preview unavailable.</Trans>
                </Text>
              </View>
            ) : (
              <>
                <View className="absolute inset-0 items-center justify-center">
                  <Text accessibilityLiveRegion="polite" className="font-sans text-xs text-ink-3">
                    {states[asset.assetId] === "loaded" ? "" : t`Loading preview…`}
                  </Text>
                </View>
                <Image
                  source={{ uri: url }}
                  accessibilityRole="image"
                  accessibilityLabel={t`${exerciseName} preview ${ph({ number: index + 1 })}`}
                  resizeMode="contain"
                  onLoad={() => setStates((current) => ({ ...current, [asset.assetId]: "loaded" }))}
                  onError={() =>
                    setStates((current) => ({ ...current, [asset.assetId]: "failed" }))
                  }
                  className={`h-full w-full ${states[asset.assetId] === "loaded" ? "" : "opacity-0"}`}
                />
              </>
            )}
          </View>
          <View className="gap-1">
            <Text className="font-sans text-xs text-ink-3">
              {asset.author
                ? t`License: ${ph({ license: asset.license })}, ${ph({ author: asset.author })}`
                : t`License: ${ph({ license: asset.license })}`}
            </Text>
            {asset.attribution ? (
              <Text className="font-sans text-xs text-ink-3">{asset.attribution}</Text>
            ) : null}
            {asset.transformationNotice ? (
              <Text className="font-sans text-xs text-ink-3">{asset.transformationNotice}</Text>
            ) : null}
            {safeHttpUrl(asset.licenseUrl) ? (
              <Text
                onPress={() => void Linking.openURL(safeHttpUrl(asset.licenseUrl)!)}
                accessibilityRole="link"
                className="min-h-11 text-xs font-semibold text-signal"
              >
                <Trans>License details</Trans>
              </Text>
            ) : null}
            {safeHttpUrl(asset.sourceUrl) ? (
              <Text
                onPress={() => void Linking.openURL(safeHttpUrl(asset.sourceUrl)!)}
                accessibilityRole="link"
                className="min-h-11 text-xs font-semibold text-signal"
              >
                <Trans>Image source</Trans>
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {urls.every(({ asset, url }) => !url || states[asset.assetId] === "failed") ? (
        <MuscleGuide muscles={muscles} />
      ) : null}
    </View>
  );
}

export default function ExerciseLibraryScreen() {
  const { t, i18n } = useLingui();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [query, setQuery] = useState("");
  const [muscleExternalId, setMuscleExternalId] = useState("");
  const [equipmentExternalId, setEquipmentExternalId] = useState("");
  const [expandMuscles, setExpandMuscles] = useState(false);
  const [expandEquipment, setExpandEquipment] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"instructions" | "history">("instructions");
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
    setExpandMuscles(false);
    setExpandEquipment(false);
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
  // License names and authors come from the source records (wger).
  const sourceLine = (license: string | null | undefined, author: string | null | undefined) => {
    const licenseText = license ?? t`License not listed`;
    return author ? t`From wger, ${licenseText}, ${author}` : t`From wger, ${licenseText}`;
  };
  const muscleOptions = filters.data?.muscles ?? [];
  const equipmentOptions = filters.data?.equipment ?? [];
  const visibleMuscles = expandMuscles
    ? muscleOptions
    : muscleOptions.filter((option, index) => index < 12 || option.externalId === muscleExternalId);
  const visibleEquipment = expandEquipment
    ? equipmentOptions
    : equipmentOptions.filter(
        (option, index) => index < 12 || option.externalId === equipmentExternalId,
      );
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
          <Text className="font-display text-[30px] font-semibold leading-[36px] text-ink">
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
        <View className="gap-1">
          <Text className="font-display text-[30px] font-semibold leading-[36px] text-ink">
            <Trans>Exercise library</Trans>
          </Text>
          <Text className="font-sans text-sm text-ink-3">
            <Trans>Browse licensed exercises or create one for your workspace.</Trans>
          </Text>
        </View>
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
          {filters.isPending ? (
            <Text className="font-sans text-xs text-ink-3" accessibilityLiveRegion="polite">
              <Trans>Loading muscle and equipment filters…</Trans>
            </Text>
          ) : filters.isError ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-sans flex-1 text-xs text-ink-3" accessibilityRole="alert">
                <Trans>Filters are unavailable; name search still works.</Trans>
              </Text>
              <Button size="sm" variant="secondary" onPress={() => void filters.refetch()}>
                {t`Retry filters`}
              </Button>
            </View>
          ) : (
            <View className="gap-3">
              <View className="gap-2" accessibilityLabel={t`Filter by muscle`}>
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  <Trans>Muscle</Trans>
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <FilterChip
                    disabled={uncertain || isDispatching || scopeChanging}
                    label={t`All muscles`}
                    selected={!muscleExternalId}
                    onPress={() => setMuscleExternalId("")}
                  />
                  {visibleMuscles.map((item) => (
                    <FilterChip
                      key={item.externalId}
                      disabled={uncertain || isDispatching || scopeChanging}
                      label={item.name}
                      selected={muscleExternalId === item.externalId}
                      onPress={() => setMuscleExternalId(item.externalId)}
                    />
                  ))}
                </View>
                {muscleOptions.length === 0 ? (
                  <Text className="font-sans text-xs text-ink-3">
                    <Trans>No muscle filters available.</Trans>
                  </Text>
                ) : muscleOptions.length > 12 ? (
                  <Pressable
                    disabled={uncertain || isDispatching || scopeChanging}
                    onPress={() => setExpandMuscles((value) => !value)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandMuscles }}
                    className="min-h-11 justify-center"
                  >
                    <Text className="font-sans text-sm font-semibold text-signal">
                      {expandMuscles
                        ? t`Show fewer muscles`
                        : t`${plural(muscleOptions.length, { one: "Show # muscle", other: "Show all # muscles" })}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View className="gap-2" accessibilityLabel={t`Filter by equipment`}>
                <Text className="font-sans text-sm font-semibold text-ink-2">
                  <Trans>Equipment</Trans>
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <FilterChip
                    disabled={uncertain || isDispatching || scopeChanging}
                    label={t`All equipment`}
                    selected={!equipmentExternalId}
                    onPress={() => setEquipmentExternalId("")}
                  />
                  {visibleEquipment.map((item) => (
                    <FilterChip
                      key={item.externalId}
                      disabled={uncertain || isDispatching || scopeChanging}
                      label={item.name}
                      selected={equipmentExternalId === item.externalId}
                      onPress={() => setEquipmentExternalId(item.externalId)}
                    />
                  ))}
                </View>
                {equipmentOptions.length === 0 ? (
                  <Text className="font-sans text-xs text-ink-3">
                    <Trans>No equipment filters available.</Trans>
                  </Text>
                ) : equipmentOptions.length > 12 ? (
                  <Pressable
                    disabled={uncertain || isDispatching || scopeChanging}
                    onPress={() => setExpandEquipment((value) => !value)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandEquipment }}
                    className="min-h-11 justify-center"
                  >
                    <Text className="font-sans text-sm font-semibold text-signal">
                      {expandEquipment
                        ? t`Show less equipment`
                        : t`${plural(equipmentOptions.length, { one: "Show # equipment option", other: "Show all # equipment options" })}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {muscleExternalId || equipmentExternalId ? (
                <Pressable
                  disabled={uncertain || isDispatching || scopeChanging}
                  onPress={() => {
                    setMuscleExternalId("");
                    setEquipmentExternalId("");
                  }}
                  accessibilityRole="button"
                  className="min-h-11 justify-center"
                >
                  <Text className="font-sans text-sm font-semibold text-signal">
                    <Trans>Clear filters</Trans>
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
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
            catalog.data.map((item) => (
              <Pressable
                key={item.id}
                disabled={uncertain || isDispatching || scopeChanging}
                onPress={() => setSelectedId(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedId === item.id }}
                className={`min-h-11 justify-center rounded-2xl px-3 py-2 ${selectedId === item.id ? "bg-primary/10" : ""}`}
              >
                <Text className="font-sans font-medium text-ink">{item.name}</Text>
                <Text className="font-sans text-xs text-ink-3">
                  {item.muscles.map((m) => m.name).join(", ") || item.category || t`Exercise`}
                </Text>
                <Text className="font-sans text-xs text-ink-3">
                  {item.source === "wger"
                    ? sourceLine(item.license, item.author)
                    : t`Workspace exercise`}
                </Text>
              </Pressable>
            ))
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
        {selectedId ? (
          <Card variant="secondary" className="gap-3 rounded-3xl p-5">
            <Text className="font-display text-xl font-semibold text-ink">
              <Trans>Details</Trans>
            </Text>
            {detail.isPending ? (
              <Spinner />
            ) : detail.isError || !detail.data ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
                <Trans>Exercise details are unavailable.</Trans>
              </Text>
            ) : (
              <>
                <Text className="font-sans font-medium text-ink">{detail.data.name}</Text>
                <View
                  accessibilityRole="tablist"
                  accessibilityLabel={t`Exercise details`}
                  className="flex-row gap-2"
                >
                  {(["instructions", "history"] as const).map((tab) => (
                    <Pressable
                      key={tab}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: detailTab === tab }}
                      onPress={() => setDetailTab(tab)}
                      className={`min-h-11 justify-center rounded-full border px-3 ${detailTab === tab ? "border-primary bg-primary/10" : "border-rule-2"}`}
                    >
                      <Text className="font-sans text-sm text-ink">
                        {tab === "instructions" ? t`Instructions & media` : t`History`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {detailTab === "history" ? (
                  <WorkoutExerciseHistory exercise={{ exerciseId: detail.data.id }} />
                ) : (
                  <>
                    <View className="flex-row flex-wrap gap-2">
                      {detail.data.muscles.map((muscle) => (
                        <Text
                          key={muscle.externalMuscleId}
                          className="font-sans rounded-full bg-steps-soft px-2.5 py-1 text-xs text-ink"
                        >
                          {muscle.name}
                        </Text>
                      ))}
                      {detail.data.equipment.map((equipment) => (
                        <Text
                          key={equipment.externalEquipmentId}
                          className="font-sans rounded-full bg-steps-soft px-2.5 py-1 text-xs text-ink"
                        >
                          {equipment.name}
                        </Text>
                      ))}
                    </View>
                    <ExerciseMediaGallery
                      key={`${scope}:${detail.data.id}:${JSON.stringify(previewAssets(detail.data.media))}`}
                      exerciseName={detail.data.name}
                      media={detail.data.media}
                      muscles={detail.data.muscles}
                    />
                    <Text className="font-sans text-sm text-ink">
                      {detail.data.instructions || t`No instructions provided.`}
                    </Text>
                    <ExerciseAttribution
                      title={t`Exercise record`}
                      license={detail.data.license}
                      author={detail.data.author}
                      attribution={detail.data.attribution}
                      sourceUrl={detail.data.sourceRecordUrl}
                      licenseUrl={detail.data.licenseUrl}
                    />
                    {detail.data.translationAttribution ? (
                      <TranslationAttribution
                        language={detail.data.language}
                        requestedLanguage={CATALOG_LANGUAGE}
                        attribution={detail.data.translationAttribution}
                      />
                    ) : null}
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
                            disabled={
                              uncertain || isDispatching || scopeChanging || !workout.canEdit
                            }
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
                  </>
                )}
              </>
            )}
          </Card>
        ) : null}
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
      </View>
    </Container>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-full border px-3 ${selected ? "border-primary bg-primary/15" : "border-rule-2 bg-sheet"}`}
    >
      <Text className="font-sans text-sm text-ink">{label}</Text>
    </Pressable>
  );
}
