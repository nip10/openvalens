import { useLingui } from "@lingui/react/macro";
import { trackerDraftProblems, type TrackerDraft } from "@openvalens/api/presenters/tracker-draft";
import {
  TRACKER_AGGREGATION_LABELS,
  TRACKER_PERIOD_LABELS,
  TRACKER_TYPE_LABELS,
} from "@openvalens/api/presenters/trackers";
import {
  NUMBER_AGGREGATIONS,
  TRACKER_ICONS,
  TRACKER_LIMITS,
  TRACKER_TARGET_PERIODS,
  TRACKER_TYPES,
} from "@openvalens/trackers/model";
import type { ReactNode } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { Icon } from "@/components/bloom";
import { useThemeColor } from "@/utils/theme";

import { trackerIcon } from "./tracker-icons";
import { TRACKER_INPUT_CLASS } from "./tracker-value-input";

function Chip({
  selected,
  disabled,
  onPress,
  children,
  accessibilityLabel,
}: {
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected, disabled }}
      className={`min-h-11 items-center justify-center rounded-full border px-4 ${selected ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-sheet"} ${disabled ? "opacity-55" : ""}`}
    >
      {typeof children === "string" ? (
        <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="font-sans text-sm font-medium text-ink-2">{label}</Text>
      {children}
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-base font-medium text-ink">{label}</Text>
        <Text className="font-sans text-sm text-ink-3">{hint}</Text>
      </View>
      <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

/**
 * The fields of a custom tracker (#441) on mobile, for creating one and for
 * its settings. `locked` (the tracker has entries) disables type, unit and
 * how a day's entries combine.
 */
export function TrackerEditor({
  draft,
  onChange,
  locked = false,
  showErrors = false,
}: {
  draft: TrackerDraft;
  onChange: (draft: TrackerDraft) => void;
  locked?: boolean;
  showErrors?: boolean;
}) {
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const problems = showErrors ? trackerDraftProblems(draft, i18n.locale) : [];
  const unitName = draft.unit.trim() || t`the tracker's unit`;
  const set = <K extends keyof TrackerDraft>(key: K, value: TrackerDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <View className="gap-4">
      <Field label={t`Name`}>
        <TextInput
          testID="tracker-name-input"
          accessibilityLabel={t`Name`}
          value={draft.name}
          maxLength={TRACKER_LIMITS.nameLength}
          onChangeText={(value) => set("name", value)}
          className={TRACKER_INPUT_CLASS}
        />
        {problems.includes("name") ? (
          <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
            {t`Give the tracker a name, up to 40 characters.`}
          </Text>
        ) : null}
      </Field>

      <Field label={t`Icon`}>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {TRACKER_ICONS.map((key) => (
            <Chip
              key={key}
              selected={draft.icon === key}
              onPress={() => set("icon", key)}
              accessibilityLabel={key}
            >
              <Icon icon={trackerIcon(key)} />
            </Chip>
          ))}
        </View>
      </Field>

      <Field label={t`Type`}>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {TRACKER_TYPES.map((type) => (
            <Chip
              key={type}
              selected={draft.type === type}
              disabled={locked}
              onPress={() => set("type", type)}
            >
              {i18n._(TRACKER_TYPE_LABELS[type])}
            </Chip>
          ))}
        </View>
      </Field>

      {draft.type === "number" ? (
        <>
          <Field label={t`Unit`}>
            <TextInput
              accessibilityLabel={t`Unit`}
              value={draft.unit}
              editable={!locked}
              maxLength={TRACKER_LIMITS.unitLength}
              placeholder={t`reps, pages, cups`}
              placeholderTextColor={placeholder}
              onChangeText={(value) => set("unit", value)}
              className={TRACKER_INPUT_CLASS}
            />
            {problems.includes("unit") ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                {t`Enter a unit, up to 12 characters.`}
              </Text>
            ) : null}
          </Field>
          <Field label={t`Several entries in a day`}>
            <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
              {NUMBER_AGGREGATIONS.map((aggregation) => (
                <Chip
                  key={aggregation}
                  selected={draft.aggregation === aggregation}
                  disabled={locked}
                  onPress={() => set("aggregation", aggregation)}
                >
                  {i18n._(TRACKER_AGGREGATION_LABELS[aggregation])}
                </Chip>
              ))}
            </View>
          </Field>
          <Field label={t`Decimals shown`}>
            <View accessibilityRole="radiogroup" className="flex-row gap-2">
              {[0, 1, 2].map((decimals) => (
                <Chip
                  key={decimals}
                  selected={draft.decimals === decimals}
                  onPress={() => set("decimals", decimals)}
                >
                  {String(decimals)}
                </Chip>
              ))}
            </View>
          </Field>
        </>
      ) : null}
      {locked ? (
        <Text className="font-sans text-sm text-ink-3">
          {t`Type and unit cannot change after the first entry. Create a new tracker instead.`}
        </Text>
      ) : null}

      <SwitchRow
        label={t`Target`}
        hint={
          draft.type === "duration"
            ? t`For example 20 min.`
            : draft.type === "yes_no"
              ? t`Days with a yes: 1 per day, or up to 7 per week.`
              : draft.type === "scale"
                ? t`A rating from 1 to 5.`
                : t`In ${unitName}.`
        }
        value={draft.targetEnabled}
        onChange={(value) => set("targetEnabled", value)}
      />
      {draft.targetEnabled ? (
        <View className="gap-2">
          <TextInput
            accessibilityLabel={t`Target`}
            value={draft.target}
            onChangeText={(value) => set("target", value)}
            keyboardType={draft.type === "duration" ? "default" : "decimal-pad"}
            className={TRACKER_INPUT_CLASS}
          />
          <View accessibilityRole="radiogroup" className="flex-row gap-2">
            {TRACKER_TARGET_PERIODS.map((period) => (
              <Chip
                key={period}
                selected={draft.targetPeriod === period}
                onPress={() => set("targetPeriod", period)}
              >
                {i18n._(TRACKER_PERIOD_LABELS[period])}
              </Chip>
            ))}
          </View>
          {problems.includes("target") ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
              {t`Check the highlighted fields.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="gap-4 border-t border-rule pt-4">
        <SwitchRow
          testID="tracker-share-switch"
          label={t`Share with this workspace`}
          hint={t`Members who can read records see it; collaborators can add entries. Only you can change or delete it.`}
          value={draft.shared}
          onChange={(value) => set("shared", value)}
        />
        <SwitchRow
          testID="tracker-ai-switch"
          label={t`Coach and connected AI apps can read this`}
          hint={t`Notes are never shared with the Coach.`}
          value={draft.aiVisible}
          onChange={(value) => set("aiVisible", value)}
        />
      </View>
    </View>
  );
}
