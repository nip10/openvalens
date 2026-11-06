import { useLingui } from "@lingui/react/macro";
import type { WellnessProfileDraft } from "@openvalens/api/presenters/wellness-profile";
import { cn, Select } from "heroui-native";
import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon, InfoTip } from "@/components/bloom";
import {
  chipsFor,
  selectedChips,
  toggleChip,
  type ChipField,
} from "@/utils/wellness-profile-choices";

/**
 * Issue #98 — the wellness profile's answer controls, shared by the profile
 * screen and the onboarding steps so both ask the same questions the same way.
 */

/** A question inside a step, in Fraunces, with its why behind an ⓘ. */
export function QuestionLabel({ children, info }: { children: ReactNode; info?: ReactNode }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Text className="shrink font-display text-base font-medium text-ink">{children}</Text>
      {info ? <InfoTip>{info}</InfoTip> : null}
    </View>
  );
}

/** The choices as pills; `rows` puts each on its own full-width row. */
export function Chips({
  field,
  draft,
  onChange,
  layout = "wrap",
}: {
  field: ChipField;
  draft: WellnessProfileDraft;
  onChange: (draft: WellnessProfileDraft) => void;
  layout?: "wrap" | "rows";
}) {
  const { i18n } = useLingui();
  const selected = selectedChips(field, draft.answers);
  return (
    <View
      className={layout === "rows" ? "gap-2" : "flex-row flex-wrap gap-2"}
      accessibilityRole="radiogroup"
    >
      {chipsFor(field).map((chip) => {
        const isSelected = selected.includes(chip.key);
        return (
          <Pressable
            key={chip.key}
            testID={`chip-${field}-${chip.key}`}
            onPress={() => onChange(toggleChip(field, chip.key, draft))}
            accessibilityRole={field === "focus" ? "checkbox" : "radio"}
            accessibilityState={{ selected: isSelected, checked: isSelected }}
            className={cn(
              "min-h-11 justify-center rounded-full border px-4 active:opacity-70",
              layout === "rows" && "min-h-12 px-5",
              isSelected ? "border-signal bg-sidebar-accent" : "border-rule bg-paper",
            )}
          >
            <Text
              className={cn(
                "font-sans text-sm",
                isSelected ? "font-semibold text-ink" : "text-ink-2",
              )}
            >
              {i18n._(chip.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A single-choice question as a dropdown, for profile facts such as region or sex. */
export function ChoiceSelect({
  field,
  draft,
  onChange,
  label,
}: {
  field: Exclude<ChipField, "focus">;
  draft: WellnessProfileDraft;
  onChange: (draft: WellnessProfileDraft) => void;
  label: string;
}) {
  const { t, i18n } = useLingui();
  const options = chipsFor(field).map((chip) => ({ value: chip.key, label: i18n._(chip.label) }));
  const key = selectedChips(field, draft.answers)[0];
  const value = options.find((option) => option.value === key);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        // Picking the current choice again keeps it (a pill would clear it).
        if (next && !Array.isArray(next) && next.value !== key)
          onChange(toggleChip(field, next.value, draft));
      }}
    >
      <Select.Trigger testID={`select-${field}`} accessibilityLabel={label}>
        <Select.Value placeholder={t`Choose…`} />
        <Select.TriggerIndicator />
      </Select.Trigger>
      <Select.Portal>
        <Select.Overlay />
        <Select.Content presentation="popover" width="trigger">
          {options.map((option) => (
            <Select.Item
              key={option.value}
              value={option.value}
              label={option.label}
              testID={`select-${field}-${option.value}`}
            />
          ))}
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}

export function CheckboxToggle({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className="min-h-11 flex-row items-start gap-3 py-1 active:opacity-70"
    >
      <View
        className={cn(
          "mt-0.5 h-5 w-5 items-center justify-center rounded-md border",
          checked ? "border-primary bg-primary" : "border-rule-2 bg-paper",
        )}
      >
        {checked ? <Icon icon={Check} size={14} color="primary-foreground" /> : null}
      </View>
      <Text className="flex-1 font-sans text-sm leading-relaxed text-ink-2">{label}</Text>
    </Pressable>
  );
}
