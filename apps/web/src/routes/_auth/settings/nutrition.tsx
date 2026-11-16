import type {
  Declaration,
  EnergyDirection,
  TargetSettingsWire,
} from "@openvalens/api/contracts/nutrition-targets";
import { CUSTOM_FOOD_COPY } from "@openvalens/api/presenters/custom-foods";
import { DIARY_COPY } from "@openvalens/api/presenters/nutrition-diary";
import {
  DIRECTION_LABELS,
  NUTRITION_SAFETY_COPY,
  TARGET_COPY,
  declarationChoices,
  declarationsChange,
  parseHeight,
} from "@openvalens/api/presenters/nutrition-targets";
import { STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { FOOD_DRAFT_COPY, PHOTO_DRAFT_COPY } from "@openvalens/api/presenters/food-draft";
import { RECIPE_IMPORT_COPY } from "@openvalens/api/presenters/recipe-draft";
import { MICRONUTRIENT_COPY } from "@openvalens/api/presenters/micronutrients";
import { DRINKS_COPY } from "@openvalens/api/presenters/drinks";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  Beer,
  BookOpen,
  Camera,
  Coffee,
  Dumbbell,
  EyeOff,
  Flame,
  Leaf,
  type LucideIcon,
  MessageSquareText,
  Ruler,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { MicronutrientReference } from "@/components/micronutrient-reference";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { ErrorState, Page, PageHeader, Section } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { useNutritionSettings, type SettingsPatch } from "@/utils/nutrition-settings";

/**
 * Settings › Nutrition (nutrition-targets#1): everything about the member and
 * the food screens that is not a target, in three groups: Display, About you
 * and Features. Moved here from Nutrition targets. Switches save at once; the
 * About you answers save together, since removing an eating-disorder answer
 * asks for a confirmation. Each feature has an anchor (`#micronutrients`,
 * `#food-drafts`, `#photo-drafts`, `#recipe-import`) that other screens link to
 * (nutrition-targets#2).
 */
export const Route = createFileRoute("/_auth/settings/nutrition")({
  component: NutritionSettingsPage,
});

const NUTRITION_SETTINGS_COPY = Object.freeze({
  title: msg`Nutrition settings`,
  description: msg`How the food screens look and what they offer.`,
  display: msg`Display`,
  aboutYou: msg`About you`,
  features: msg`Features`,
  saveAbout: msg`Save these answers`,
});

function NutritionSettingsPage() {
  const { i18n } = useLingui();
  const { query, settings, save } = useNutritionSettings();
  const { hash } = useLocation();

  // A link to a feature (#micronutrients) lands on it once the settings are in.
  useEffect(() => {
    if (!hash || !settings) return;
    const target = document.getElementById(hash.replace(/^#/, ""));
    target?.scrollIntoView({ block: "center" });
    target?.querySelector<HTMLElement>("button, input, select")?.focus({ preventScroll: true });
  }, [hash, settings !== undefined]);

  return (
    <Page width="narrow">
      <ModuleHiddenNote module="food" />
      <PageHeader
        title={i18n._(NUTRITION_SETTINGS_COPY.title)}
        description={i18n._(NUTRITION_SETTINGS_COPY.description)}
        info={i18n._(CUSTOM_FOOD_COPY.privacy)}
      />
      {query.isPending ? (
        <div className="grid gap-8" aria-hidden="true">
          <Skeleton className="h-56 w-full rounded-3xl" />
          <Skeleton className="h-72 w-full rounded-3xl" />
        </div>
      ) : query.isError || !settings ? (
        <ErrorState
          title={i18n._(TARGET_COPY.networkError)}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {i18n._(DIARY_COPY.retry)}
            </Button>
          }
        />
      ) : (
        <>
          <DisplaySection settings={settings} save={save} />
          <AboutYouSection settings={settings} save={save} />
          <FeaturesSection settings={settings} save={save} />
        </>
      )}
    </Page>
  );
}

type Save = ReturnType<typeof useNutritionSettings>["save"];

/** A switch row that saves its setting at once. */
function SwitchRow({
  id,
  icon,
  label,
  checked,
  onChange,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  label: MessageDescriptor;
  checked: boolean;
  onChange: (checked: boolean) => Promise<unknown>;
  children?: React.ReactNode;
}) {
  const { i18n } = useLingui();
  const control = useId();
  const [pending, setPending] = useState(false);
  return (
    <div id={id} className="scroll-mt-24">
      <SettingsRow icon={icon} label={i18n._(label)} htmlFor={control}>
        <Switch
          id={control}
          checked={checked}
          disabled={pending}
          onCheckedChange={(next) => {
            setPending(true);
            void onChange(next).finally(() => setPending(false));
          }}
        />
      </SettingsRow>
      {children}
    </div>
  );
}

/** One ⓘ per group: each setting's explanation, under its name. */
function GroupInfo({ items }: { items: readonly [MessageDescriptor, React.ReactNode][] }) {
  const { i18n } = useLingui();
  return (
    <div className="grid gap-2">
      {items.map(([label, text]) => (
        <p key={label.id}>
          <span className="font-semibold text-ink">{i18n._(label)}.</span> {text}
        </p>
      ))}
    </div>
  );
}

function DisplaySection({ settings, save }: { settings: TargetSettingsWire; save: Save }) {
  const { i18n } = useLingui();
  const toggle = (patch: SettingsPatch) => save(patch);
  return (
    <Section
      id="display"
      className="scroll-mt-24"
      icon={EyeOff}
      tone="food"
      title={i18n._(NUTRITION_SETTINGS_COPY.display)}
      info={
        <GroupInfo
          items={[
            [TARGET_COPY.hideNumbers, i18n._(TARGET_COPY.hideNumbersDescription)],
            [STREAK_COPY.settingLabel, i18n._(STREAK_COPY.settingDescription)],
            [DRINKS_COPY.caffeineSettingLabel, i18n._(DRINKS_COPY.caffeineSettingDescription)],
            [DRINKS_COPY.alcoholSettingLabel, i18n._(DRINKS_COPY.alcoholSettingDescription)],
          ]}
        />
      }
    >
      <SettingsGroup>
        <SwitchRow
          icon={EyeOff}
          label={TARGET_COPY.hideNumbers}
          checked={settings.hideNumbers}
          onChange={(value) => toggle({ hideNumbers: value })}
        />
        <SwitchRow
          id="streaks"
          icon={Flame}
          label={STREAK_COPY.settingLabel}
          checked={settings.streaksEnabled}
          onChange={(value) => toggle({ streaksEnabled: value })}
        />
        <SwitchRow
          icon={Coffee}
          label={DRINKS_COPY.caffeineSettingLabel}
          checked={settings.caffeineTotalsEnabled}
          onChange={(value) => toggle({ caffeineTotalsEnabled: value })}
        />
        <SwitchRow
          icon={Beer}
          label={DRINKS_COPY.alcoholSettingLabel}
          checked={settings.alcoholTotalsEnabled}
          onChange={(value) => toggle({ alcoholTotalsEnabled: value })}
        />
      </SettingsGroup>
    </Section>
  );
}

function AboutYouSection({ settings, save }: { settings: TargetSettingsWire; save: Save }) {
  const { t, i18n } = useLingui();
  const heightId = useId();
  const [height, setHeight] = useState(settings.heightCm === null ? "" : String(settings.heightCm));
  const [declarations, setDeclarations] = useState<Declaration[]>(settings.declarations);
  const [message, setMessage] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // A newer version (another device, or a switch above) resets the unsaved answers.
  useEffect(() => {
    setHeight(settings.heightCm === null ? "" : String(settings.heightCm));
    setDeclarations(settings.declarations);
  }, [settings.heightCm, settings.declarations]);

  const choices = declarationChoices(declarations);
  const toggleDeclaration = (key: Declaration) => {
    setDeclarations((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
    setNeedsConfirm(false);
  };

  const submit = async (confirmClearEatingDisorder = false) => {
    const parsedHeight = parseHeight(height, i18n.locale);
    if (!parsedHeight.ok) {
      setMessage(i18n._(parsedHeight.error));
      return;
    }
    const change = declarationsChange(settings.declarations, declarations);
    setNeedsConfirm(change.removesEatingDisorder && !confirmClearEatingDisorder);
    setSaving(true);
    const result = await save({
      heightCm: parsedHeight.value,
      declarations,
      ...(confirmClearEatingDisorder ? { confirmClearEatingDisorder: true as const } : {}),
    });
    setSaving(false);
    if (result.outcome === "conflict") setMessage(i18n._(TARGET_COPY.conflict));
    else if (result.outcome === "confirmation_required") {
      setMessage(result.note);
      setNeedsConfirm(true);
    } else if (result.outcome === "updated") {
      setMessage(i18n._(TARGET_COPY.settingsSaved));
      setNeedsConfirm(false);
    }
  };

  return (
    <Section
      id="about-you"
      className="scroll-mt-24"
      icon={UserRound}
      tone="food"
      title={i18n._(NUTRITION_SETTINGS_COPY.aboutYou)}
      info={
        <GroupInfo
          items={[
            [TARGET_COPY.directionTitle, i18n._(TARGET_COPY.directionDescription)],
            ...(Object.keys(DIRECTION_LABELS) as EnergyDirection[]).map(
              (key) =>
                [DIRECTION_LABELS[key].label, i18n._(DIRECTION_LABELS[key].description)] as [
                  MessageDescriptor,
                  string,
                ],
            ),
            [TARGET_COPY.heightLabel, i18n._(TARGET_COPY.heightDescription)],
            [TARGET_COPY.declarationsTitle, NUTRITION_SAFETY_COPY.declarationsIntro],
          ]}
        />
      }
    >
      <SettingsGroup>
        <SettingsRow icon={Sparkles} label={i18n._(TARGET_COPY.directionTitle)}>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={i18n._(TARGET_COPY.directionTitle)}
          >
            {(Object.keys(DIRECTION_LABELS) as EnergyDirection[]).map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-input bg-card py-1.5 pr-3 pl-2.5 text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-muted has-[:checked]:border-transparent has-[:checked]:bg-food-soft has-[:checked]:text-ink"
              >
                <input
                  type="radio"
                  name="direction"
                  className="size-4 accent-primary"
                  checked={settings.energyDirection === key}
                  onChange={() => void save({ energyDirection: key })}
                />
                <span className="font-semibold">{i18n._(DIRECTION_LABELS[key].label)}</span>
              </label>
            ))}
          </div>
        </SettingsRow>
        <SwitchRow
          icon={Dumbbell}
          label={TARGET_COPY.activeProtein}
          checked={settings.activeProtein}
          onChange={(value) => save({ activeProtein: value })}
        />
        <SettingsRow icon={Ruler} label={i18n._(TARGET_COPY.heightLabel)} htmlFor={heightId}>
          <Input
            id={heightId}
            inputMode="decimal"
            className="w-28"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
          />
        </SettingsRow>
        <fieldset className="grid gap-2 py-4">
          {/* The group is already "About you"; the legend names the list for screen readers. */}
          <legend className="sr-only">{i18n._(TARGET_COPY.declarationsTitle)}</legend>
          {choices.map((choice) => (
            <label
              key={choice.key}
              className="flex cursor-pointer items-center gap-2 text-sm text-ink-2"
            >
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
        <div className="grid gap-2 py-4">
          {message ? (
            <p className="text-sm text-ink-2" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? t`Saving…` : i18n._(NUTRITION_SETTINGS_COPY.saveAbout)}
            </Button>
            {needsConfirm ? (
              <Button variant="outline" onClick={() => void submit(true)} disabled={saving}>
                {i18n._(TARGET_COPY.saveSettings)}
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsGroup>
    </Section>
  );
}

function FeaturesSection({ settings, save }: { settings: TargetSettingsWire; save: Save }) {
  const { i18n } = useLingui();
  return (
    <Section
      id="features"
      className="scroll-mt-24"
      icon={Sparkles}
      tone="food"
      title={i18n._(NUTRITION_SETTINGS_COPY.features)}
      info={
        <GroupInfo
          items={[
            [FOOD_DRAFT_COPY.settingLabel, i18n._(FOOD_DRAFT_COPY.settingDescription)],
            [PHOTO_DRAFT_COPY.settingLabel, i18n._(PHOTO_DRAFT_COPY.settingDescription)],
            [RECIPE_IMPORT_COPY.settingLabel, i18n._(RECIPE_IMPORT_COPY.settingDescription)],
            [MICRONUTRIENT_COPY.settingLabel, i18n._(MICRONUTRIENT_COPY.settingDescription)],
          ]}
        />
      }
    >
      <SettingsGroup>
        <SwitchRow
          id="food-drafts"
          icon={MessageSquareText}
          label={FOOD_DRAFT_COPY.settingLabel}
          checked={settings.voiceDraftsEnabled}
          onChange={(value) => save({ voiceDraftsEnabled: value })}
        />
        <SwitchRow
          id="photo-drafts"
          icon={Camera}
          label={PHOTO_DRAFT_COPY.settingLabel}
          checked={settings.photoDraftsEnabled}
          onChange={(value) => save({ photoDraftsEnabled: value })}
        />
        <SwitchRow
          id="recipe-import"
          icon={BookOpen}
          label={RECIPE_IMPORT_COPY.settingLabel}
          checked={settings.recipeImportEnabled}
          onChange={(value) => save({ recipeImportEnabled: value })}
        />
        <SwitchRow
          id="micronutrients"
          icon={Leaf}
          label={MICRONUTRIENT_COPY.settingLabel}
          checked={settings.micronutrientsEnabled}
          onChange={(value) => save({ micronutrientsEnabled: value })}
        >
          {settings.micronutrientsEnabled ? (
            <MicronutrientReference settings={settings} save={save} />
          ) : null}
        </SwitchRow>
      </SettingsGroup>
    </Section>
  );
}
