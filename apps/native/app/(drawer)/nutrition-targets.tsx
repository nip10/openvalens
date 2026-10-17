import type {
  Declaration,
  EnergyDirection,
  NutritionTargetWire,
  TargetSettingsWire,
} from "@openvalens/api/contracts/nutrition-targets";
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
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button, Card, Spinner } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Pressable, Switch, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { readCache, writeCache } from "@/lib/offline/cache";
import { useOfflineScope } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";

/**
 * Nutrition targets and display settings (Issue #80), matching the web view.
 * Targets are the member's own: entered here or accepted from a #76
 * suggestion, never set by the app. Copy is neutral and hide-numbers mode
 * hides every number while logging keeps working.
 */

const inputClass =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";

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
      className={`min-h-11 justify-center rounded-lg border px-3 ${selected ? "border-foreground bg-accent" : "border-border"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

export default function NutritionTargetsScreen() {
  const localDate = useMemo(() => localDateIn(deviceTimeZone()), []);
  const scope = useOfflineScope();
  const queryClient = useQueryClient();
  const overviewOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const overview = useQuery({
    ...overviewOptions,
    queryKey: [...overviewOptions.queryKey, { offlineScope: scope }],
    enabled: Boolean(scope),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() });
  const data = overview.data;
  const [hideOverride, setHideOverride] = useState<boolean | null>(null);
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
  const hideNumbers =
    hideOverride ??
    resolveHideNumbers(
      overview.isSuccess ? data?.settings.hideNumbers : undefined,
      cachedPreference,
    );

  return (
    <Container>
      <View className="gap-5 p-4">
        <Link href="/nutrition" asChild>
          <Pressable accessibilityRole="link" className="min-h-11 justify-center">
            <Text className="text-sm text-foreground underline">
              Back to {DIARY_COPY.title.toLowerCase()}
            </Text>
          </Pressable>
        </Link>

        {overview.isPending ? (
          <Spinner />
        ) : overview.isError || !data ? (
          <Pressable onPress={() => void overview.refetch()} accessibilityRole="button">
            <Text className="text-sm text-muted-foreground">
              {TARGET_COPY.networkError} {DIARY_COPY.retry}
            </Text>
          </Pressable>
        ) : (
          <>
            {data.support ? (
              <Card variant="secondary" className="gap-2 p-4">
                <Text className="text-sm text-foreground" accessibilityRole="header">
                  {TARGET_COPY.helplinesTitle}
                </Text>
                <Text className="text-sm text-foreground">{data.support.text}</Text>
                {data.support.helplines.map((line) => (
                  <Text key={line.name} className="text-sm text-foreground">
                    {formatHelpline(line)}
                  </Text>
                ))}
              </Card>
            ) : null}

            {data.notes.length > 0 ? (
              <View className="gap-1">
                {data.notes.map((note) => (
                  <Text key={note} className="text-sm text-muted-foreground">
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

            <SettingsCard
              settings={data.settings}
              onHideNumbersChange={(value) => {
                setHideOverride(value);
                if (scope)
                  writeCache(scope, "nutrition-display-preference", { hideNumbers: value });
              }}
              onChanged={() => void refresh()}
            />

            <Card variant="secondary" className="gap-2 p-4">
              <Text className="font-medium text-foreground" accessibilityRole="header">
                {TARGET_COPY.proteinReferenceTitle}
              </Text>
              <Text className="font-mono text-sm text-foreground">
                {data.proteinReference
                  ? formatProteinReference(data.proteinReference, hideNumbers)
                  : TARGET_COPY.proteinReferenceUnavailable}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {TARGET_COPY.proteinReferenceNote}
              </Text>
              <Text className="text-xs text-muted-foreground">{data.safety.policyVersion}</Text>
            </Card>
          </>
        )}
      </View>
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
  const activeForSelected = targets.find((target) => target.nutrient === nutrient);

  const save = () => {
    const parsed = parseTargetForm(nutrient, { min, max, effectiveFrom });
    if (!parsed.ok) {
      setError(parsed.error);
      announce(parsed.error);
      return;
    }
    setError(null);
    setTarget.mutate(parsed.input, {
      onSuccess: () => {
        announce(TARGET_COPY.saved);
        setMin("");
        setMax("");
        onChanged();
      },
      onError: () => {
        setError(TARGET_COPY.networkError);
        announce(TARGET_COPY.networkError);
      },
    });
  };

  const clear = (target: NutritionTargetWire) => {
    clearTarget.mutate(
      { nutrient: target.nutrient, effectiveTo: localDateIn(deviceTimeZone()) },
      {
        onSuccess: () => {
          announce(TARGET_COPY.cleared);
          onChanged();
        },
        onError: () => announce(TARGET_COPY.networkError),
      },
    );
  };

  return (
    <Card variant="secondary" className="gap-3 p-4">
      <Text className="font-medium text-foreground" accessibilityRole="header">
        {TARGET_COPY.yourTargets}
      </Text>
      <Text className="text-sm text-muted-foreground">{TARGET_COPY.targetsNote}</Text>

      {targets.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{TARGET_COPY.noTargets}</Text>
      ) : (
        targets.map((target) => (
          <View key={target.id} className="gap-1">
            <Text className="text-sm font-medium text-foreground">
              {NUTRIENT_LABELS[target.nutrient].label}: {formatTarget(target, hideNumbers)}
            </Text>
            <Text className="text-xs text-muted-foreground">{describeTargetSource(target)}</Text>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => clear(target)}
              accessibilityLabel={`${TARGET_COPY.clearTarget} ${NUTRIENT_LABELS[target.nutrient].label}`}
            >
              {TARGET_COPY.clearTarget}
            </Button>
          </View>
        ))
      )}

      <View className="flex-row flex-wrap gap-2" accessibilityLabel="Nutrient">
        {choices.map((key) => (
          <Chip
            key={key}
            label={NUTRIENT_LABELS[key].label}
            selected={nutrient === key}
            onPress={() => setNutrient(key)}
          />
        ))}
      </View>
      <TextInput
        value={hideNumbers ? "" : min}
        onChangeText={setMin}
        keyboardType="decimal-pad"
        placeholder={
          hideNumbers
            ? TARGET_COPY.minimum
            : activeForSelected && activeForSelected.minAmount !== null
              ? `${TARGET_COPY.minimum} (${activeForSelected.minAmount})`
              : TARGET_COPY.minimum
        }
        accessibilityLabel={`${TARGET_COPY.minimum}${hideNumbers ? ", hidden" : ""}`}
        className={inputClass}
        placeholderTextColor="#9ca3af"
      />
      <TextInput
        value={hideNumbers ? "" : max}
        onChangeText={setMax}
        keyboardType="decimal-pad"
        placeholder={
          hideNumbers
            ? TARGET_COPY.maximum
            : activeForSelected && activeForSelected.maxAmount !== null
              ? `${TARGET_COPY.maximum} (${activeForSelected.maxAmount})`
              : TARGET_COPY.maximum
        }
        accessibilityLabel={`${TARGET_COPY.maximum}${hideNumbers ? ", hidden" : ""}`}
        className={inputClass}
        placeholderTextColor="#9ca3af"
      />
      <TextInput
        value={effectiveFrom}
        onChangeText={setEffectiveFrom}
        autoCapitalize="none"
        placeholder="YYYY-MM-DD"
        accessibilityLabel={TARGET_COPY.effectiveFrom}
        className={inputClass}
        placeholderTextColor="#9ca3af"
      />
      {error ? (
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button onPress={save} isDisabled={setTarget.isPending}>
        {setTarget.isPending ? TARGET_COPY.saving : TARGET_COPY.setTarget}
      </Button>
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
  const [height, setHeight] = useState(settings.heightCm === null ? "" : String(settings.heightCm));
  const [declarations, setDeclarations] = useState<Declaration[]>(settings.declarations);
  const [message, setMessage] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const update = useMutation(orpc.nutritionTargets.updateSettings.mutationOptions());

  useEffect(() => {
    setHideNumbers(settings.hideNumbers);
    setDirection(settings.energyDirection);
    setActiveProtein(settings.activeProtein);
    setHeight(settings.heightCm === null ? "" : String(settings.heightCm));
    setDeclarations(settings.declarations);
  }, [settings]);

  const choices = declarationChoices(declarations);
  const toggleDeclaration = (key: Declaration) => {
    setDeclarations((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
    setNeedsConfirm(false);
  };

  const save = (confirmClearEatingDisorder = false) => {
    const parsedHeight = parseHeight(height);
    if (!parsedHeight.ok) {
      setMessage(parsedHeight.error);
      announce(parsedHeight.error);
      return;
    }
    const change = declarationsChange(settings.declarations, declarations);
    setNeedsConfirm(change.removesEatingDisorder && !confirmClearEatingDisorder);
    const input = {
      expectedRevision: settings.revision,
      hideNumbers,
      energyDirection: direction,
      activeProtein,
      heightCm: parsedHeight.value,
      declarations,
      ...(confirmClearEatingDisorder ? { confirmClearEatingDisorder: true as const } : {}),
    };
    update.mutate(input, {
      onSuccess: (result) => {
        if (result.outcome === "conflict") {
          setMessage(TARGET_COPY.conflict);
          onChanged();
          return;
        }
        if (result.outcome === "confirmation_required") {
          setMessage(result.note);
          setNeedsConfirm(true);
          return;
        }
        setMessage(TARGET_COPY.settingsSaved);
        setNeedsConfirm(false);
        announce(TARGET_COPY.settingsSaved);
        onChanged();
      },
      onError: () => {
        setMessage(TARGET_COPY.networkError);
        announce(TARGET_COPY.networkError);
      },
    });
  };

  return (
    <Card variant="secondary" className="gap-3 p-4">
      <Text className="font-medium text-foreground" accessibilityRole="header">
        {TARGET_COPY.settingsLink}
      </Text>

      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-medium text-foreground">{TARGET_COPY.hideNumbers}</Text>
          <Text className="text-xs text-muted-foreground">
            {TARGET_COPY.hideNumbersDescription}
          </Text>
        </View>
        <Switch
          value={hideNumbers}
          onValueChange={(value) => {
            setHideNumbers(value);
            onHideNumbersChange(value);
          }}
          accessibilityLabel={TARGET_COPY.hideNumbers}
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm font-medium text-foreground" accessibilityRole="header">
          {TARGET_COPY.directionTitle}
        </Text>
        <Text className="text-xs text-muted-foreground">{TARGET_COPY.directionDescription}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(DIRECTION_LABELS) as EnergyDirection[]).map((key) => (
            <Chip
              key={key}
              label={DIRECTION_LABELS[key].label}
              selected={direction === key}
              onPress={() => setDirection(key)}
            />
          ))}
        </View>
        <Text className="text-xs text-muted-foreground">
          {DIRECTION_LABELS[direction].description}
        </Text>
      </View>

      <View className="gap-1">
        <Text className="text-sm font-medium text-foreground">{TARGET_COPY.heightLabel}</Text>
        <TextInput
          value={height}
          onChangeText={setHeight}
          keyboardType="decimal-pad"
          accessibilityLabel={TARGET_COPY.heightLabel}
          className={inputClass}
        />
        <Text className="text-xs text-muted-foreground">{TARGET_COPY.heightDescription}</Text>
      </View>

      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-sm text-foreground">{TARGET_COPY.activeProtein}</Text>
        <Switch
          value={activeProtein}
          onValueChange={setActiveProtein}
          accessibilityLabel={TARGET_COPY.activeProtein}
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm font-medium text-foreground" accessibilityRole="header">
          {TARGET_COPY.declarationsTitle}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {NUTRITION_SAFETY_COPY.declarationsIntro}
        </Text>
        {choices.map((choice) => (
          <Pressable
            key={choice.key}
            onPress={() => toggleDeclaration(choice.key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: choice.selected }}
            className="min-h-11 flex-row items-center gap-2"
          >
            <Text className="text-foreground">{choice.selected ? "[x]" : "[ ]"}</Text>
            <Text className="flex-1 text-sm text-foreground">{choice.label}</Text>
          </Pressable>
        ))}
      </View>

      {message ? (
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        <Button onPress={() => save()} isDisabled={update.isPending}>
          {update.isPending ? TARGET_COPY.saving : TARGET_COPY.saveSettings}
        </Button>
        {needsConfirm ? (
          <Button variant="secondary" onPress={() => save(true)} isDisabled={update.isPending}>
            {TARGET_COPY.saveSettings}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
