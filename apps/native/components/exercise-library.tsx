import { offlineScope } from "@openvalens/api/presenters/offline";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Card, Spinner } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Image, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { ExerciseAttribution, TranslationAttribution } from "@/components/exercise-attribution";
import { MuscleGuide } from "@/components/muscle-guide";
import { authClient } from "@/lib/auth-client";
import { ENV } from "@/src/env";
import { orpc } from "@/utils/orpc";

const INPUT = "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";
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
  const assets = previewAssets(media);
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, "loaded" | "failed">>({});
  useEffect(() => {
    if (Platform.OS === "web") setBrowserOrigin(window.location.origin);
  }, []);
  if (assets.length === 0)
    return (
      <View className="gap-3">
        <Text className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {Array.isArray(media) && media.length > 0
            ? "Preview unavailable because image license details are incomplete."
            : "No preview image is provided."}
        </Text>
        <MuscleGuide muscles={muscles} />
      </View>
    );
  if (Platform.OS === "web" && !browserOrigin)
    return (
      <Text
        accessibilityLiveRegion="polite"
        className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
      >
        Preparing preview…
      </Text>
    );
  const urls = assets.map((asset) => ({
    asset,
    url: previewUrl(asset, ENV.EXPO_PUBLIC_SERVER_URL, browserOrigin),
  }));
  return (
    <View className="gap-4" accessibilityLabel={`${exerciseName} previews`}>
      {urls.map(({ asset, url }, index) => (
        <View key={asset.assetId} className="gap-2">
          <View
            className="relative overflow-hidden rounded-lg border border-border bg-muted"
            style={{ aspectRatio: asset.width / asset.height, maxHeight: 320 }}
          >
            {!url ? (
              <View className="flex-1 items-center justify-center p-4">
                <Text className="text-center text-xs text-muted-foreground">
                  Preview unavailable on this connection.
                </Text>
              </View>
            ) : states[asset.assetId] === "failed" ? (
              <View className="flex-1 items-center justify-center p-4">
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-center text-xs text-muted-foreground"
                >
                  Preview unavailable.
                </Text>
              </View>
            ) : (
              <>
                <View className="absolute inset-0 items-center justify-center">
                  <Text accessibilityLiveRegion="polite" className="text-xs text-muted-foreground">
                    {states[asset.assetId] === "loaded" ? "" : "Loading preview…"}
                  </Text>
                </View>
                <Image
                  source={{ uri: url }}
                  accessibilityRole="image"
                  accessibilityLabel={`${exerciseName} preview ${index + 1}`}
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
            <Text className="text-xs text-muted-foreground">
              License: {asset.license}
              {asset.author ? ` · ${asset.author}` : ""}
            </Text>
            {asset.attribution ? (
              <Text className="text-xs text-muted-foreground">{asset.attribution}</Text>
            ) : null}
            {asset.transformationNotice ? (
              <Text className="text-xs text-muted-foreground">{asset.transformationNotice}</Text>
            ) : null}
            {safeHttpUrl(asset.licenseUrl) ? (
              <Text
                onPress={() => void Linking.openURL(safeHttpUrl(asset.licenseUrl)!)}
                accessibilityRole="link"
                className="min-h-11 text-xs text-foreground underline"
              >
                License details
              </Text>
            ) : null}
            {safeHttpUrl(asset.sourceUrl) ? (
              <Text
                onPress={() => void Linking.openURL(safeHttpUrl(asset.sourceUrl)!)}
                accessibilityRole="link"
                className="min-h-11 text-xs text-foreground underline"
              >
                Image source
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {assets.every((asset) => states[asset.assetId] === "failed") ? (
        <MuscleGuide muscles={muscles} />
      ) : null}
    </View>
  );
}

export default function ExerciseLibraryScreen() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [query, setQuery] = useState("");
  const [muscleExternalId, setMuscleExternalId] = useState("");
  const [equipmentExternalId, setEquipmentExternalId] = useState("");
  const [expandMuscles, setExpandMuscles] = useState(false);
  const [expandEquipment, setExpandEquipment] = useState(false);
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
  }, [scope]);
  const params = { query: query.trim() || undefined, language: CATALOG_LANGUAGE, limit: 50 };
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
    enabled: Boolean(scope && selectedId),
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
        setNotice("Could not confirm the result. Refresh and review before trying again.");
        return;
      }
      intentRef.current = null;
      setUncertain(false);
      setRefreshedAfterUncertain(false);
      setNotice(
        intent.operation === "createCustom"
          ? `${result.name} added to this workspace.`
          : `${result.name} added to the workout.`,
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
      setNotice("Could not confirm the result. Refresh and review before trying again.");
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
      setNotice("Secure request IDs are unavailable. No request was sent.");
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
      setNotice("Secure request IDs are unavailable. No request was sent.");
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
        "Library and workouts refreshed. Review them, then retry the same request if needed.",
      );
    }
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
          <Text className="text-2xl font-semibold text-foreground">Exercise library</Text>
          <Text className="text-sm text-muted-foreground">
            Sign in to browse exercises for your workspace.
          </Text>
        </View>
      </Container>
    );

  return (
    <Container>
      <View className="gap-4 p-4">
        <View className="gap-1">
          <Text className="text-2xl font-semibold text-foreground">Exercise library</Text>
          <Text className="text-sm text-muted-foreground">
            Browse licensed exercises or create one for your workspace.
          </Text>
        </View>
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
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
              setNotice("Stopped waiting. The request may still complete on the server.");
            }}
          >
            Cancel request
          </Button>
        ) : null}
        {uncertain ? (
          <Card variant="secondary" className="gap-2 p-3">
            <Text className="text-sm text-foreground">
              Could not confirm. Refresh and review before trying again.
            </Text>
            {!refreshedAfterUncertain ? (
              <Button
                variant="secondary"
                isDisabled={isDispatching}
                onPress={() => void refreshToReconcile()}
              >
                Refresh and review
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
                Retry same request
              </Button>
            )}
          </Card>
        ) : null}
        <Card variant="secondary" className="gap-3 p-4">
          <Text className="text-lg font-medium text-foreground">Browse</Text>
          <TextInput
            editable={!uncertain && !isDispatching && !scopeChanging}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by exercise name"
            accessibilityLabel="Search by exercise name"
            className={INPUT}
            placeholderTextColor="#9ca3af"
          />
          {filters.isPending ? (
            <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">
              Loading muscle and equipment filters…
            </Text>
          ) : filters.isError ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="flex-1 text-xs text-muted-foreground" accessibilityRole="alert">
                Filters are unavailable; name search still works.
              </Text>
              <Button size="sm" variant="secondary" onPress={() => void filters.refetch()}>
                Retry filters
              </Button>
            </View>
          ) : (
            <View className="gap-3">
              <View className="gap-2" accessibilityLabel="Filter by muscle">
                <Text className="text-sm font-medium text-foreground">Muscle</Text>
                <View className="flex-row flex-wrap gap-2">
                  <FilterChip
                    disabled={uncertain || isDispatching || scopeChanging}
                    label="All muscles"
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
                  <Text className="text-xs text-muted-foreground">
                    No muscle filters available.
                  </Text>
                ) : muscleOptions.length > 12 ? (
                  <Pressable
                    disabled={uncertain || isDispatching || scopeChanging}
                    onPress={() => setExpandMuscles((value) => !value)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandMuscles }}
                    className="min-h-11 justify-center"
                  >
                    <Text className="text-sm text-foreground underline">
                      {expandMuscles
                        ? "Show fewer muscles"
                        : `Show all ${muscleOptions.length} muscles`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <View className="gap-2" accessibilityLabel="Filter by equipment">
                <Text className="text-sm font-medium text-foreground">Equipment</Text>
                <View className="flex-row flex-wrap gap-2">
                  <FilterChip
                    disabled={uncertain || isDispatching || scopeChanging}
                    label="All equipment"
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
                  <Text className="text-xs text-muted-foreground">
                    No equipment filters available.
                  </Text>
                ) : equipmentOptions.length > 12 ? (
                  <Pressable
                    disabled={uncertain || isDispatching || scopeChanging}
                    onPress={() => setExpandEquipment((value) => !value)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandEquipment }}
                    className="min-h-11 justify-center"
                  >
                    <Text className="text-sm text-foreground underline">
                      {expandEquipment
                        ? "Show less equipment"
                        : `Show all ${equipmentOptions.length} equipment options`}
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
                  <Text className="text-sm text-foreground underline">Clear filters</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          {!scope ? (
            <Text className="text-sm text-muted-foreground">
              Sign in to browse your workspace library.
            </Text>
          ) : catalog.isPending ? (
            <Spinner />
          ) : catalog.isError ? (
            <View className="gap-2">
              <Text accessibilityRole="alert" className="text-sm text-muted-foreground">
                Could not load exercises.
              </Text>
              <Button variant="secondary" onPress={() => void catalog.refetch()}>
                Try again
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
                className={`min-h-11 justify-center rounded-lg px-3 ${selectedId === item.id ? "bg-accent" : ""}`}
              >
                <Text className="font-medium text-foreground">{item.name}</Text>
                <Text className="text-xs text-muted-foreground">
                  {item.muscles.map((m) => m.name).join(" · ") || item.category || "Exercise"}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {item.source === "wger"
                    ? `From wger · ${item.license ?? "License not listed"}${item.author ? ` · ${item.author}` : ""}`
                    : "Workspace exercise"}
                </Text>
              </Pressable>
            ))
          ) : (
            <View className="gap-1 rounded-lg border border-dashed p-4">
              <Text className="font-medium text-foreground">
                {query.trim() ? "No exercises match this search." : "No exercises found yet"}
              </Text>
              <Text className="text-sm text-muted-foreground">
                {query.trim()
                  ? "Try another name, or clear the search."
                  : "An administrator can import licensed exercises, or you can create a workspace exercise below."}
              </Text>
            </View>
          )}
        </Card>
        {selectedId ? (
          <Card variant="secondary" className="gap-3 p-4">
            <Text className="text-lg font-medium text-foreground">Details</Text>
            {detail.isPending ? (
              <Spinner />
            ) : detail.isError || !detail.data ? (
              <Text accessibilityRole="alert" className="text-sm text-muted-foreground">
                Exercise details are unavailable.
              </Text>
            ) : (
              <>
                <Text className="font-medium text-foreground">{detail.data.name}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {detail.data.muscles.map((muscle) => (
                    <Text
                      key={muscle.externalMuscleId}
                      className="rounded-full border border-border px-2 py-1 text-xs text-foreground"
                    >
                      {muscle.name}
                    </Text>
                  ))}
                  {detail.data.equipment.map((equipment) => (
                    <Text
                      key={equipment.externalEquipmentId}
                      className="rounded-full border border-border px-2 py-1 text-xs text-foreground"
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
                <Text className="text-sm text-foreground">
                  {detail.data.instructions || "No instructions provided."}
                </Text>
                <ExerciseAttribution
                  title="Exercise record"
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
                <Text className="text-sm font-medium text-foreground">Add to workout</Text>
                {workouts.isPending ? (
                  <Spinner />
                ) : workouts.isError ? (
                  <View className="gap-2">
                    <Text accessibilityRole="alert" className="text-sm text-muted-foreground">
                      Could not load workouts.
                    </Text>
                    <Button variant="secondary" onPress={() => void workouts.refetch()}>
                      Retry workouts
                    </Button>
                  </View>
                ) : workouts.data?.length ? (
                  <View className="flex-row flex-wrap gap-2">
                    {workouts.data.map((workout) => (
                      <Pressable
                        key={workout.id}
                        disabled={uncertain || isDispatching || scopeChanging}
                        onPress={() => setWorkoutId(workout.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: workoutId === workout.id }}
                        className={`min-h-11 justify-center rounded-lg border border-border px-3 ${workoutId === workout.id ? "bg-accent" : ""}`}
                      >
                        <Text className="text-sm text-foreground">
                          {workout.date} · {workout.type}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text className="text-sm text-muted-foreground">
                    Create a workout first, then return here to add an exercise.
                  </Text>
                )}
                <Button
                  isDisabled={
                    !workoutId || !selectedId || isDispatching || uncertain || scopeChanging
                  }
                  onPress={startAdd}
                >
                  {isDispatching ? "Adding…" : "Add exercise"}
                </Button>
              </>
            )}
          </Card>
        ) : null}
        <Card variant="secondary" className="gap-3 p-4">
          <Text className="text-lg font-medium text-foreground">Create workspace exercise</Text>
          <Text className="text-xs text-muted-foreground">
            Visible to members of this workspace.
          </Text>
          <Text className="text-sm font-medium text-foreground">Name</Text>
          <TextInput
            editable={!uncertain && !isDispatching && !scopeChanging}
            value={name}
            onChangeText={setName}
            maxLength={200}
            accessibilityLabel="Exercise name"
            className={INPUT}
          />
          <Text className="text-sm font-medium text-foreground">Language code</Text>
          <TextInput
            editable={!uncertain && !isDispatching && !scopeChanging}
            value={language}
            onChangeText={setLanguage}
            maxLength={16}
            accessibilityLabel="Language code"
            className={INPUT}
          />
          <Text className="text-sm font-medium text-foreground">Instructions (optional)</Text>
          <TextInput
            editable={!uncertain && !isDispatching && !scopeChanging}
            value={instructions}
            onChangeText={setInstructions}
            multiline
            maxLength={5000}
            accessibilityLabel="Exercise instructions, optional"
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
            {isDispatching ? "Creating…" : "Create exercise"}
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
      className={`min-h-11 justify-center rounded-full border px-3 ${selected ? "border-primary bg-primary/15" : "border-border bg-card"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}
