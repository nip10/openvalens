import type {
  Declaration,
  EnergyDirection,
  NutritionTargetWire,
  TargetSettingsWire,
} from "@openvalens/api/contracts/nutrition-targets";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { CUSTOM_FOOD_COPY } from "@openvalens/api/presenters/custom-foods";
import {
  DIARY_COPY,
  NUTRIENT_LABELS,
  deviceTimeZone,
  localDateIn,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  DIRECTION_LABELS,
  NUTRITION_SAFETY_COPY,
  TARGET_COPY,
  TARGET_NUTRIENTS,
  declarationChoices,
  declarationsChange,
  describeTargetSource,
  formatHelpline,
  formatProteinReference,
  formatTarget,
  parseHeight,
  parseTargetForm,
  resolveScopedHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import { STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { FOOD_DRAFT_COPY, PHOTO_DRAFT_COPY } from "@openvalens/api/presenters/food-draft";
import { RECIPE_IMPORT_COPY } from "@openvalens/api/presenters/recipe-draft";
import {
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_POPULATIONS,
} from "@openvalens/api/presenters/micronutrients";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { EnergyEstimateCard } from "@/components/energy-estimate-card";

/**
 * Nutrition targets and display settings (Issue #80), reached from the meal
 * diary. Targets are the member's own: entered here or accepted from a #76
 * suggestion, never set by the app. Copy is neutral — targets are shown
 * separately from what was logged, with no verdicts — and hide-numbers mode
 * hides every number while logging keeps working.
 */
export const Route = createFileRoute("/_auth/nutrition-targets")({
  component: NutritionTargetsPage,
});

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

function networkFailure(retry: () => void, i18n: I18n) {
  toast.error(i18n._(TARGET_COPY.networkError), {
    action: { label: i18n._(DIARY_COPY.retry), onClick: retry },
  });
}

function NutritionTargetsPage() {
  const localDate = useMemo(() => localDateIn(deviceTimeZone()), []);
  const { data: session } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const queryClient = useQueryClient();
  const { i18n } = useLingui();
  const overviewOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const overviewKey = [...overviewOptions.queryKey, { offlineScope: scope }];
  const overview = useQuery({
    ...overviewOptions,
    queryKey: overviewKey,
    enabled: Boolean(scope),
  });
  const [hideOverride, setHideOverride] = useState<{ scope: string; value: boolean } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() });

  const data = overview.data;
  const hideNumbers = resolveScopedHideNumbers(
    scope,
    hideOverride,
    overview.isSuccess ? data?.settings.hideNumbers : undefined,
  );

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{i18n._(TARGET_COPY.title)}</h1>
          <Link to="/nutrition" className="text-sm underline">
            <Trans>Back to meal diary</Trans>
          </Link>
        </div>
      </div>

      {overview.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : overview.isError || !data ? (
        <p className="text-sm text-muted-foreground" role="alert">
          {i18n._(TARGET_COPY.networkError)}{" "}
          <button className="underline" onClick={() => void overview.refetch()}>
            {i18n._(DIARY_COPY.retry)}
          </button>
        </p>
      ) : (
        <>
          {data.support ? (
            <Card role="note" aria-label={i18n._(TARGET_COPY.helplinesTitle)}>
              <CardContent className="grid gap-2 pt-6 text-sm">
                <p>{data.support.text}</p>
                <ul className="grid gap-1">
                  {data.support.helplines.map((line) => (
                    <li key={line.name}>
                      {line.phone ? (
                        <a className="underline" href={`tel:${line.phone.replace(/[^+\d]/g, "")}`}>
                          {formatHelpline(line)}
                        </a>
                      ) : (
                        <a className="underline" href={line.url} target="_blank" rel="noreferrer">
                          {formatHelpline(line)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {data.notes.length > 0 ? (
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <TargetsCard
            targets={data.targets}
            hideNumbers={hideNumbers}
            energyOff={data.safety.energyTargets === "off"}
            onChanged={() => void refresh()}
          />

          <EnergyEstimateCard
            key={scope ?? "no-scope"}
            hideNumbers={!overview.isSuccess || hideNumbers}
            scope={scope}
            targetsQueryKey={overviewKey}
          />

          <SettingsCard
            settings={data.settings}
            onHideNumbersChange={(value) => {
              if (scope) setHideOverride({ scope, value });
            }}
            onChanged={() => void refresh()}
          />

          <Card>
            <CardHeader>
              <CardTitle>{i18n._(TARGET_COPY.proteinReferenceTitle)}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="font-mono">
                {data.proteinReference
                  ? formatProteinReference(data.proteinReference, hideNumbers, i18n)
                  : i18n._(TARGET_COPY.proteinReferenceUnavailable)}
              </p>
              <p className="text-xs text-muted-foreground">
                {i18n._(TARGET_COPY.proteinReferenceNote)}
              </p>
              <p className="text-xs text-muted-foreground">{data.safety.policyVersion}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function TargetsCard({
  targets,
  hideNumbers,
  energyOff,
  onChanged,
}: {
  targets: NutritionTargetWire[];
  hideNumbers: boolean;
  energyOff: boolean;
  onChanged: () => void;
}) {
  const choices = TARGET_NUTRIENTS.filter(
    (key) => !(energyOff && (key === "energyKcal" || key === "energyKj")),
  );
  const [nutrient, setNutrient] = useState(choices[0]!);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => localDateIn(deviceTimeZone()));
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const setTarget = useMutation(orpc.nutritionTargets.setTarget.mutationOptions());
  const clearTarget = useMutation(orpc.nutritionTargets.clearTarget.mutationOptions());
  const { t, i18n } = useLingui();

  const activeForSelected = targets.find((target) => target.nutrient === nutrient);

  const save = () => {
    const parsed = parseTargetForm(nutrient, { min, max, effectiveFrom });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const send = () =>
      setTarget.mutate(parsed.input, {
        onSuccess: () => {
          toast.success(i18n._(TARGET_COPY.saved));
          setMin("");
          setMax("");
          onChanged();
        },
        onError: () => networkFailure(send, i18n),
      });
    send();
  };

  const clear = (target: NutritionTargetWire) => {
    const input = { nutrient: target.nutrient, effectiveTo: localDateIn(deviceTimeZone()) };
    const send = () =>
      clearTarget.mutate(input, {
        onSuccess: () => {
          toast.success(i18n._(TARGET_COPY.cleared));
          onChanged();
        },
        onError: () => networkFailure(send, i18n),
      });
    send();
  };

  return (
    <Card>
      <CardHeader className="grid gap-1">
        <CardTitle>{i18n._(TARGET_COPY.yourTargets)}</CardTitle>
        <p className="text-sm text-muted-foreground">{i18n._(TARGET_COPY.targetsNote)}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{i18n._(TARGET_COPY.noTargets)}</p>
        ) : (
          <ul className="grid gap-2" aria-label={i18n._(TARGET_COPY.yourTargets)}>
            {targets.map((target) => (
              <li
                key={target.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="grid">
                  <span className="text-sm font-medium">
                    {i18n._(NUTRIENT_LABELS[target.nutrient].label)}:{" "}
                    {formatTarget(target, hideNumbers, i18n)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i18n._(describeTargetSource(target))}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => clear(target)}
                  disabled={clearTarget.isPending}
                >
                  {i18n._(TARGET_COPY.clearTarget)}{" "}
                  <span className="sr-only">{i18n._(NUTRIENT_LABELS[target.nutrient].label)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-4 sm:items-end">
          <legend className="px-1 text-sm font-medium">{i18n._(TARGET_COPY.setTarget)}</legend>
          <Field label={t`Nutrient`}>
            {(id) => (
              <select
                id={id}
                className={selectClass}
                value={nutrient}
                onChange={(event) => setNutrient(event.target.value as typeof nutrient)}
              >
                {choices.map((key) => (
                  <option key={key} value={key}>
                    {i18n._(NUTRIENT_LABELS[key].label)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={i18n._(TARGET_COPY.minimum)}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={hideNumbers ? "" : min}
                aria-label={
                  hideNumbers ? t`Minimum (optional) (hidden)` : i18n._(TARGET_COPY.minimum)
                }
                placeholder={
                  hideNumbers
                    ? ""
                    : activeForSelected && activeForSelected.minAmount !== null
                      ? String(activeForSelected.minAmount)
                      : ""
                }
                onChange={(event) => setMin(event.target.value)}
              />
            )}
          </Field>
          <Field label={i18n._(TARGET_COPY.maximum)}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={hideNumbers ? "" : max}
                aria-label={
                  hideNumbers ? t`Maximum (optional) (hidden)` : i18n._(TARGET_COPY.maximum)
                }
                placeholder={
                  hideNumbers
                    ? ""
                    : activeForSelected && activeForSelected.maxAmount !== null
                      ? String(activeForSelected.maxAmount)
                      : ""
                }
                onChange={(event) => setMax(event.target.value)}
              />
            )}
          </Field>
          <Field label={i18n._(TARGET_COPY.effectiveFrom)}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={effectiveFrom}
                onChange={(event) => event.target.value && setEffectiveFrom(event.target.value)}
              />
            )}
          </Field>
          <div className="sm:col-span-4">
            <Button onClick={save} disabled={setTarget.isPending}>
              {i18n._(setTarget.isPending ? TARGET_COPY.saving : TARGET_COPY.setTarget)}
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-muted-foreground sm:col-span-4" role="alert">
              {i18n._(error)}
            </p>
          ) : null}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function SettingsCard({
  settings,
  onHideNumbersChange,
  onChanged,
}: {
  settings: TargetSettingsWire;
  onHideNumbersChange: (value: boolean) => void;
  onChanged: () => void;
}) {
  const [hideNumbers, setHideNumbers] = useState(settings.hideNumbers);
  const [direction, setDirection] = useState<EnergyDirection>(settings.energyDirection);
  const [activeProtein, setActiveProtein] = useState(settings.activeProtein);
  const [streaksEnabled, setStreaksEnabled] = useState(settings.streaksEnabled);
  const [recipeImportEnabled, setRecipeImportEnabled] = useState(settings.recipeImportEnabled);
  const [voiceDraftsEnabled, setVoiceDraftsEnabled] = useState(settings.voiceDraftsEnabled);
  const [photoDraftsEnabled, setPhotoDraftsEnabled] = useState(settings.photoDraftsEnabled);
  const [micronutrientsEnabled, setMicronutrientsEnabled] = useState(
    settings.micronutrientsEnabled,
  );
  const [referenceSource, setReferenceSource] = useState(settings.micronutrientReferenceSource);
  const [population, setPopulation] = useState(settings.micronutrientPopulation);
  // Only for the suggestion; the summary itself is on its own page.
  const proposal = useQuery({
    ...orpc.nutritionMicronutrients.summary.queryOptions({
      input: { localDate: new Date().toISOString().slice(0, 10) },
    }),
    select: (data) => data.proposal,
  });
  const [height, setHeight] = useState(settings.heightCm === null ? "" : String(settings.heightCm));
  const [declarations, setDeclarations] = useState<Declaration[]>(settings.declarations);
  const [message, setMessage] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const update = useMutation(orpc.nutritionTargets.updateSettings.mutationOptions());
  const { t, i18n } = useLingui();

  useEffect(() => {
    setHideNumbers(settings.hideNumbers);
    setDirection(settings.energyDirection);
    setActiveProtein(settings.activeProtein);
    setStreaksEnabled(settings.streaksEnabled);
    setRecipeImportEnabled(settings.recipeImportEnabled);
    setVoiceDraftsEnabled(settings.voiceDraftsEnabled);
    setPhotoDraftsEnabled(settings.photoDraftsEnabled);
    setMicronutrientsEnabled(settings.micronutrientsEnabled);
    setReferenceSource(settings.micronutrientReferenceSource);
    setPopulation(settings.micronutrientPopulation);
    setHeight(settings.heightCm === null ? "" : String(settings.heightCm));
    setDeclarations(settings.declarations);
  }, [settings]);

  const choices = declarationChoices(declarations);
  const proposalText = (
    source: keyof typeof MICRONUTRIENT_COPY.sources,
    populationId: keyof typeof MICRONUTRIENT_POPULATIONS | null,
  ) => {
    const sourceName = i18n._(MICRONUTRIENT_COPY.sources[source]);
    if (!populationId) return t`Suggested from your profile: ${sourceName}.`;
    const group = MICRONUTRIENT_POPULATIONS[populationId].label;
    return t`Suggested from your profile: ${sourceName}, ${group}.`;
  };
  const toggleDeclaration = (key: Declaration) => {
    setDeclarations((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
    setNeedsConfirm(false);
  };

  const save = (confirmClearEatingDisorder = false) => {
    const parsedHeight = parseHeight(height);
    if (!parsedHeight.ok) {
      setMessage(i18n._(parsedHeight.error));
      return;
    }
    const change = declarationsChange(settings.declarations, declarations);
    setNeedsConfirm(change.removesEatingDisorder && !confirmClearEatingDisorder);
    const input = {
      expectedRevision: settings.revision,
      hideNumbers,
      energyDirection: direction,
      activeProtein,
      streaksEnabled,
      recipeImportEnabled,
      voiceDraftsEnabled,
      photoDraftsEnabled,
      micronutrientsEnabled,
      micronutrientReferenceSource: referenceSource,
      micronutrientPopulation: population,
      heightCm: parsedHeight.value,
      declarations,
      ...(confirmClearEatingDisorder ? { confirmClearEatingDisorder: true as const } : {}),
    };
    const send = () =>
      update.mutate(input, {
        onSuccess: (result) => {
          if (result.outcome === "conflict") {
            setMessage(i18n._(TARGET_COPY.conflict));
            onChanged();
            return;
          }
          if (result.outcome === "confirmation_required") {
            setMessage(result.note);
            setNeedsConfirm(true);
            return;
          }
          setMessage(i18n._(TARGET_COPY.settingsSaved));
          setNeedsConfirm(false);
          onChanged();
        },
        onError: () => networkFailure(send, i18n),
      });
    send();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{i18n._(TARGET_COPY.settingsLink)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideNumbers}
            onChange={(event) => {
              setHideNumbers(event.target.checked);
              onHideNumbersChange(event.target.checked);
            }}
          />
          <span>
            <span className="font-medium">{i18n._(TARGET_COPY.hideNumbers)}</span>
            <span className="block text-muted-foreground">
              {i18n._(TARGET_COPY.hideNumbersDescription)}
            </span>
          </span>
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{i18n._(TARGET_COPY.directionTitle)}</legend>
          <p className="text-xs text-muted-foreground">
            {i18n._(TARGET_COPY.directionDescription)}
          </p>
          {(Object.keys(DIRECTION_LABELS) as EnergyDirection[]).map((key) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="direction"
                checked={direction === key}
                onChange={() => setDirection(key)}
              />
              <span>
                <span className="font-medium">{i18n._(DIRECTION_LABELS[key].label)}</span>
                <span className="block text-muted-foreground">
                  {i18n._(DIRECTION_LABELS[key].description)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <Field label={i18n._(TARGET_COPY.heightLabel)}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={height}
              aria-describedby={`${id}-help`}
              onChange={(event) => setHeight(event.target.value)}
            />
          )}
        </Field>
        <p className="text-xs text-muted-foreground">{i18n._(TARGET_COPY.heightDescription)}</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeProtein}
            onChange={(event) => setActiveProtein(event.target.checked)}
          />
          {i18n._(TARGET_COPY.activeProtein)}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={streaksEnabled}
            onChange={(event) => setStreaksEnabled(event.target.checked)}
          />
          {i18n._(STREAK_COPY.settingLabel)}
        </label>
        <p className="text-xs text-muted-foreground">{i18n._(STREAK_COPY.settingDescription)}</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={recipeImportEnabled}
            onChange={(event) => setRecipeImportEnabled(event.target.checked)}
          />
          {i18n._(RECIPE_IMPORT_COPY.settingLabel)}
        </label>
        <p className="text-xs text-muted-foreground">
          {i18n._(RECIPE_IMPORT_COPY.settingDescription)}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={voiceDraftsEnabled}
            onChange={(event) => setVoiceDraftsEnabled(event.target.checked)}
          />
          {i18n._(FOOD_DRAFT_COPY.settingLabel)}
        </label>
        <p className="text-xs text-muted-foreground">
          {i18n._(FOOD_DRAFT_COPY.settingDescription)}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={photoDraftsEnabled}
            onChange={(event) => setPhotoDraftsEnabled(event.target.checked)}
          />
          {i18n._(PHOTO_DRAFT_COPY.settingLabel)}
        </label>
        <p className="text-xs text-muted-foreground">
          {i18n._(PHOTO_DRAFT_COPY.settingDescription)}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={micronutrientsEnabled}
            onChange={(event) => setMicronutrientsEnabled(event.target.checked)}
          />
          {i18n._(MICRONUTRIENT_COPY.settingLabel)}
        </label>
        <p className="text-xs text-muted-foreground">
          {i18n._(MICRONUTRIENT_COPY.settingDescription)}
        </p>
        {micronutrientsEnabled ? (
          <fieldset className="grid gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {i18n._(MICRONUTRIENT_COPY.sourceLabel)}
            </legend>
            <p className="text-xs text-muted-foreground">{i18n._(MICRONUTRIENT_COPY.sourceHelp)}</p>
            <div className="flex flex-wrap gap-4">
              <label className="grid gap-1 text-sm">
                <Trans>Source</Trans>
                <select
                  className="min-h-9 rounded-md border bg-background px-2"
                  value={referenceSource ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setReferenceSource(value === "efsa" || value === "nasem" ? value : null);
                    setPopulation(null);
                  }}
                >
                  <option value="">{t`None`}</option>
                  <option value="efsa">{i18n._(MICRONUTRIENT_COPY.sources.efsa)}</option>
                  <option value="nasem">{i18n._(MICRONUTRIENT_COPY.sources.nasem)}</option>
                </select>
              </label>
              {referenceSource ? (
                <label className="grid gap-1 text-sm">
                  <Trans>Group</Trans>
                  <select
                    className="min-h-9 rounded-md border bg-background px-2"
                    value={population ?? ""}
                    onChange={(event) =>
                      setPopulation(
                        (event.target.value ||
                          null) as TargetSettingsWire["micronutrientPopulation"],
                      )
                    }
                  >
                    <option value="">{t`Choose a group`}</option>
                    {Object.entries(MICRONUTRIENT_POPULATIONS)
                      .filter(([, group]) => group.source === referenceSource)
                      .map(([id, group]) => (
                        <option key={id} value={id}>
                          {group.label}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </div>
            {proposal.data?.source &&
            (proposal.data.source !== referenceSource ||
              (proposal.data.population && proposal.data.population !== population)) ? (
              <p className="text-xs">
                {proposalText(proposal.data.source, proposal.data.population)}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setReferenceSource(proposal.data!.source);
                    setPopulation(proposal.data!.population);
                  }}
                >
                  <Trans>Use this</Trans>
                </button>
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{i18n._(TARGET_COPY.declarationsTitle)}</legend>
          <p className="text-xs text-muted-foreground">{NUTRITION_SAFETY_COPY.declarationsIntro}</p>
          {choices.map((choice) => (
            <label key={choice.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={choice.selected}
                onChange={() => toggleDeclaration(choice.key)}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>

        {message ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save()} disabled={update.isPending}>
            {i18n._(update.isPending ? TARGET_COPY.saving : TARGET_COPY.saveSettings)}
          </Button>
          {needsConfirm ? (
            <Button variant="outline" onClick={() => save(true)} disabled={update.isPending}>
              {i18n._(TARGET_COPY.saveSettings)}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{i18n._(CUSTOM_FOOD_COPY.privacy)}</p>
      </CardContent>
    </Card>
  );
}
