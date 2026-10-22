import { offlineScope } from "@openvalens/api/presenters/offline";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { ENV } from "@/env";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

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
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID !== "function") return null;
    const value = randomUUID.call(globalThis.crypto);
    return UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

function isPreviewAsset(value: unknown): value is PreviewAsset {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.assetId !== "string" || !ASSET_ID.test(item.assetId)) return false;
  if (item.path !== `/api/exercise-assets/${item.assetId}`) return false;
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
  if (!Array.isArray(value)) return [];
  return value.filter(isPreviewAsset).slice(0, 4);
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

function Attribution({
  title,
  license,
  author,
  attribution,
  sourceUrl,
  licenseUrl,
}: {
  title: string;
  license?: string | null;
  author?: string | null;
  attribution?: string | null;
  sourceUrl?: string | null;
  licenseUrl?: string | null;
}) {
  const licenseHref = safeHttpUrl(licenseUrl);
  const sourceHref = safeHttpUrl(sourceUrl);
  return (
    <section
      className="grid gap-1 rounded-md border p-3 text-xs text-muted-foreground"
      aria-label={title}
    >
      <h3 className="font-medium text-foreground">{title}</h3>
      {license ? (
        <p>
          License: {license}
          {author ? ` · ${author}` : ""}
        </p>
      ) : (
        <p>License not listed.</p>
      )}
      {attribution ? <p className="whitespace-pre-wrap">{attribution}</p> : null}
      <div className="flex flex-wrap gap-x-3">
        {licenseHref ? (
          <a
            className="min-h-11 inline-flex items-center underline"
            href={licenseHref}
            target="_blank"
            rel="noreferrer"
          >
            License details
          </a>
        ) : null}
        {sourceHref ? (
          <a
            className="min-h-11 inline-flex items-center underline"
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
          >
            Source record
          </a>
        ) : null}
      </div>
    </section>
  );
}

function previewUrl(
  asset: PreviewAsset,
  apiBase: string,
  browserOrigin: string | null,
): string | null {
  if (!ASSET_ID.test(asset.assetId) || asset.path !== `/api/exercise-assets/${asset.assetId}`)
    return null;
  if (!browserOrigin) return null;
  try {
    const api = new URL(apiBase);
    const page = new URL(browserOrigin);
    if (
      (api.protocol !== "http:" && api.protocol !== "https:") ||
      api.username ||
      api.password ||
      api.search ||
      api.hash
    )
      return null;
    if (api.origin !== page.origin) return null;
    return `${api.origin}/api/exercise-assets/${asset.assetId}`;
  } catch {
    return null;
  }
}

function ExerciseMediaGallery({ exerciseName, media }: { exerciseName: string; media: unknown }) {
  const assets = previewAssets(media);
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, "loaded" | "failed">>({});
  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);
  if (assets.length === 0)
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
        {Array.isArray(media) && media.length > 0
          ? "Preview unavailable because image license details are incomplete."
          : "No preview image is provided."}
      </p>
    );
  if (!browserOrigin)
    return (
      <p
        role="status"
        className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground"
      >
        Preparing preview…
      </p>
    );
  const urls = assets.map((asset) => ({
    asset,
    url: previewUrl(asset, ENV.VITE_SERVER_URL, browserOrigin),
  }));
  if (urls.some(({ url }) => url === null))
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
        Preview unavailable on this connection.
      </p>
    );
  return (
    <div className="grid gap-4" aria-label={`${exerciseName} previews`}>
      {urls.map(({ asset, url }, index) => (
        <figure key={asset.assetId} className="grid gap-2">
          <div
            className="relative overflow-hidden rounded-lg border bg-muted"
            style={{ aspectRatio: `${asset.width} / ${asset.height}`, maxHeight: "20rem" }}
          >
            {states[asset.assetId] === "failed" ? (
              <div
                role="status"
                className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
              >
                Preview unavailable.
              </div>
            ) : (
              <>
                <div
                  role="status"
                  className={`absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground ${states[asset.assetId] === "loaded" ? "sr-only" : ""}`}
                >
                  {states[asset.assetId] === "loaded" ? "" : "Loading preview…"}
                </div>
                <img
                  src={url ?? undefined}
                  alt={`${exerciseName} preview ${index + 1}`}
                  width={asset.width}
                  height={asset.height}
                  loading="lazy"
                  decoding="async"
                  className={`h-full w-full object-contain ${states[asset.assetId] === "loaded" ? "" : "opacity-0"}`}
                  onLoad={() => setStates((current) => ({ ...current, [asset.assetId]: "loaded" }))}
                  onError={() =>
                    setStates((current) => ({ ...current, [asset.assetId]: "failed" }))
                  }
                />
              </>
            )}
          </div>
          <figcaption className="grid gap-1 text-xs text-muted-foreground">
            <span>
              License: {asset.license}
              {asset.author ? ` · ${asset.author}` : ""}
            </span>
            {asset.attribution ? <span>{asset.attribution}</span> : null}
            {asset.transformationNotice ? <span>{asset.transformationNotice}</span> : null}
            <span className="flex flex-wrap gap-x-3">
              {safeHttpUrl(asset.licenseUrl) ? (
                <a
                  className="underline"
                  href={safeHttpUrl(asset.licenseUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  License details
                </a>
              ) : null}
              {safeHttpUrl(asset.sourceUrl) ? (
                <a
                  className="underline"
                  href={safeHttpUrl(asset.sourceUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Image source
                </a>
              ) : null}
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function ExerciseLibraryPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [query, setQuery] = useState("");
  const [muscleExternalId, setMuscleExternalId] = useState("");
  const [equipmentExternalId, setEquipmentExternalId] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [workoutId, setWorkoutId] = useState("");
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
    setWorkoutId("");
    setName("");
    setInstructions("");
    setLanguage("en");
    setMuscleExternalId("");
    setEquipmentExternalId("");
    setUncertain(false);
    setRefreshedAfterUncertain(false);
    setNotice("");
  }, [scope]);
  const filters = useQuery({
    ...orpc.exerciseCatalog.filters.queryOptions({ input: {} }),
    queryKey: [...orpc.exerciseCatalog.filters.queryOptions({ input: {} }).queryKey, { scope }],
    enabled: Boolean(scope),
    placeholderData: undefined,
  });
  const input = useMemo(
    () => ({
      query: query.trim() || undefined,
      language: CATALOG_LANGUAGE,
      muscleExternalId: scopeChanging ? undefined : muscleExternalId || undefined,
      equipmentExternalId: scopeChanging ? undefined : equipmentExternalId || undefined,
      limit: 50,
    }),
    [query, muscleExternalId, equipmentExternalId, scopeChanging],
  );
  const catalog = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({ input }),
    queryKey: [...orpc.exerciseCatalog.search.queryOptions({ input }).queryKey, { scope }],
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
    const payload = { workoutId: Number(workoutId), exerciseId: selectedId, language: "en" };
    const clientMutationId = secureClientMutationId();
    if (!clientMutationId) {
      setNotice("Secure request IDs are unavailable. No request was sent.");
      return;
    }
    const intent: CatalogIntent = { scope, operation: "addFromLibrary", payload, clientMutationId };
    intentRef.current = intent;
    void dispatchIntent(intent);
  };
  const reconcile = async () => {
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
  const empty = !catalog.isPending && !catalog.isError && (catalog.data?.length ?? 0) === 0;
  if (sessionPending || scopeChanging)
    return (
      <main className="container mx-auto max-w-4xl px-4 py-6">
        <p role="status">Loading your workspace…</p>
      </main>
    );
  if (!scope)
    return (
      <main className="container mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Exercise library</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to browse exercises for your workspace.
        </p>
      </main>
    );

  return (
    <main className="container mx-auto grid max-w-4xl gap-5 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Exercise library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse licensed library entries and exercises created for your workspace.
          </p>
        </div>
        <Link to="/workouts" className="text-sm underline">
          Back to workouts
        </Link>
      </header>
      {notice ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {isDispatching ? (
        <Button
          variant="ghost"
          onClick={() => {
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
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <p className="flex-1 text-sm">
            Could not confirm. Refresh and review before trying again.
          </p>
          {!refreshedAfterUncertain ? (
            <Button variant="outline" disabled={isDispatching} onClick={() => void reconcile()}>
              Refresh and review
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={isDispatching}
              onClick={() => {
                const intent = intentRef.current;
                if (intent) void dispatchIntent(intent);
              }}
            >
              Retry same request
            </Button>
          )}
        </div>
      ) : null}
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Browse exercises</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Label htmlFor="exercise-search">Search by name</Label>
            <Input
              id="exercise-search"
              disabled={uncertain || isDispatching || scopeChanging}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search exercises"
            />
            {filters.isPending ? (
              <p role="status" className="text-xs text-muted-foreground">
                Loading muscle and equipment filters…
              </p>
            ) : filters.isError ? (
              <div className="flex flex-wrap items-center gap-2" role="alert">
                <p className="text-xs text-muted-foreground">
                  Filters are unavailable; name search still works.
                </p>
                <Button size="sm" variant="outline" onClick={() => void filters.refetch()}>
                  Retry filters
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="muscle-filter">Muscle</Label>
                  <select
                    id="muscle-filter"
                    disabled={uncertain || isDispatching || scopeChanging}
                    value={muscleExternalId}
                    onChange={(event) => setMuscleExternalId(event.target.value)}
                    className="h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">All muscles</option>
                    {filters.data?.muscles.map((muscle) => (
                      <option key={muscle.externalId} value={muscle.externalId}>
                        {muscle.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="equipment-filter">Equipment</Label>
                  <select
                    id="equipment-filter"
                    disabled={uncertain || isDispatching || scopeChanging}
                    value={equipmentExternalId}
                    onChange={(event) => setEquipmentExternalId(event.target.value)}
                    className="h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">All equipment</option>
                    {filters.data?.equipment.map((equipment) => (
                      <option key={equipment.externalId} value={equipment.externalId}>
                        {equipment.name}
                      </option>
                    ))}
                  </select>
                </div>
                {muscleExternalId || equipmentExternalId ? (
                  <Button
                    className="sm:col-span-2 sm:justify-self-start"
                    variant="ghost"
                    disabled={uncertain || isDispatching || scopeChanging}
                    onClick={() => {
                      setMuscleExternalId("");
                      setEquipmentExternalId("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            )}
            {!scope ? (
              <p className="text-sm text-muted-foreground">
                Sign in to browse exercises for your workspace.
              </p>
            ) : catalog.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading library…
              </p>
            ) : catalog.isError ? (
              <div role="alert" className="grid gap-2 text-sm">
                <p>Could not load the exercise library.</p>
                <Button variant="outline" onClick={() => void catalog.refetch()}>
                  Try again
                </Button>
              </div>
            ) : empty ? (
              query.trim() ? (
                <p className="text-sm text-muted-foreground">
                  No exercises match this search. Try another name.
                </p>
              ) : (
                <div className="grid gap-2 rounded-lg border border-dashed p-5">
                  <p className="font-medium">The library is empty for now.</p>
                  <p className="text-sm text-muted-foreground">
                    An administrator can import licensed exercises, or create a workspace exercise
                    here.
                  </p>
                </div>
              )
            ) : (
              <ul
                className="max-h-[32rem] divide-y overflow-y-auto rounded-md border"
                aria-label="Exercises"
              >
                {catalog.data?.map((exercise) => (
                  <li key={exercise.id}>
                    <button
                      type="button"
                      disabled={uncertain || isDispatching || scopeChanging}
                      onClick={() => setSelectedId(exercise.id)}
                      aria-pressed={selectedId === exercise.id}
                      className={`w-full px-3 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === exercise.id ? "bg-accent" : ""}`}
                    >
                      <span className="font-medium">{exercise.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {exercise.muscles.map((m) => m.name).join(" · ") ||
                          exercise.category ||
                          "Exercise"}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {exercise.source === "wger"
                          ? `From wger · ${exercise.license ?? "License not listed"}${exercise.author ? ` · ${exercise.author}` : ""}`
                          : "Workspace exercise"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Exercise details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!selectedId ? (
                <p className="text-sm text-muted-foreground">
                  Choose an exercise to read its details.
                </p>
              ) : detail.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading details…
                </p>
              ) : detail.isError || !detail.data ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  Details are unavailable. Refresh the library and try again.
                </p>
              ) : (
                <>
                  <h2 className="font-medium">{detail.data.name}</h2>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.muscles.map((muscle) => (
                      <span
                        key={muscle.externalMuscleId}
                        className="rounded-full border px-2 py-1 text-xs"
                      >
                        {muscle.name}
                      </span>
                    ))}
                    {detail.data.equipment.map((equipment) => (
                      <span
                        key={equipment.externalEquipmentId}
                        className="rounded-full border px-2 py-1 text-xs"
                      >
                        {equipment.name}
                      </span>
                    ))}
                  </div>
                  <ExerciseMediaGallery
                    key={`${scope}:${detail.data.id}:${JSON.stringify(previewAssets(detail.data.media))}`}
                    exerciseName={detail.data.name}
                    media={detail.data.media}
                  />
                  {detail.data.instructions ? (
                    <p className="whitespace-pre-wrap text-sm">{detail.data.instructions}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No instructions provided.</p>
                  )}
                  <Attribution
                    title="Exercise record"
                    license={detail.data.license}
                    author={detail.data.author}
                    attribution={detail.data.attribution}
                    sourceUrl={detail.data.sourceRecordUrl}
                    licenseUrl={detail.data.licenseUrl}
                  />
                  {detail.data.translationAttribution ? (
                    <Attribution
                      title={`Selected translation${detail.data.language?.toLowerCase() === "en" && CATALOG_LANGUAGE.toLowerCase() !== "en" ? " (English fallback)" : detail.data.language ? ` (${detail.data.language})` : ""}`}
                      license={detail.data.translationAttribution.license}
                      author={detail.data.translationAttribution.author}
                      attribution={detail.data.translationAttribution.rawAttribution}
                      sourceUrl={detail.data.translationAttribution.sourceUrl}
                    />
                  ) : null}
                  <div className="grid gap-2">
                    <Label htmlFor="target-workout">Add to workout</Label>
                    {workouts.isPending ? (
                      <p role="status" className="text-sm text-muted-foreground">
                        Loading workouts…
                      </p>
                    ) : workouts.isError ? (
                      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                        <span>Could not load workouts.</span>
                        <Button size="sm" variant="outline" onClick={() => void workouts.refetch()}>
                          Retry
                        </Button>
                      </div>
                    ) : !workouts.data?.length ? (
                      <p className="text-sm text-muted-foreground">
                        Create a workout first, then return here to add an exercise.
                      </p>
                    ) : null}
                    <select
                      id="target-workout"
                      disabled={
                        uncertain ||
                        isDispatching ||
                        scopeChanging ||
                        workouts.isPending ||
                        workouts.isError ||
                        !workouts.data?.length
                      }
                      value={workoutId}
                      onChange={(event) => setWorkoutId(event.target.value)}
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="">Choose a workout</option>
                      {workouts.data?.map((workout) => (
                        <option key={workout.id} value={workout.id}>
                          {workout.date} · {workout.type}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={
                        !workoutId || !selectedId || isDispatching || uncertain || scopeChanging
                      }
                      onClick={startAdd}
                    >
                      {isDispatching ? "Adding…" : "Add exercise"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Create workspace exercise</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-xs text-muted-foreground">Visible to members of this workspace.</p>
              <Label htmlFor="custom-exercise-name">Name</Label>
              <Input
                id="custom-exercise-name"
                disabled={uncertain || isDispatching || scopeChanging}
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
              <Label htmlFor="custom-exercise-language">Language code</Label>
              <Input
                id="custom-exercise-language"
                disabled={uncertain || isDispatching || scopeChanging}
                value={language}
                maxLength={16}
                onChange={(event) => setLanguage(event.target.value)}
              />
              <Label htmlFor="custom-exercise-instructions">Instructions (optional)</Label>
              <Textarea
                id="custom-exercise-instructions"
                disabled={uncertain || isDispatching || scopeChanging}
                value={instructions}
                maxLength={5000}
                onChange={(event) => setInstructions(event.target.value)}
              />
              <Button
                disabled={
                  !scope ||
                  !name.trim() ||
                  language.trim().length < 2 ||
                  isDispatching ||
                  uncertain ||
                  scopeChanging
                }
                onClick={startCreate}
              >
                {isDispatching ? "Creating…" : "Create exercise"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
