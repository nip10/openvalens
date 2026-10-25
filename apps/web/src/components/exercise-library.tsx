import { ph } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { MuscleGuide } from "@/components/muscle-guide";
import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
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

function canonicalTranslationLicenseUrl(license: string | null | undefined): string | null {
  switch (license) {
    case "CC0-1.0":
      return "https://creativecommons.org/publicdomain/zero/1.0/";
    case "CC-BY-SA-3.0":
      return "https://creativecommons.org/licenses/by-sa/3.0/";
    case "CC-BY-SA-4.0":
      return "https://creativecommons.org/licenses/by-sa/4.0/";
    default:
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
  licenseLinkLabel,
}: {
  title: string;
  license?: string | null;
  author?: string | null;
  attribution?: string | null;
  sourceUrl?: string | null;
  licenseUrl?: string | null;
  licenseLinkLabel?: string;
}) {
  const { t } = useLingui();
  const licenseHref = safeHttpUrl(licenseUrl);
  const sourceHref = safeHttpUrl(sourceUrl);
  return (
    <section className="grid gap-1 border-t border-rule pt-3 text-sm text-ink-3" aria-label={title}>
      <h3 className="text-base text-ink">{title}</h3>
      {license ? (
        <p>{author ? t`License: ${license} · ${author}` : t`License: ${license}`}</p>
      ) : (
        <p>
          <Trans>License not listed.</Trans>
        </p>
      )}
      {attribution ? <p className="whitespace-pre-wrap">{attribution}</p> : null}
      <div className="flex flex-wrap gap-x-3">
        {licenseHref ? (
          <a
            className="inline-flex min-h-11 items-center text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
            href={licenseHref}
            target="_blank"
            rel="noreferrer"
          >
            {licenseLinkLabel ?? t`License details`}
          </a>
        ) : null}
        {sourceHref ? (
          <a
            className="inline-flex min-h-11 items-center text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
          >
            <Trans>Source record</Trans>
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
    setBrowserOrigin(window.location.origin);
  }, []);
  if (assets.length === 0)
    return (
      <div className="grid gap-3">
        <p className="bg-paper-2 px-4 py-3 text-sm text-ink-3">
          {Array.isArray(media) && media.length > 0
            ? t`Preview unavailable because image license details are incomplete.`
            : t`No preview image is provided.`}
        </p>
        <MuscleGuide muscles={muscles} />
      </div>
    );
  if (!browserOrigin)
    return (
      <p role="status" className="bg-paper-2 px-4 py-3 text-sm text-ink-3">
        <Trans>Preparing preview…</Trans>
      </p>
    );
  const urls = assets.map((asset) => ({
    asset,
    url: previewUrl(asset, ENV.VITE_SERVER_URL, browserOrigin),
  }));
  return (
    <div className="grid gap-4" aria-label={t`${exerciseName} previews`}>
      {urls.map(({ asset, url }, index) => (
        <figure key={asset.assetId} className="grid gap-2">
          <div
            className="relative overflow-hidden bg-paper-2"
            style={{ aspectRatio: `${asset.width} / ${asset.height}`, maxHeight: "20rem" }}
          >
            {!url || states[asset.assetId] === "failed" ? (
              <div
                role="status"
                className="flex h-full items-center justify-center p-4 text-center text-sm text-ink-3"
              >
                {!url ? t`Preview unavailable on this connection.` : t`Preview unavailable.`}
              </div>
            ) : (
              <>
                <div
                  role="status"
                  className={`absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-ink-3 ${states[asset.assetId] === "loaded" ? "sr-only" : ""}`}
                >
                  {states[asset.assetId] === "loaded" ? "" : t`Loading preview…`}
                </div>
                <img
                  src={url ?? undefined}
                  alt={t`${exerciseName} preview ${ph({ number: index + 1 })}`}
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
          <figcaption className="grid gap-1 text-sm text-ink-3">
            <span>
              {asset.author
                ? t`License: ${ph({ license: asset.license })} · ${ph({ author: asset.author })}`
                : t`License: ${ph({ license: asset.license })}`}
            </span>
            {asset.attribution ? <span>{asset.attribution}</span> : null}
            {asset.transformationNotice ? <span>{asset.transformationNotice}</span> : null}
            <span className="flex flex-wrap gap-x-3">
              {safeHttpUrl(asset.licenseUrl) ? (
                <a
                  className="text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
                  href={safeHttpUrl(asset.licenseUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Trans>License details</Trans>
                </a>
              ) : null}
              {safeHttpUrl(asset.sourceUrl) ? (
                <a
                  className="text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
                  href={safeHttpUrl(asset.sourceUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Trans>Image source</Trans>
                </a>
              ) : null}
            </span>
          </figcaption>
        </figure>
      ))}
      {urls.every(({ asset, url }) => !url || states[asset.assetId] === "failed") ? (
        <MuscleGuide muscles={muscles} />
      ) : null}
    </div>
  );
}

export function ExerciseLibraryPage() {
  const { t } = useLingui();
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
    setWorkoutId("");
    setName("");
    setInstructions("");
    setLanguage("en");
    setMuscleExternalId("");
    setEquipmentExternalId("");
    setUncertain(false);
    setRefreshedAfterUncertain(false);
    setNotice("");
    refreshAfterScopeReset((value) => value + 1);
  }, [scope]);
  const filters = useQuery({
    ...orpc.exerciseCatalog.filters.queryOptions({ input: {} }),
    queryKey: [...orpc.exerciseCatalog.filters.queryOptions({ input: {} }).queryKey, { scope }],
    enabled: Boolean(scope),
    placeholderData: undefined,
  });
  const input = useMemo(
    () => ({
      query: scopeChanging ? undefined : query.trim() || undefined,
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
      workoutId: Number(workoutId),
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
  const reconcile = async () => {
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
  const translationTitle = (language: string | null | undefined) =>
    language?.toLowerCase() === "en" && CATALOG_LANGUAGE.toLowerCase() !== "en"
      ? t`Selected translation (English fallback)`
      : language
        ? t`Selected translation (${language})`
        : t`Selected translation`;
  const empty = !catalog.isPending && !catalog.isError && (catalog.data?.length ?? 0) === 0;
  const fieldDisabled = uncertain || isDispatching || scopeChanging;
  const selectClass =
    "h-9 min-w-0 rounded-sm border border-input bg-card px-3 text-sm text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";
  const header = (
    <PageHeader
      title={<Trans>Exercise library</Trans>}
      description={
        <Trans>Browse licensed library entries and exercises created for your workspace.</Trans>
      }
      actions={
        <Link
          to="/workouts"
          className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Trans>Back to workouts</Trans>
        </Link>
      }
    />
  );
  if (sessionPending || scopeChanging)
    return (
      <Page>
        <p role="status" className="text-ink-3">
          <Trans>Loading your workspace…</Trans>
        </p>
      </Page>
    );
  if (!scope)
    return (
      <Page width="narrow">
        <PageHeader title={<Trans>Exercise library</Trans>} />
        <p className="text-ink-2">
          <Trans>Sign in to browse exercises for your workspace.</Trans>
        </p>
      </Page>
    );

  return (
    <Page>
      {header}
      {notice || isDispatching || uncertain ? (
        <div className="grid gap-3">
          {notice ? (
            <p role="status" aria-live="polite" className="text-sm text-ink-2">
              {notice}
            </p>
          ) : null}
          {isDispatching ? (
            <Button
              className="justify-self-start"
              variant="ghost"
              onClick={() => {
                intentRef.current = null;
                dispatchingIntentRef.current = null;
                setIsDispatching(false);
                setUncertain(false);
                setRefreshedAfterUncertain(false);
                setNotice(t`Stopped waiting. The request may still complete on the server.`);
              }}
            >
              <Trans>Cancel request</Trans>
            </Button>
          ) : null}
          {uncertain ? (
            <div className="well flex flex-wrap items-center gap-3 px-4 py-3">
              <p className="flex-1 text-sm text-ink-2">
                <Trans>Could not confirm. Refresh and review before trying again.</Trans>
              </p>
              {!refreshedAfterUncertain ? (
                <Button variant="outline" disabled={isDispatching} onClick={() => void reconcile()}>
                  <Trans>Refresh and review</Trans>
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
                  <Trans>Retry same request</Trans>
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Section title={<Trans>Browse exercises</Trans>}>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="exercise-search" className="text-sm text-ink-3">
                <Trans>Search by name</Trans>
              </Label>
              <Input
                id="exercise-search"
                disabled={fieldDisabled}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t`Search exercises`}
              />
            </div>
            {filters.isPending ? (
              <p role="status" className="text-sm text-ink-3">
                <Trans>Loading muscle and equipment filters…</Trans>
              </p>
            ) : filters.isError ? (
              <div className="flex flex-wrap items-center gap-2" role="alert">
                <p className="text-sm text-ink-3">
                  <Trans>Filters are unavailable; name search still works.</Trans>
                </p>
                <Button size="sm" variant="outline" onClick={() => void filters.refetch()}>
                  <Trans>Retry filters</Trans>
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="muscle-filter" className="text-sm text-ink-3">
                    <Trans>Muscle</Trans>
                  </Label>
                  <select
                    id="muscle-filter"
                    disabled={fieldDisabled}
                    value={muscleExternalId}
                    onChange={(event) => setMuscleExternalId(event.target.value)}
                    className={selectClass}
                  >
                    <option value="">{t`All muscles`}</option>
                    {filters.data?.muscles.map((muscle) => (
                      <option key={muscle.externalId} value={muscle.externalId}>
                        {muscle.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="equipment-filter" className="text-sm text-ink-3">
                    <Trans>Equipment</Trans>
                  </Label>
                  <select
                    id="equipment-filter"
                    disabled={fieldDisabled}
                    value={equipmentExternalId}
                    onChange={(event) => setEquipmentExternalId(event.target.value)}
                    className={selectClass}
                  >
                    <option value="">{t`All equipment`}</option>
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
                    disabled={fieldDisabled}
                    onClick={() => {
                      setMuscleExternalId("");
                      setEquipmentExternalId("");
                    }}
                  >
                    <Trans>Clear filters</Trans>
                  </Button>
                ) : null}
              </div>
            )}
            {catalog.isPending ? (
              <p role="status" className="border-t border-rule py-4 text-sm text-ink-3">
                <Trans>Loading library…</Trans>
              </p>
            ) : catalog.isError ? (
              <ErrorState
                title={<Trans>Could not load the exercise library.</Trans>}
                action={
                  <Button variant="outline" onClick={() => void catalog.refetch()}>
                    <Trans>Try again</Trans>
                  </Button>
                }
              />
            ) : empty ? (
              query.trim() ? (
                <EmptyState
                  title={<Trans>No exercises match this search. Try another name.</Trans>}
                />
              ) : (
                <EmptyState
                  title={<Trans>The library is empty for now.</Trans>}
                  description={
                    <Trans>
                      An administrator can import licensed exercises, or create a workspace exercise
                      here.
                    </Trans>
                  }
                />
              )
            ) : (
              <ul
                className="sheet max-h-[32rem] divide-y divide-rule overflow-y-auto"
                aria-label={t`Exercises`}
              >
                {catalog.data?.map((exercise) => (
                  <li key={exercise.id}>
                    <button
                      type="button"
                      disabled={fieldDisabled}
                      onClick={() => setSelectedId(exercise.id)}
                      aria-pressed={selectedId === exercise.id}
                      className={`w-full px-4 py-3 text-left transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 ${selectedId === exercise.id ? "bg-paper-2" : ""}`}
                    >
                      <span className="font-display font-medium text-ink">{exercise.name}</span>
                      <span className="mt-1 block text-sm text-ink-3">
                        {exercise.muscles.map((m) => m.name).join(", ") ||
                          exercise.category ||
                          t`Exercise`}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-3">
                        {exercise.source === "wger"
                          ? sourceLine(exercise.license, exercise.author)
                          : t`Workspace exercise`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
        <div className="grid gap-10">
          <Section title={<Trans>Exercise details</Trans>}>
            <div className="sheet grid gap-4 px-5 pt-4 pb-5">
              {!selectedId ? (
                <p className="text-ink-3">
                  <Trans>Choose an exercise to read its details.</Trans>
                </p>
              ) : detail.isPending ? (
                <p role="status" className="text-ink-3">
                  <Trans>Loading details…</Trans>
                </p>
              ) : detail.isError || !detail.data ? (
                <p role="alert" className="text-ink-2">
                  <Trans>Details are unavailable. Refresh the library and try again.</Trans>
                </p>
              ) : (
                <>
                  <h3 className="text-lg text-ink">{detail.data.name}</h3>
                  {detail.data.muscles.length > 0 || detail.data.equipment.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {detail.data.muscles.map((muscle) => (
                        <span
                          key={muscle.externalMuscleId}
                          className="rounded-sm border border-rule px-2 py-0.5 text-sm text-ink-2"
                        >
                          {muscle.name}
                        </span>
                      ))}
                      {detail.data.equipment.map((equipment) => (
                        <span
                          key={equipment.externalEquipmentId}
                          className="rounded-sm border border-rule px-2 py-0.5 text-sm text-ink-2"
                        >
                          {equipment.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <ExerciseMediaGallery
                    key={`${scope}:${detail.data.id}:${JSON.stringify(previewAssets(detail.data.media))}`}
                    exerciseName={detail.data.name}
                    media={detail.data.media}
                    muscles={detail.data.muscles}
                  />
                  {detail.data.instructions ? (
                    <p className="max-w-[65ch] whitespace-pre-wrap text-ink-2">
                      {detail.data.instructions}
                    </p>
                  ) : (
                    <p className="text-ink-3">
                      <Trans>No instructions provided.</Trans>
                    </p>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Attribution
                      title={t`Exercise record`}
                      license={detail.data.license}
                      author={detail.data.author}
                      attribution={detail.data.attribution}
                      sourceUrl={detail.data.sourceRecordUrl}
                      licenseUrl={detail.data.licenseUrl}
                    />
                    {detail.data.translationAttribution ? (
                      <Attribution
                        title={translationTitle(detail.data.language)}
                        license={detail.data.translationAttribution.license}
                        author={detail.data.translationAttribution.author}
                        attribution={detail.data.translationAttribution.rawAttribution}
                        sourceUrl={detail.data.translationAttribution.sourceUrl}
                        licenseUrl={canonicalTranslationLicenseUrl(
                          detail.data.translationAttribution.license,
                        )}
                        licenseLinkLabel={t`Selected translation license details`}
                      />
                    ) : null}
                  </div>
                  <div className="grid gap-2 border-t border-rule pt-4">
                    <Label htmlFor="target-workout" className="text-sm text-ink-3">
                      <Trans>Add to workout</Trans>
                    </Label>
                    {workouts.isPending ? (
                      <p role="status" className="text-sm text-ink-3">
                        <Trans>Loading workouts…</Trans>
                      </p>
                    ) : workouts.isError ? (
                      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-ink-2">
                          <Trans>Could not load workouts.</Trans>
                        </span>
                        <Button size="sm" variant="outline" onClick={() => void workouts.refetch()}>
                          <Trans>Retry</Trans>
                        </Button>
                      </div>
                    ) : !workouts.data?.length ? (
                      <p className="text-sm text-ink-3">
                        <Trans>Create a workout first, then return here to add an exercise.</Trans>
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        id="target-workout"
                        disabled={
                          fieldDisabled ||
                          workouts.isPending ||
                          workouts.isError ||
                          !workouts.data?.length
                        }
                        value={workoutId}
                        onChange={(event) => setWorkoutId(event.target.value)}
                        className={`${selectClass} flex-1`}
                      >
                        <option value="">{t`Choose a workout`}</option>
                        {workouts.data?.map((workout) => (
                          <option key={workout.id} value={workout.id}>
                            {workout.date}, {workout.type}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={
                          !workoutId || !selectedId || isDispatching || uncertain || scopeChanging
                        }
                        onClick={startAdd}
                      >
                        {isDispatching ? t`Adding…` : t`Add exercise`}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Section>
          <Section
            title={<Trans>Create workspace exercise</Trans>}
            description={<Trans>Visible to members of this workspace.</Trans>}
          >
            <div className="well grid gap-4 px-5 pt-4 pb-5">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="grid gap-1.5">
                  <Label htmlFor="custom-exercise-name" className="text-sm text-ink-3">
                    <Trans>Name</Trans>
                  </Label>
                  <Input
                    id="custom-exercise-name"
                    disabled={fieldDisabled}
                    value={name}
                    maxLength={200}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="custom-exercise-language" className="text-sm text-ink-3">
                    <Trans>Language code</Trans>
                  </Label>
                  <Input
                    id="custom-exercise-language"
                    disabled={fieldDisabled}
                    value={language}
                    maxLength={16}
                    onChange={(event) => setLanguage(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="custom-exercise-instructions" className="text-sm text-ink-3">
                  <Trans>Instructions (optional)</Trans>
                </Label>
                <Textarea
                  id="custom-exercise-instructions"
                  disabled={fieldDisabled}
                  value={instructions}
                  maxLength={5000}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>
              <Button
                className="justify-self-start"
                variant="outline"
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
                {isDispatching ? t`Creating…` : t`Create exercise`}
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </Page>
  );
}
