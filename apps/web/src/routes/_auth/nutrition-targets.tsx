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
import type { NutrientKey } from "@openvalens/api/contracts/nutrition-diary";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  Beef,
  Check,
  Droplet,
  Leaf,
  LifeBuoy,
  type LucideIcon,
  Plus,
  Settings2,
  Target,
  Wheat,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

const TARGET_ICONS: Partial<Record<NutrientKey, LucideIcon>> = {
  energyKcal: Zap,
  energyKj: Zap,
  proteinG: Beef,
  carbohydrateG: Wheat,
  fatG: Droplet,
  fiberG: Leaf,
};

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { EnergyEstimateCard } from "@/components/energy-estimate-card";
import {
  controlLinkClass,
  inlineButtonClass,
  nativeSelectClass,
  textLinkClass,
} from "@/components/food-classes";
import {
  Details,
  EmptyState,
  ErrorState,
  InfoTip,
  Page,
  PageHeader,
  Section,
  ToneIcon,
} from "@/components/page";

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

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-ink-3">
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
    <Page>
      <PageHeader
        title={i18n._(TARGET_COPY.title)}
        actions={
          <Link to="/nutrition" className={`inline-flex items-center gap-1.5 ${controlLinkClass}`}>
            <ArrowLeft className="size-4 text-food" aria-hidden="true" />
            <Trans>Back to meal diary</Trans>
          </Link>
        }
      />

      {overview.isPending ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" aria-hidden="true">
          <Skeleton className="h-64 w-full rounded-3xl" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      ) : overview.isError || !data ? (
        <ErrorState
          title={i18n._(TARGET_COPY.networkError)}
          action={
            <Button variant="outline" onClick={() => void overview.refetch()}>
              {i18n._(DIARY_COPY.retry)}
            </Button>
          }
        />
      ) : (
        <>
          {data.support ? (
            <section
              role="note"
              aria-label={i18n._(TARGET_COPY.helplinesTitle)}
              className="sheet flex min-w-0 items-start gap-4 p-5 text-sm text-ink-2"
            >
              <LifeBuoy className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden="true" />
              <div className="grid min-w-0 gap-2">
                <p className="text-ink">{data.support.text}</p>
                <ul className="grid gap-1">
                  {data.support.helplines.map((line) => (
                    <li key={line.name}>
                      {line.phone ? (
                        <a
                          className={textLinkClass}
                          href={`tel:${line.phone.replace(/[^+\d]/g, "")}`}
                        >
                          {formatHelpline(line)}
                        </a>
                      ) : (
                        <a
                          className={textLinkClass}
                          href={line.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {formatHelpline(line)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {data.notes.length > 0 ? (
            <ul className="grid gap-1 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid min-w-0 content-start gap-8">
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

              <Section
                icon={Beef}
                tone="food"
                sheet
                title={i18n._(TARGET_COPY.proteinReferenceTitle)}
                info={
                  <>
                    <p>{i18n._(TARGET_COPY.proteinReferenceNote)}</p>
                    <p className="text-ink-3">{data.safety.policyVersion}</p>
                  </>
                }
              >
                <p
                  className={
                    data.proteinReference
                      ? "num font-display text-2xl font-medium text-ink"
                      : "text-sm text-ink-2"
                  }
                >
                  {data.proteinReference
                    ? formatProteinReference(data.proteinReference, hideNumbers, i18n)
                    : i18n._(TARGET_COPY.proteinReferenceUnavailable)}
                </p>
              </Section>
            </div>

            <SettingsCard
              settings={data.settings}
              onHideNumbersChange={(value) => {
                if (scope) setHideOverride({ scope, value });
              }}
              onChanged={() => void refresh()}
            />
          </div>
        </>
      )}
    </Page>
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
    <div className="grid min-w-0 gap-8">
      <Section
        icon={Target}
        tone="food"
        title={i18n._(TARGET_COPY.yourTargets)}
        info={i18n._(TARGET_COPY.targetsNote)}
      >
        {targets.length === 0 ? (
          <EmptyState icon={Target} title={i18n._(TARGET_COPY.noTargets)} />
        ) : (
          <ul
            className="grid min-w-0 gap-3 sm:grid-cols-2"
            aria-label={i18n._(TARGET_COPY.yourTargets)}
          >
            {targets.map((target) => (
              <li key={target.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                <div className="flex items-center gap-3">
                  <ToneIcon icon={TARGET_ICONS[target.nutrient] ?? Target} tone="food" />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="font-semibold text-ink">
                      {i18n._(NUTRIENT_LABELS[target.nutrient].label)}
                    </span>
                    <span className="num rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink">
                      {formatTarget(target, hideNumbers, i18n)}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm text-ink-3">{i18n._(describeTargetSource(target))}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="-mr-1 text-ink-3 hover:text-ink"
                    onClick={() => clear(target)}
                    disabled={clearTarget.isPending}
                  >
                    <X aria-hidden="true" />
                    {i18n._(TARGET_COPY.clearTarget)}{" "}
                    <span className="sr-only">
                      {i18n._(NUTRIENT_LABELS[target.nutrient].label)}
                    </span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Plus} tone="food" sheet title={t`Set a target`}>
        <fieldset className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <legend className="sr-only">{i18n._(TARGET_COPY.setTarget)}</legend>
          <Field label={t`Nutrient`}>
            {(id) => (
              <select
                id={id}
                className={nativeSelectClass}
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
                className="num"
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
                className="num"
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
                className="num"
                value={effectiveFrom}
                onChange={(event) => event.target.value && setEffectiveFrom(event.target.value)}
              />
            )}
          </Field>
          <div className="sm:col-span-4">
            <Button variant="outline" onClick={save} disabled={setTarget.isPending}>
              {i18n._(setTarget.isPending ? TARGET_COPY.saving : TARGET_COPY.setTarget)}
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-destructive sm:col-span-4" role="alert">
              {i18n._(error)}
            </p>
          ) : null}
        </fieldset>
      </Section>
    </div>
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
    <Section
      icon={Settings2}
      tone="food"
      sheet
      title={i18n._(TARGET_COPY.settingsLink)}
      info={i18n._(CUSTOM_FOOD_COPY.privacy)}
    >
      <div className="grid gap-5 text-sm">
        <ToggleRow
          checked={hideNumbers}
          onChange={(checked) => {
            setHideNumbers(checked);
            onHideNumbersChange(checked);
          }}
          label={<span className="font-semibold text-ink">{i18n._(TARGET_COPY.hideNumbers)}</span>}
          info={i18n._(TARGET_COPY.hideNumbersDescription)}
        />

        <fieldset className="grid gap-2">
          <legend className="mb-1 flex items-center gap-1 font-display font-medium text-ink">
            {i18n._(TARGET_COPY.directionTitle)}
            <InfoTip>{i18n._(TARGET_COPY.directionDescription)}</InfoTip>
          </legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DIRECTION_LABELS) as EnergyDirection[]).map((key) => (
              <div key={key} className="flex items-center">
                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-input bg-card py-1.5 pr-3 pl-2.5 text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-muted has-[:checked]:border-transparent has-[:checked]:bg-food-soft has-[:checked]:text-ink">
                  <input
                    type="radio"
                    name="direction"
                    className="size-4 accent-primary"
                    checked={direction === key}
                    onChange={() => setDirection(key)}
                  />
                  <span className="font-semibold">{i18n._(DIRECTION_LABELS[key].label)}</span>
                </label>
                <InfoTip>{i18n._(DIRECTION_LABELS[key].description)}</InfoTip>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-1.5">
          <Field label={i18n._(TARGET_COPY.heightLabel)}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="sm:max-w-48"
                value={height}
                aria-describedby={`${id}-help`}
                onChange={(event) => setHeight(event.target.value)}
              />
            )}
          </Field>
          <p className="text-ink-3">{i18n._(TARGET_COPY.heightDescription)}</p>
        </div>

        <ToggleRow
          checked={activeProtein}
          onChange={setActiveProtein}
          label={i18n._(TARGET_COPY.activeProtein)}
        />

        <Details summary={<Trans>More options</Trans>}>
          <div className="grid gap-4">
            <ToggleRow
              checked={streaksEnabled}
              onChange={setStreaksEnabled}
              label={i18n._(STREAK_COPY.settingLabel)}
              info={i18n._(STREAK_COPY.settingDescription)}
            />
            <ToggleRow
              checked={recipeImportEnabled}
              onChange={setRecipeImportEnabled}
              label={i18n._(RECIPE_IMPORT_COPY.settingLabel)}
              info={i18n._(RECIPE_IMPORT_COPY.settingDescription)}
            />
            <ToggleRow
              checked={voiceDraftsEnabled}
              onChange={setVoiceDraftsEnabled}
              label={i18n._(FOOD_DRAFT_COPY.settingLabel)}
              info={i18n._(FOOD_DRAFT_COPY.settingDescription)}
            />
            <ToggleRow
              checked={photoDraftsEnabled}
              onChange={setPhotoDraftsEnabled}
              label={i18n._(PHOTO_DRAFT_COPY.settingLabel)}
              info={i18n._(PHOTO_DRAFT_COPY.settingDescription)}
            />
            <ToggleRow
              checked={micronutrientsEnabled}
              onChange={setMicronutrientsEnabled}
              label={i18n._(MICRONUTRIENT_COPY.settingLabel)}
              info={i18n._(MICRONUTRIENT_COPY.settingDescription)}
            />
            {micronutrientsEnabled ? (
              <fieldset className="grid gap-2 rounded-2xl bg-paper-2 p-4">
                <legend className="float-left mb-1 font-display text-sm font-medium text-ink">
                  {i18n._(MICRONUTRIENT_COPY.sourceLabel)}
                </legend>
                <p className="text-ink-3">{i18n._(MICRONUTRIENT_COPY.sourceHelp)}</p>
                <div className="flex flex-wrap gap-4">
                  <label className="grid gap-1.5 text-ink-3">
                    <Trans>Source</Trans>
                    <select
                      className={nativeSelectClass}
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
                    <label className="grid gap-1.5 text-ink-3">
                      <Trans>Group</Trans>
                      <select
                        className={nativeSelectClass}
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
                  <p className="text-ink-2">
                    {proposalText(proposal.data.source, proposal.data.population)}{" "}
                    <button
                      type="button"
                      className={inlineButtonClass}
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
          </div>
        </Details>

        <fieldset className="grid gap-2">
          <legend className="mb-1 flex items-center gap-1 font-display font-medium text-ink">
            {i18n._(TARGET_COPY.declarationsTitle)}
            <InfoTip>{NUTRITION_SAFETY_COPY.declarationsIntro}</InfoTip>
          </legend>
          {choices.map((choice) => (
            <label key={choice.key} className="flex cursor-pointer items-center gap-2 text-ink-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={choice.selected}
                onChange={() => toggleDeclaration(choice.key)}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>

        {message ? (
          <p className="text-ink-2" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save()} disabled={update.isPending}>
            <Check aria-hidden="true" />
            {i18n._(update.isPending ? TARGET_COPY.saving : TARGET_COPY.saveSettings)}
          </Button>
          {needsConfirm ? (
            <Button variant="outline" onClick={() => save(true)} disabled={update.isPending}>
              {i18n._(TARGET_COPY.saveSettings)}
            </Button>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

/** A setting as a checkbox and its label, with its explanation behind an ⓘ. */
function ToggleRow({
  checked,
  onChange,
  label,
  info,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  info?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-1">
      <label className="flex cursor-pointer items-start gap-2.5 py-1 text-ink-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {info ? <InfoTip>{info}</InfoTip> : null}
    </div>
  );
}
