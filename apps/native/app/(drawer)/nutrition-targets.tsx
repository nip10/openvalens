import type {
  Declaration,
  EnergyDirection,
  NutritionTargetWire,
  TargetSettingsWire,
} from "@openvalens/api/contracts/nutrition-targets";
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import type { NutrientKey } from "@openvalens/api/contracts/nutrition-diary";
import { Button } from "heroui-native";
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
  ShieldCheck,
  Target,
  Wheat,
  X,
  Zap,
} from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Pressable, Switch, Text, TextInput, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Icon,
  InfoTip,
  ListCard,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { readCache, writeCache } from "@/lib/offline/cache";
import { useOfflineScope } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { EnergyEstimateCard } from "@/components/energy-estimate-card";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

/**
 * Nutrition targets and display settings (Issue #80), matching the web view.
 * Targets are the member's own: entered here or accepted from a #76
 * suggestion, never set by the app. Copy is neutral and hide-numbers mode
 * hides every number while logging keeps working.
 */

const inputClass =
  "min-h-11 rounded-xl border border-rule bg-sheet px-3 font-sans text-base text-ink";

const TARGET_ICONS: Partial<Record<NutrientKey, LucideIcon>> = {
  energyKcal: Zap,
  energyKj: Zap,
  proteinG: Beef,
  carbohydrateG: Wheat,
  fatG: Droplet,
  fiberG: Leaf,
};

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? "border-food bg-food-soft" : "border-rule bg-sheet"}`}
    >
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A labelled switch, with its longer explanation behind an ⓘ. */
function ToggleRow({
  label,
  value,
  onValueChange,
  info,
  strong = false,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  info?: ReactNode;
  strong?: boolean;
}) {
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1 flex-row items-center gap-1">
        <Text
          className={`shrink font-sans text-sm ${strong ? "font-semibold text-ink" : "text-ink-2"}`}
        >
          {label}
        </Text>
        {info ? <InfoTip title={label}>{info}</InfoTip> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </View>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <Text className="font-sans text-sm font-medium text-ink-3">{children}</Text>;
}

export default function NutritionTargetsScreen() {
  const localDate = useMemo(() => localDateIn(deviceTimeZone()), []);
  const scope = useOfflineScope();
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const overviewOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const overview = useQuery({
    ...overviewOptions,
    queryKey: [...overviewOptions.queryKey, { offlineScope: scope }],
    enabled: Boolean(scope),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() });
  const data = overview.data;
  const [hideOverride, setHideOverride] = useState<{ scope: string; value: boolean } | null>(null);
  const cachedPreference = scope
    ? readCache<{ hideNumbers: boolean }>(scope, "nutrition-display-preference")?.data.hideNumbers
    : undefined;
  useEffect(() => {
    if (scope && data?.settings) {
      writeCache(scope, "nutrition-display-preference", {
        hideNumbers: data.settings.hideNumbers,
      });
    }
  }, [scope, data?.settings]);
  const hideNumbers = resolveScopedHideNumbers(
    scope,
    hideOverride,
    overview.isSuccess ? data?.settings.hideNumbers : undefined,
    cachedPreference,
  );

  return (
    <Container>
      <Page>
        <ModuleHiddenNote module="food" />
        <PageHeader
          title={i18n._(TARGET_COPY.title)}
          actions={
            <Link href="/nutrition" asChild>
              <Button variant="outline" size="sm" accessibilityRole="link">
                <Icon icon={ArrowLeft} size={16} color="food" />
                <Button.Label>
                  <Trans>Back to meal diary</Trans>
                </Button.Label>
              </Button>
            </Link>
          }
        />

        {overview.isPending ? (
          <Sheet>
            <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
          </Sheet>
        ) : overview.isError || !data ? (
          <ErrorState
            title={i18n._(TARGET_COPY.networkError)}
            action={
              <Button variant="outline" size="sm" onPress={() => void overview.refetch()}>
                <Button.Label>{i18n._(DIARY_COPY.retry)}</Button.Label>
              </Button>
            }
          />
        ) : (
          <>
            {data.support ? (
              <Sheet className="flex-row items-start gap-4">
                <View className="pt-0.5">
                  <Icon icon={LifeBuoy} size={20} />
                </View>
                <View className="min-w-0 flex-1 gap-2">
                  <Text
                    className="font-display text-base font-medium text-ink"
                    accessibilityRole="header"
                  >
                    {i18n._(TARGET_COPY.helplinesTitle)}
                  </Text>
                  <Text className="font-sans text-sm text-ink">{data.support.text}</Text>
                  {data.support.helplines.map((line) => (
                    <Text key={line.name} className="font-sans text-sm text-ink-2">
                      {formatHelpline(line)}
                    </Text>
                  ))}
                </View>
              </Sheet>
            ) : null}

            {data.notes.length > 0 ? (
              <View className="gap-1 rounded-2xl bg-paper-2 px-4 py-3">
                {data.notes.map((note) => (
                  <Text key={note} className="font-sans text-sm text-ink-2">
                    {note}
                  </Text>
                ))}
              </View>
            ) : null}

            <TargetsCard
              targets={data.targets}
              hideNumbers={hideNumbers}
              energyOff={data.safety.energyTargets === "off"}
              onChanged={() => void refresh()}
            />

            <EnergyEstimateCard
              scope={scope}
              hideNumbers={hideNumbers}
              preferenceKnown={overview.isSuccess}
              safetyOff={data.safety.energyTargets === "off"}
            />

            <Section
              icon={Beef}
              tone="food"
              sheet
              title={i18n._(TARGET_COPY.proteinReferenceTitle)}
              info={
                <>
                  <Prose>{i18n._(TARGET_COPY.proteinReferenceNote)}</Prose>
                  <Prose className="text-ink-3">{data.safety.policyVersion}</Prose>
                </>
              }
            >
              <Text
                className={
                  data.proteinReference
                    ? "font-display text-2xl font-medium text-ink"
                    : "font-sans text-sm text-ink-2"
                }
                style={data.proteinReference ? { fontVariant: ["tabular-nums"] } : undefined}
              >
                {data.proteinReference
                  ? formatProteinReference(data.proteinReference, hideNumbers, i18n)
                  : i18n._(TARGET_COPY.proteinReferenceUnavailable)}
              </Text>
            </Section>

            <SettingsCard
              settings={data.settings}
              onHideNumbersChange={(value) => {
                if (scope) setHideOverride({ scope, value });
                if (scope)
                  writeCache(scope, "nutrition-display-preference", { hideNumbers: value });
              }}
              onChanged={() => void refresh()}
            />
          </>
        )}
      </Page>
    </Container>
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
  const [error, setError] = useState<string | null>(null);
  const setTarget = useMutation(orpc.nutritionTargets.setTarget.mutationOptions());
  const clearTarget = useMutation(orpc.nutritionTargets.clearTarget.mutationOptions());
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const activeForSelected = targets.find((target) => target.nutrient === nutrient);

  const save = () => {
    const parsed = parseTargetForm(nutrient, { min, max, effectiveFrom });
    if (!parsed.ok) {
      setError(i18n._(parsed.error));
      announce(i18n._(parsed.error));
      return;
    }
    setError(null);
    setTarget.mutate(parsed.input, {
      onSuccess: () => {
        announce(i18n._(TARGET_COPY.saved));
        setMin("");
        setMax("");
        onChanged();
      },
      onError: () => {
        setError(i18n._(TARGET_COPY.networkError));
        announce(i18n._(TARGET_COPY.networkError));
      },
    });
  };

  const clear = (target: NutritionTargetWire) => {
    clearTarget.mutate(
      { nutrient: target.nutrient, effectiveTo: localDateIn(deviceTimeZone()) },
      {
        onSuccess: () => {
          announce(i18n._(TARGET_COPY.cleared));
          onChanged();
        },
        onError: () => announce(i18n._(TARGET_COPY.networkError)),
      },
    );
  };

  return (
    <>
      <Section
        icon={Target}
        tone="food"
        title={i18n._(TARGET_COPY.yourTargets)}
        info={i18n._(TARGET_COPY.targetsNote)}
      >
        {targets.length === 0 ? (
          <EmptyState icon={Target} tone="food" title={i18n._(TARGET_COPY.noTargets)} />
        ) : (
          <View className="gap-3">
            {targets.map((target) => (
              <ListCard
                key={target.id}
                icon={TARGET_ICONS[target.nutrient] ?? Target}
                tone="food"
                title={i18n._(NUTRIENT_LABELS[target.nutrient].label)}
                chip={formatTarget(target, hideNumbers, i18n)}
                subtitle={i18n._(describeTargetSource(target))}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-end"
                  onPress={() => clear(target)}
                  accessibilityLabel={t`Clear target ${i18n._(NUTRIENT_LABELS[target.nutrient].label)}`}
                >
                  <Icon icon={X} size={16} color="ink-3" />
                  <Button.Label>{i18n._(TARGET_COPY.clearTarget)}</Button.Label>
                </Button>
              </ListCard>
            ))}
          </View>
        )}
      </Section>

      <Section icon={Plus} tone="food" sheet title={t`Set a target`}>
        <View className="gap-1.5">
          <FieldLabel>{t`Nutrient`}</FieldLabel>
          <View className="flex-row flex-wrap gap-2" accessibilityLabel={t`Nutrient`}>
            {choices.map((key) => (
              <Chip
                key={key}
                label={i18n._(NUTRIENT_LABELS[key].label)}
                selected={nutrient === key}
                onPress={() => setNutrient(key)}
              />
            ))}
          </View>
        </View>
        <View className="gap-1.5">
          <FieldLabel>{i18n._(TARGET_COPY.minimum)}</FieldLabel>
          <TextInput
            value={hideNumbers ? "" : min}
            onChangeText={setMin}
            keyboardType="decimal-pad"
            placeholder={
              hideNumbers
                ? i18n._(TARGET_COPY.minimum)
                : activeForSelected && activeForSelected.minAmount !== null
                  ? `${i18n._(TARGET_COPY.minimum)} (${activeForSelected.minAmount})`
                  : i18n._(TARGET_COPY.minimum)
            }
            accessibilityLabel={
              hideNumbers ? t`Minimum (optional), hidden` : i18n._(TARGET_COPY.minimum)
            }
            className={inputClass}
            placeholderTextColor={placeholder}
          />
        </View>
        <View className="gap-1.5">
          <FieldLabel>{i18n._(TARGET_COPY.maximum)}</FieldLabel>
          <TextInput
            value={hideNumbers ? "" : max}
            onChangeText={setMax}
            keyboardType="decimal-pad"
            placeholder={
              hideNumbers
                ? i18n._(TARGET_COPY.maximum)
                : activeForSelected && activeForSelected.maxAmount !== null
                  ? `${i18n._(TARGET_COPY.maximum)} (${activeForSelected.maxAmount})`
                  : i18n._(TARGET_COPY.maximum)
            }
            accessibilityLabel={
              hideNumbers ? t`Maximum (optional), hidden` : i18n._(TARGET_COPY.maximum)
            }
            className={inputClass}
            placeholderTextColor={placeholder}
          />
        </View>
        <View className="gap-1.5">
          <FieldLabel>{i18n._(TARGET_COPY.effectiveFrom)}</FieldLabel>
          <TextInput
            value={effectiveFrom}
            onChangeText={setEffectiveFrom}
            autoCapitalize="none"
            placeholder="YYYY-MM-DD"
            accessibilityLabel={i18n._(TARGET_COPY.effectiveFrom)}
            className={inputClass}
            style={{ fontVariant: ["tabular-nums"] }}
            placeholderTextColor={placeholder}
          />
        </View>
        {error ? (
          <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button className="self-start" onPress={save} isDisabled={setTarget.isPending}>
          <Button.Label>
            {i18n._(setTarget.isPending ? TARGET_COPY.saving : TARGET_COPY.setTarget)}
          </Button.Label>
        </Button>
      </Section>
    </>
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
  // Only for the suggestion; the summary itself is on its own screen.
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
    if (!populationId) return t`Suggested from your profile: ${sourceName}. Use this`;
    const group = MICRONUTRIENT_POPULATIONS[populationId].label;
    return t`Suggested from your profile: ${sourceName}, ${group}. Use this`;
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
      announce(i18n._(parsedHeight.error));
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
        announce(i18n._(TARGET_COPY.settingsSaved));
        onChanged();
      },
      onError: () => {
        setMessage(i18n._(TARGET_COPY.networkError));
        announce(i18n._(TARGET_COPY.networkError));
      },
    });
  };

  return (
    <Section
      icon={Settings2}
      tone="food"
      sheet
      title={i18n._(TARGET_COPY.settingsLink)}
      info={i18n._(CUSTOM_FOOD_COPY.privacy)}
    >
      <View className="gap-5">
        <ToggleRow
          strong
          label={i18n._(TARGET_COPY.hideNumbers)}
          info={i18n._(TARGET_COPY.hideNumbersDescription)}
          value={hideNumbers}
          onValueChange={(value) => {
            setHideNumbers(value);
            onHideNumbersChange(value);
          }}
        />

        <View className="gap-2">
          <View className="flex-row items-center gap-1">
            <Text
              className="font-display text-base font-medium text-ink"
              accessibilityRole="header"
            >
              {i18n._(TARGET_COPY.directionTitle)}
            </Text>
            <InfoTip title={i18n._(TARGET_COPY.directionTitle)}>
              {i18n._(TARGET_COPY.directionDescription)}
            </InfoTip>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {(Object.keys(DIRECTION_LABELS) as EnergyDirection[]).map((key) => (
              <Chip
                key={key}
                label={i18n._(DIRECTION_LABELS[key].label)}
                selected={direction === key}
                onPress={() => setDirection(key)}
              />
            ))}
          </View>
          <Text className="font-sans text-sm text-ink-3">
            {i18n._(DIRECTION_LABELS[direction].description)}
          </Text>
        </View>

        <View className="gap-1.5">
          <FieldLabel>{i18n._(TARGET_COPY.heightLabel)}</FieldLabel>
          <TextInput
            value={height}
            onChangeText={setHeight}
            keyboardType="decimal-pad"
            accessibilityLabel={i18n._(TARGET_COPY.heightLabel)}
            className={inputClass}
            style={{ fontVariant: ["tabular-nums"] }}
          />
          <Text className="font-sans text-sm text-ink-3">
            {i18n._(TARGET_COPY.heightDescription)}
          </Text>
        </View>

        <ToggleRow
          label={i18n._(TARGET_COPY.activeProtein)}
          value={activeProtein}
          onValueChange={setActiveProtein}
        />

        <Details summary={<Trans>More options</Trans>}>
          <View className="gap-3">
            <ToggleRow
              label={i18n._(STREAK_COPY.settingLabel)}
              info={i18n._(STREAK_COPY.settingDescription)}
              value={streaksEnabled}
              onValueChange={setStreaksEnabled}
            />
            <ToggleRow
              label={i18n._(RECIPE_IMPORT_COPY.settingLabel)}
              info={i18n._(RECIPE_IMPORT_COPY.settingDescription)}
              value={recipeImportEnabled}
              onValueChange={setRecipeImportEnabled}
            />
            <ToggleRow
              label={i18n._(FOOD_DRAFT_COPY.settingLabel)}
              info={i18n._(FOOD_DRAFT_COPY.settingDescription)}
              value={voiceDraftsEnabled}
              onValueChange={setVoiceDraftsEnabled}
            />
            <ToggleRow
              label={i18n._(PHOTO_DRAFT_COPY.settingLabel)}
              info={i18n._(PHOTO_DRAFT_COPY.settingDescription)}
              value={photoDraftsEnabled}
              onValueChange={setPhotoDraftsEnabled}
            />
            <ToggleRow
              label={i18n._(MICRONUTRIENT_COPY.settingLabel)}
              info={i18n._(MICRONUTRIENT_COPY.settingDescription)}
              value={micronutrientsEnabled}
              onValueChange={setMicronutrientsEnabled}
            />
            {micronutrientsEnabled ? (
              <View className="gap-2 rounded-2xl bg-paper-2 p-4">
                <Text
                  className="font-display text-sm font-medium text-ink"
                  accessibilityRole="header"
                >
                  {i18n._(MICRONUTRIENT_COPY.sourceLabel)}
                </Text>
                <Text className="font-sans text-sm text-ink-3">
                  {i18n._(MICRONUTRIENT_COPY.sourceHelp)}
                </Text>
                <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                  {([null, "efsa", "nasem"] as const).map((value) => (
                    <Pressable
                      key={value ?? "none"}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: referenceSource === value }}
                      onPress={() => {
                        setReferenceSource(value);
                        setPopulation(null);
                      }}
                      className={`min-h-11 justify-center rounded-full border px-4 ${referenceSource === value ? "border-food bg-food-soft" : "border-rule bg-sheet"}`}
                    >
                      <Text
                        className={`font-sans text-sm ${referenceSource === value ? "font-semibold text-ink" : "text-ink-2"}`}
                      >
                        {value ? i18n._(MICRONUTRIENT_COPY.sources[value]) : t`None`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {referenceSource ? (
                  <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                    {(
                      Object.entries(MICRONUTRIENT_POPULATIONS) as [
                        NonNullable<TargetSettingsWire["micronutrientPopulation"]>,
                        { source: string; label: string },
                      ][]
                    )
                      .filter(([, group]) => group.source === referenceSource)
                      .map(([id, group]) => (
                        <Pressable
                          key={id}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: population === id }}
                          onPress={() => setPopulation(id)}
                          className={`min-h-11 justify-center rounded-full border px-4 ${population === id ? "border-food bg-food-soft" : "border-rule bg-sheet"}`}
                        >
                          <Text
                            className={`font-sans text-sm ${population === id ? "font-semibold text-ink" : "text-ink-2"}`}
                          >
                            {group.label}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                ) : null}
                {proposal.data?.source &&
                (proposal.data.source !== referenceSource ||
                  (proposal.data.population && proposal.data.population !== population)) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setReferenceSource(proposal.data!.source);
                      setPopulation(proposal.data!.population);
                    }}
                    className="min-h-11 justify-center"
                  >
                    <Text className="font-sans text-sm text-signal underline">
                      {proposalText(proposal.data.source, proposal.data.population)}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </Details>

        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Icon icon={ShieldCheck} size={18} />
            <Text
              className="font-display text-base font-medium text-ink"
              accessibilityRole="header"
            >
              {i18n._(TARGET_COPY.declarationsTitle)}
            </Text>
          </View>
          {/* Safety copy stays on the surface. */}
          <Text className="font-sans text-sm text-ink-3">
            {NUTRITION_SAFETY_COPY.declarationsIntro}
          </Text>
          {choices.map((choice) => (
            <Pressable
              key={choice.key}
              onPress={() => toggleDeclaration(choice.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: choice.selected }}
              className="min-h-11 flex-row items-center gap-3"
            >
              <View
                className={`h-6 w-6 items-center justify-center rounded-md border ${choice.selected ? "border-food bg-food-soft" : "border-rule-2 bg-sheet"}`}
              >
                {choice.selected ? <Icon icon={Check} size={16} color="ink" /> : null}
              </View>
              <Text className="flex-1 font-sans text-sm text-ink-2">{choice.label}</Text>
            </Pressable>
          ))}
        </View>

        {message ? (
          <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}

        <View className="flex-row flex-wrap gap-2">
          <Button variant="secondary" onPress={() => save()} isDisabled={update.isPending}>
            <Button.Label>
              {i18n._(update.isPending ? TARGET_COPY.saving : TARGET_COPY.saveSettings)}
            </Button.Label>
          </Button>
          {needsConfirm ? (
            <Button variant="outline" onPress={() => save(true)} isDisabled={update.isPending}>
              <Button.Label>{i18n._(TARGET_COPY.saveSettings)}</Button.Label>
            </Button>
          ) : null}
        </View>
      </View>
    </Section>
  );
}
